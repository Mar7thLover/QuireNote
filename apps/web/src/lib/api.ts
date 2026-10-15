import type {
  AgentProposal,
  Artifact,
  ArtifactData,
  ArtifactKind,
  Chunk,
  Citation,
  Conversation,
  DbView,
  Element,
  Job,
  Message,
  ModelAssignment,
  Note,
  Notebook,
  NotebookInput,
  NoteInput,
  PropertyDef,
  ProviderConfig,
  ProviderInput,
  ReviewCard,
  Source,
  SourceContent,
} from "@folio/core";

/** 服务端地址。Capacitor 等外部壳可以通过 localStorage 覆盖。 */
export function apiBase(): string {
  try {
    const override = localStorage.getItem("folio.server");
    if (override) return `${override.replace(/\/$/, "")}/api`;
  } catch {}
  return "/api";
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, init?: RequestInit): Promise<T> {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(apiBase() + path, {
      method,
      headers: body && !isForm ? { "content-type": "application/json" } : undefined,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
      ...init,
    });
  } catch {
    throw new ApiError(0, "network", "无法连接服务器");
  }
  if (!res.ok) {
    let code = "http";
    let message = res.statusText;
    try {
      const j = (await res.json()) as { error?: { code: string; message: string } };
      if (j.error) ({ code, message } = j.error);
    } catch {}
    throw new ApiError(res.status, code, message);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  return (ct.includes("json") ? res.json() : res.blob()) as Promise<T>;
}

const get = <T>(p: string) => request<T>("GET", p);
const post = <T>(p: string, b?: unknown) => request<T>("POST", p, b ?? {});
const patch = <T>(p: string, b: unknown) => request<T>("PATCH", p, b);
const put = <T>(p: string, b: unknown) => request<T>("PUT", p, b);
const del = <T = { ok: boolean }>(p: string) => request<T>("DELETE", p);

export interface RetrieveResult {
  chunk: Chunk;
  sourceTitle: string;
  score: number;
  vectorRank: number | null;
  keywordRank: number | null;
}

export interface ProviderCatalogEntry {
  kind: string;
  label: string;
  capabilities: string[];
  defaultBaseUrl: string | null;
  baseUrlRequired?: boolean;
  requiresKey: boolean;
  models: Partial<Record<string, string[]>>;
  notes?: string | null;
  docsUrl?: string | null;
}

export interface AdminStats {
  dbBytes: number;
  filesBytes: number;
  notebooks: number;
  sources: number;
  chunks: number;
  embedded: number;
  notes: number;
  artifacts: number;
  elements: number;
  pendingJobs: number;
  embeddingModel: string;
}

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
  content?: string;
}

export const api = {
  health: () => get<{ ok: boolean; version: string }>("/health"),

  notebooks: {
    list: () => get<Notebook[]>("/notebooks"),
    get: (id: string) => get<Notebook>(`/notebooks/${id}`),
    create: (input: NotebookInput) => post<Notebook>("/notebooks", input),
    update: (id: string, input: Partial<NotebookInput> & { pinned?: boolean }) =>
      patch<Notebook>(`/notebooks/${id}`, input),
    remove: (id: string) => del(`/notebooks/${id}`),
    exportUrl: (id: string) => `${apiBase()}/notebooks/${id}/export`,
    import: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return post<Notebook>("/import", fd);
    },
  },

  sources: {
    list: (nb: string) => get<Source[]>(`/notebooks/${nb}/sources`),
    get: (id: string) => get<Source>(`/sources/${id}`),
    addFile: (nb: string, file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return post<Source>(`/notebooks/${nb}/sources`, fd);
    },
    addUrl: (nb: string, url: string) =>
      post<Source>(`/notebooks/${nb}/sources`, { kind: /youtu\.?be/.test(url) ? "youtube" : "url", url }),
    addText: (nb: string, title: string, text: string, kind: "text" | "markdown" = "markdown") =>
      post<Source>(`/notebooks/${nb}/sources`, { kind, title, text }),
    addSearch: (nb: string, r: WebResult) =>
      post<Source>(`/notebooks/${nb}/sources`, {
        kind: "search",
        title: r.title,
        url: r.url,
        text: r.content ?? r.snippet,
      }),
    update: (id: string, input: Partial<Pick<Source, "title" | "selected" | "props">>) =>
      patch<Source>(`/sources/${id}`, input),
    remove: (id: string) => del(`/sources/${id}`),
    content: (id: string) => get<SourceContent>(`/sources/${id}/content`),
    chunks: (id: string) => get<Chunk[]>(`/sources/${id}/chunks`),
    fileUrl: (id: string) => `${apiBase()}/sources/${id}/file`,
    addHighlight: (id: string, h: { start: number; end: number; color: string; note?: string }) =>
      post<SourceContent["highlights"][number]>(`/sources/${id}/highlights`, h),
    removeHighlight: (id: string, hid: string) => del(`/sources/${id}/highlights/${hid}`),
    autoHighlight: (id: string) => post<Job>(`/sources/${id}/auto-highlight`),
  },

  retrieve: (nb: string, query: string, sourceIds?: string[], k = 8) =>
    post<{ results: RetrieveResult[] }>(`/notebooks/${nb}/retrieve`, { query, sourceIds, k }),

  conversations: {
    list: (nb: string) => get<Conversation[]>(`/notebooks/${nb}/conversations`),
    create: (nb: string, title?: string) => post<Conversation>(`/notebooks/${nb}/conversations`, { title }),
    update: (id: string, input: { title?: string; activeLeafId?: string | null }) =>
      patch<Conversation>(`/conversations/${id}`, input),
    remove: (id: string) => del(`/conversations/${id}`),
    messages: (id: string) => get<Message[]>(`/conversations/${id}/messages`),
  },

  notes: {
    list: (nb: string) => get<Note[]>(`/notebooks/${nb}/notes`),
    get: (id: string) => get<Note>(`/notes/${id}`),
    create: (nb: string, input: NoteInput) => post<Note>(`/notebooks/${nb}/notes`, input),
    update: (id: string, input: Partial<NoteInput>) => patch<Note>(`/notes/${id}`, input),
    remove: (id: string) => del(`/notes/${id}`),
  },

  artifacts: {
    list: (nb: string) => get<Artifact[]>(`/notebooks/${nb}/artifacts`),
    get: (id: string) => get<Artifact>(`/artifacts/${id}`),
    create: (
      nb: string,
      input: { kind: ArtifactKind; sourceIds?: string[]; instructions?: string; title?: string },
    ) => post<Artifact>(`/notebooks/${nb}/artifacts`, input),
    update: (id: string, input: { title?: string; data?: ArtifactData }) =>
      patch<Artifact>(`/artifacts/${id}`, input),
    remove: (id: string) => del(`/artifacts/${id}`),
    refine: (id: string, instruction: string, selection?: string) =>
      post<Artifact>(`/artifacts/${id}/refine`, { instruction, selection }),
  },

  review: {
    due: (nb: string) => get<ReviewCard[]>(`/notebooks/${nb}/review/due`),
    stats: (nb: string) =>
      get<{ total: number; due: number; learned: number; retention: number }>(
        `/notebooks/${nb}/review/stats`,
      ),
    addCards: (
      nb: string,
      cards: { front: string; back: string; elementId?: string | null; artifactId?: string | null }[],
    ) => post<ReviewCard[]>(`/notebooks/${nb}/review/cards`, { cards }),
    rate: (cardId: string, rating: 1 | 2 | 3 | 4) => post<ReviewCard>(`/review/${cardId}`, { rating }),
  },

  elements: {
    list: (nb: string) => get<Element[]>(`/notebooks/${nb}/elements`),
    create: (nb: string, input: Partial<Element>) => post<Element>(`/notebooks/${nb}/elements`, input),
    update: (id: string, input: Partial<Element>) => patch<Element>(`/elements/${id}`, input),
    remove: (id: string) => del(`/elements/${id}`),
    extract: (nb: string, input: { sourceIds?: string[]; noteIds?: string[]; conversationId?: string }) =>
      post<Job>(`/notebooks/${nb}/elements/extract`, input),
    merge: (nb: string, ids: string[], intoId: string) =>
      post<Element>(`/notebooks/${nb}/elements/merge`, { ids, intoId }),
    enrich: (id: string) => post<Element>(`/elements/${id}/enrich`),
    cards: (nb: string, ids: string[]) => post<ReviewCard[]>(`/notebooks/${nb}/elements/cards`, { ids }),
  },

  views: {
    list: (nb: string) => get<DbView[]>(`/notebooks/${nb}/views`),
    create: (nb: string, v: Omit<DbView, "id" | "notebookId">) => post<DbView>(`/notebooks/${nb}/views`, v),
    update: (id: string, v: Partial<DbView>) => patch<DbView>(`/views/${id}`, v),
    remove: (id: string) => del(`/views/${id}`),
  },
  properties: {
    list: (nb: string) => get<PropertyDef[]>(`/notebooks/${nb}/properties`),
    create: (nb: string, p: Omit<PropertyDef, "id" | "notebookId">) =>
      post<PropertyDef>(`/notebooks/${nb}/properties`, p),
    update: (id: string, p: Partial<PropertyDef>) => patch<PropertyDef>(`/properties/${id}`, p),
    remove: (id: string) => del(`/properties/${id}`),
  },

  ai: {
    command: (nb: string, instruction: string, noteIds?: string[], selection?: string) =>
      post<AgentProposal>("/ai/command", { notebookId: nb, instruction, noteIds, selection }),
    apply: (nb: string, proposal: AgentProposal) =>
      post<{ applied: { op: string; id: string }[]; undoToken: string }>("/ai/apply", {
        notebookId: nb,
        proposal,
      }),
    undo: (undoToken: string) => post<{ ok: boolean }>("/ai/undo", { undoToken }),
  },

  search: {
    web: (query: string, providerId?: string) =>
      post<{ results: WebResult[] }>("/search/web", { query, providerId }),
    research: (nb: string, question: string, rounds = 2) =>
      post<Job>(`/notebooks/${nb}/research`, { question, rounds }),
  },

  providers: {
    catalog: () => get<ProviderCatalogEntry[]>("/providers/catalog"),
    list: () => get<ProviderConfig[]>("/providers"),
    create: (input: ProviderInput) => post<ProviderConfig>("/providers", input),
    update: (id: string, input: Partial<ProviderInput>) => patch<ProviderConfig>(`/providers/${id}`, input),
    remove: (id: string) => del(`/providers/${id}`),
    test: (id: string) =>
      post<{ ok: boolean; latencyMs: number; error?: string; models?: string[] }>(`/providers/${id}/test`),
    models: (id: string) => get<string[]>(`/providers/${id}/models`),
    assignments: () => get<ModelAssignment[]>("/models/assignments"),
    assign: (a: ModelAssignment) => put<ModelAssignment[]>("/models/assignments", a),
  },

  jobs: (nb?: string) => get<Job[]>(`/jobs${nb ? `?notebookId=${nb}` : ""}`),
  settings: {
    get: <T>(key: string) => get<T | null>(`/settings/${key}`),
    put: <T>(key: string, value: T) => put<T>(`/settings/${key}`, value),
  },
  admin: {
    stats: () => get<AdminStats>("/admin/stats"),
    reindex: (notebookId?: string) => post<Job>("/admin/reindex", { notebookId }),
    backupUrl: () => `${apiBase()}/admin/backup`,
    restore: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return post<{ ok: boolean }>("/admin/restore", fd);
    },
  },
};

// ───────────── SSE over fetch ─────────────
export interface SseEvent {
  event: string;
  data: unknown;
}

/** POST 后按 SSE 协议解析响应体，逐个回调事件。 */
export async function streamSse(
  path: string,
  body: unknown,
  onEvent: (e: SseEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(apiBase() + path, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    let message = res.statusText;
    try {
      const j = (await res.json()) as { error?: { message: string } };
      if (j.error) message = j.error.message;
    } catch {}
    throw new ApiError(res.status, "http", message);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value.replace(/\r\n/g, "\n");
    let idx = buf.indexOf("\n\n");
    while (idx >= 0) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      idx = buf.indexOf("\n\n");
      let event = "message";
      const data: string[] = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      if (!data.length) continue;
      const text = data.join("\n");
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {}
      onEvent({ event, data: parsed });
    }
  }
}

export type ChatStreamEvent =
  | { event: "user"; data: Message }
  | { event: "start"; data: { id: string } }
  | { event: "delta"; data: { text: string } }
  | { event: "citations"; data: Citation[] }
  | { event: "done"; data: Message }
  | { event: "error"; data: { message: string } };
