import { toast } from "@quirenote/ui";
import { createNote } from "@/features/notes/actions";
import i18n from "@/i18n";
import { useChatDraft } from "@/lib/ai";
import { api } from "@/lib/api";
import { qk, upsertInList } from "@/lib/query";
import { useWorkspace } from "@/stores/workspace";

/** 右键菜单、工具栏共用的工作区动作：引用到对话、解释、摘录、联网搜索、网址添加为资料。 */

type Quote = { text: string; sourceId?: string; sourceTitle?: string };

function openChat() {
  useWorkspace.getState().open({ kind: "chat", title: i18n.t("nav.chat") });
}

/** 把一段文字作为引用放进对话输入框，接着由用户提问。 */
export function askInChat(quote: Quote) {
  useChatDraft.getState().send({ quote });
  openChat();
}

/** 引用这段文字，直接让 AI 解释（发不出去时留在输入框里）。 */
export function explainInChat(quote: Quote) {
  useChatDraft.getState().send({ quote, text: i18n.t("menu.explainPrompt"), submit: true });
  openChat();
}

/** 用一段话直接提问（例如关于某条笔记、某个元素）。 */
export function draftQuestion(text: string) {
  useChatDraft.getState().send({ text });
  openChat();
}

/** 摘录为卡片：引用原文，注明出处。 */
export async function saveQuoteAsCard(nb: string, quote: Quote, extra?: string) {
  const text = quote.text.replace(/\n+/g, " ").trim();
  await createNote(
    nb,
    {
      title: text.slice(0, 24),
      markdown: `> ${text}${quote.sourceTitle ? `\n\n— ${quote.sourceTitle}` : ""}${extra ? `\n\n${extra}` : ""}`,
      kind: "card",
      origin: quote.sourceId
        ? { type: "source", refId: null, sourceId: quote.sourceId }
        : { type: "manual", refId: null, sourceId: null },
    },
    false,
  );
  toast.success(i18n.t("chat.savedCard"));
}

/** 打开联网搜索面板并立即搜索。 */
export function searchWeb(query: string) {
  useWorkspace.getState().open({
    kind: "search",
    title: i18n.t("nav.search"),
    extra: { query: query.trim().slice(0, 200), nonce: Date.now() },
  });
}

/** 把网址添加为这本 Notebook 的资料。 */
export async function addUrlAsSource(nb: string, url: string) {
  try {
    const s = await api.sources.addUrl(nb, url);
    upsertInList(qk.sources(nb), s);
    toast.success(i18n.t("menu.sourceAdded"), { description: url });
  } catch (e) {
    toast.error((e as Error).message);
  }
}
