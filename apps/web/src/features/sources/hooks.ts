import type { Source } from "@quirenote/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { qk, queryClient, removeFromList, upsertInList } from "@/lib/query";

export function useSources(nb: string) {
  return useQuery({
    queryKey: qk.sources(nb),
    queryFn: () => api.sources.list(nb),
    // 有资料在解析时短轮询兜底（SSE 是主通道）
    refetchInterval: (q) =>
      q.state.data?.some((s) => s.status === "pending" || s.status === "processing") ? 4000 : false,
  });
}

export function useSelectedSourceIds(nb: string): string[] {
  const { data } = useSources(nb);
  return (data ?? []).filter((s) => s.selected && s.status === "ready").map((s) => s.id);
}

export function useUpdateSource(nb: string) {
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Pick<Source, "title" | "selected">> }) =>
      api.sources.update(id, patch),
    onMutate: ({ id, patch }) => {
      const prev = queryClient.getQueryData<Source[]>(qk.sources(nb));
      const s = prev?.find((x) => x.id === id);
      if (s) upsertInList(qk.sources(nb), { ...s, ...patch });
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && queryClient.setQueryData(qk.sources(nb), ctx.prev),
  });
}

export function useRemoveSource(nb: string) {
  return useMutation({
    mutationFn: (id: string) => api.sources.remove(id),
    onMutate: (id) => removeFromList(qk.sources(nb), id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.sources(nb) }),
  });
}

/** 上传若干文件并乐观插入列表。 */
export async function uploadFiles(nb: string, files: File[]) {
  for (const f of files) {
    const s = await api.sources.addFile(nb, f);
    upsertInList(qk.sources(nb), s);
  }
}
