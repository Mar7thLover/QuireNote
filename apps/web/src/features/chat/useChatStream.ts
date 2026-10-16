import type { Citation, Conversation, Message } from "@quirenote/core";
import { useCallback, useRef, useState } from "react";
import { type ChatStreamEvent, streamSse } from "@/lib/api";
import { qk, queryClient } from "@/lib/query";

export interface Streaming {
  id: string | null;
  parentId: string | null;
  text: string;
  citations: Citation[];
}

/** 发送消息 / 重新生成，并把 SSE 事件同步进查询缓存。 */
export function useChatStream(notebookId: string, conversationId: string | null) {
  const [streaming, setStreaming] = useState<Streaming | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (
      cid: string,
      body: { content?: string; parentId: string | null; sourceIds?: string[]; regenerateOf?: string },
    ) => {
      const setActiveLeaf = (cid: string, leaf: string) => {
        queryClient.setQueryData<Conversation[]>(qk.conversations(notebookId), (old) =>
          old?.map((c) =>
            c.id === cid ? { ...c, activeLeafId: leaf, updatedAt: new Date().toISOString() } : c,
          ),
        );
      };
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      const key = qk.messages(cid);
      const append = (m: Message) =>
        queryClient.setQueryData<Message[]>(key, (old) => [...(old ?? []).filter((x) => x.id !== m.id), m]);
      setStreaming({ id: null, parentId: body.parentId, text: "", citations: [] });
      try {
        await streamSse(
          `/conversations/${cid}/messages`,
          body,
          (raw) => {
            const e = raw as ChatStreamEvent;
            switch (e.event) {
              case "user":
                append(e.data);
                setActiveLeaf(cid, e.data.id);
                setStreaming((s) => s && { ...s, parentId: e.data.id });
                break;
              case "start":
                setStreaming((s) => s && { ...s, id: e.data.id });
                break;
              case "delta":
                setStreaming((s) => s && { ...s, text: s.text + e.data.text });
                break;
              case "citations":
                setStreaming((s) => s && { ...s, citations: e.data });
                break;
              case "done":
                append(e.data);
                setActiveLeaf(cid, e.data.id);
                break;
              case "error":
                throw new Error(e.data.message);
            }
          },
          ac.signal,
        );
      } finally {
        setStreaming(null);
        queryClient.invalidateQueries({ queryKey: key });
        queryClient.invalidateQueries({ queryKey: qk.conversations(notebookId) });
      }
    },
    [notebookId],
  );

  const stop = () => abortRef.current?.abort();
  void conversationId;
  return { streaming, send, stop };
}
