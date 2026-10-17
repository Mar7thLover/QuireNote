import type { Artifact, Job, Source } from "@quirenote/core";
import { toast } from "@quirenote/ui";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { MutationCache, onlineManager, QueryClient } from "@tanstack/react-query";
import { del, get, set } from "idb-keyval";
import { ApiError, apiBase } from "./api";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 1000 * 60 * 60 * 24 * 7,
      // 离线时直接用缓存，不报错
      networkMode: "offlineFirst",
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
    mutations: { networkMode: "offlineFirst" },
  },
  mutationCache: new MutationCache({
    onError: (err) => {
      if (err instanceof ApiError && err.status === 0) toast.error("离线中，改动将在恢复连接后同步");
      else toast.error(err instanceof Error ? err.message : String(err));
    },
  }),
});

/** 查询缓存持久化到 IndexedDB：离线时也能浏览。 */
export const persister = createAsyncStoragePersister({
  storage: {
    getItem: (k) => get<string>(k).then((v) => v ?? null),
    setItem: (k, v) => set(k, v),
    removeItem: (k) => del(k),
  },
  key: "quirenote.query-cache",
  throttleTime: 1500,
});

export const qk = {
  notebooks: ["notebooks"] as const,
  notebook: (id: string) => ["notebook", id] as const,
  sources: (nb: string) => ["sources", nb] as const,
  source: (id: string) => ["source", id] as const,
  content: (id: string) => ["source-content", id] as const,
  conversations: (nb: string) => ["conversations", nb] as const,
  messages: (cid: string) => ["messages", cid] as const,
  notes: (nb: string) => ["notes", nb] as const,
  note: (id: string) => ["note", id] as const,
  artifacts: (nb: string) => ["artifacts", nb] as const,
  artifact: (id: string) => ["artifact", id] as const,
  elements: (nb: string) => ["elements", nb] as const,
  views: (nb: string) => ["views", nb] as const,
  properties: (nb: string) => ["properties", nb] as const,
  review: (nb: string) => ["review", nb] as const,
  reviewStats: (nb: string) => ["review-stats", nb] as const,
  providers: ["providers"] as const,
  catalog: ["provider-catalog"] as const,
  assignments: ["assignments"] as const,
  jobs: ["jobs"] as const,
  settings: (key: string) => ["settings", key] as const,
  adminStats: ["admin-stats"] as const,
  overview: ["overview"] as const,
  usage: ["usage-summary"] as const,
};

/** 用列表里的某一项更新缓存（乐观更新 / SSE 推送共用）。 */
export function upsertInList<T extends { id: string }>(key: readonly unknown[], item: T) {
  queryClient.setQueryData<T[]>(key, (old) => {
    if (!old) return old;
    const i = old.findIndex((x) => x.id === item.id);
    if (i < 0) return [item, ...old];
    const next = old.slice();
    next[i] = { ...old[i], ...item };
    return next;
  });
}

export function removeFromList(key: readonly unknown[], id: string) {
  queryClient.setQueryData<{ id: string }[]>(key, (old) => old?.filter((x) => x.id !== id));
}

/** 订阅服务端事件，实时更新任务进度、资料解析状态和生成物状态。 */
export function subscribeServerEvents(): () => void {
  let es: EventSource | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const connect = () => {
    if (closed) return;
    es = new EventSource(`${apiBase()}/events`);
    es.addEventListener("open", () => onlineManager.setOnline(true));
    es.addEventListener("job", (e) => {
      const job = JSON.parse((e as MessageEvent).data) as Job;
      queryClient.setQueryData<Job[]>(qk.jobs, (old) => {
        const list = old ? old.filter((j) => j.id !== job.id) : [];
        return [job, ...list].slice(0, 50);
      });
      if (job.status === "done" && job.notebookId) {
        // 任务完成后可能产生新数据
        if (job.type.includes("element"))
          queryClient.invalidateQueries({ queryKey: qk.elements(job.notebookId) });
        if (job.type.includes("research") || job.type.includes("import"))
          queryClient.invalidateQueries({ queryKey: qk.sources(job.notebookId) });
        if (job.type.includes("highlight") && job.refId)
          queryClient.invalidateQueries({ queryKey: qk.content(job.refId) });
      }
    });
    es.addEventListener("source", (e) => {
      const s = JSON.parse((e as MessageEvent).data) as Source;
      upsertInList(qk.sources(s.notebookId), s);
      queryClient.setQueryData(qk.source(s.id), s);
      if (s.status === "ready") queryClient.invalidateQueries({ queryKey: qk.content(s.id) });
    });
    es.addEventListener("artifact", (e) => {
      const a = JSON.parse((e as MessageEvent).data) as Artifact;
      upsertInList(qk.artifacts(a.notebookId), a);
      queryClient.setQueryData(qk.artifact(a.id), a);
    });
    es.addEventListener("error", () => {
      es?.close();
      clearTimeout(retry);
      retry = setTimeout(connect, 3000);
    });
  };
  connect();
  return () => {
    closed = true;
    clearTimeout(retry);
    es?.close();
  };
}
