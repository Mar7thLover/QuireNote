import type { Citation } from "@folio/core";
import { create } from "zustand";
import { streamSse } from "./api";

export type TransformAction =
  | "explain"
  | "rewrite"
  | "expand"
  | "shorten"
  | "translate"
  | "summarize"
  | "find_source"
  | "quiz"
  | "continue"
  | "outline"
  | "custom";

/** 调用就地 AI（流式），返回最终文本与引用。 */
export async function transform(
  input: {
    notebookId: string;
    action: TransformAction;
    text: string;
    instruction?: string;
    targetLang?: string;
  },
  onDelta: (full: string) => void,
  signal?: AbortSignal,
): Promise<{ text: string; citations: Citation[] }> {
  let text = "";
  let citations: Citation[] = [];
  await streamSse(
    "/ai/transform",
    input,
    (e) => {
      if (e.event === "delta") {
        text += (e.data as { text: string }).text;
        onDelta(text);
      } else if (e.event === "citations") citations = e.data as Citation[];
      else if (e.event === "done") {
        const d = e.data as { text?: string };
        if (d?.text) text = d.text;
      } else if (e.event === "error") throw new Error((e.data as { message: string }).message);
    },
    signal,
  );
  return { text, citations };
}

/** 跨面板传递给对话输入框的草稿（引用片段、限定资料）。 */
interface ChatDraft {
  quote: { text: string; sourceId?: string; sourceTitle?: string } | null;
  text: string;
  onlySourceIds: string[] | null;
  nonce: number;
  send: (d: Partial<Omit<ChatDraft, "send" | "nonce" | "clear">>) => void;
  clear: () => void;
}

export const useChatDraft = create<ChatDraft>()((set) => ({
  quote: null,
  text: "",
  onlySourceIds: null,
  nonce: 0,
  send: (d) => set((s) => ({ ...s, ...d, nonce: s.nonce + 1 })),
  clear: () => set({ quote: null, text: "", onlySourceIds: null }),
}));
