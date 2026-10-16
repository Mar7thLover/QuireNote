import type { Citation } from "@quirenote/core";
import { Button, TypingDots } from "@quirenote/ui";
import type { Editor } from "@tiptap/core";
import { ArrowDownToLine, RefreshCw, Replace, SendHorizontal, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { useTranslation } from "@/i18n";
import { type TransformAction, transform } from "@/lib/ai";

export interface AiRequest {
  action: TransformAction;
  label: string;
  text: string;
  instruction?: string;
  targetLang?: string;
  /** 选区范围；为空表示插入点。 */
  from: number;
  to: number;
}

/** 把插入范围内的 [n] 文本替换为带出处信息的引用节点。 */
export function linkCitations(editor: Editor, from: number, to: number, citations: Citation[]) {
  if (!citations.length) return;
  const byN = new Map(citations.map((c) => [c.n, c]));
  const hits: { pos: number; len: number; c: Citation }[] = [];
  editor.state.doc.nodesBetween(from, Math.min(to, editor.state.doc.content.size), (node, pos) => {
    if (!node.isText || !node.text) return;
    for (const m of node.text.matchAll(/\[(\d{1,3})\]/g)) {
      const c = byN.get(Number(m[1]));
      if (c) hits.push({ pos: pos + m.index, len: m[0].length, c });
    }
  });
  const type = editor.schema.nodes.citation;
  if (!type || !hits.length) return;
  let tr = editor.state.tr;
  for (const h of hits.reverse()) {
    tr = tr.replaceWith(
      h.pos,
      h.pos + h.len,
      type.create({
        n: h.c.n,
        sourceId: h.c.sourceId,
        sourceTitle: h.c.sourceTitle,
        start: h.c.start,
        end: h.c.end,
        quote: h.c.quote,
      }),
    );
  }
  editor.view.dispatch(tr);
}

/**
 * 就地 AI 结果面板：流式显示，用户选择替换选区 / 插入下方 / 继续调整 / 放弃。
 * AI 不会直接改写文档。
 */
export function AiDraft({
  editor,
  notebookId,
  request,
  onClose,
}: {
  editor: Editor;
  notebookId: string;
  request: AiRequest;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [citations, setCitations] = useState<Citation[]>([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState("");
  const [req, setReq] = useState(request);
  const abort = useRef<AbortController | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 每次请求变化重新生成
  useEffect(() => {
    abort.current?.abort();
    if (req.action === "custom" && !req.instruction) return;
    const ac = new AbortController();
    abort.current = ac;
    setText("");
    setDone(false);
    setError(null);
    transform(
      {
        notebookId,
        action: req.action,
        text: req.text,
        instruction: req.instruction,
        targetLang: req.targetLang,
      },
      setText,
      ac.signal,
    )
      .then((r) => {
        setText(r.text);
        setCitations(r.citations);
        setDone(true);
      })
      .catch((e: Error) => {
        if (e.name !== "AbortError") {
          setError(e.message);
          setDone(true);
        }
      });
    return () => ac.abort();
  }, [req]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const coords = editor.view.coordsAtPos(Math.min(req.to, editor.state.doc.content.size));
  const left = Math.min(Math.max(12, coords.left - 20), window.innerWidth - 500);
  const below = coords.bottom + 320 < window.innerHeight;

  const insert = (replace: boolean) => {
    const { from, to } = req;
    const chain = editor.chain().focus();
    const at = replace
      ? from
      : editor.state.doc.resolve(Math.min(to, editor.state.doc.content.size)).after(1);
    if (replace && from !== to) chain.deleteRange({ from, to });
    chain.insertContentAt(replace ? from : at, text, { contentType: "markdown" }).run();
    const end = editor.state.selection.to;
    linkCitations(editor, Math.min(at, end), end, citations);
    onClose();
  };

  return (
    <div
      ref={boxRef}
      className="fixed z-[65] w-[min(480px,calc(100vw-24px))] overflow-hidden rounded-xl border border-border bg-surface-raised shadow-lg animate-pop"
      style={below ? { left, top: coords.bottom + 8 } : { left, bottom: window.innerHeight - coords.top + 8 }}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs font-medium text-fg-muted">
        <Sparkles className="size-3.5 text-accent" />
        {req.label}
        <span className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 hover:bg-surface-hover"
          aria-label={t("common.close")}
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto px-3.5 py-3">
        {req.action === "custom" && !req.instruction ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (followUp.trim()) setReq({ ...req, instruction: followUp.trim(), label: followUp.trim() });
              setFollowUp("");
            }}
          >
            <input
              autoFocus
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              placeholder={t("editor.askPlaceholder")}
              className="h-9 w-full rounded-md bg-surface-sunken px-2.5 text-[13.5px] outline-none placeholder:text-fg-subtle"
            />
          </form>
        ) : error ? (
          <p className="text-[13px] text-danger">{error}</p>
        ) : text ? (
          <Markdown text={done ? text : `${text} ▍`} citations={citations} className="prose-sm" />
        ) : (
          <TypingDots className="text-fg-subtle" />
        )}
      </div>
      {done && !error ? (
        <div className="space-y-2 border-t border-border p-2">
          <form
            className="flex items-center gap-1.5 rounded-md bg-surface-sunken px-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!followUp.trim()) return;
              setReq({ ...req, action: "custom", text: text, instruction: followUp, label: followUp });
              setFollowUp("");
            }}
          >
            <input
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              placeholder={t("editor.askPlaceholder")}
              className="h-8 flex-1 bg-transparent text-[13px] outline-none placeholder:text-fg-subtle"
            />
            <button type="submit" className="text-fg-subtle hover:text-accent" aria-label="send">
              <SendHorizontal className="size-4" />
            </button>
          </form>
          <div className="flex items-center gap-1">
            {req.from !== req.to ? (
              <Button size="xs" variant="primary" onClick={() => insert(true)}>
                <Replace />
                {t("editor.replace")}
              </Button>
            ) : null}
            <Button
              size="xs"
              variant={req.from === req.to ? "primary" : "secondary"}
              onClick={() => insert(false)}
            >
              <ArrowDownToLine />
              {t("editor.insertBelow")}
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setReq({ ...req })}>
              <RefreshCw />
              {t("common.retry")}
            </Button>
            <span className="flex-1" />
            <Button size="xs" variant="ghost" onClick={onClose}>
              {t("editor.discard")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
