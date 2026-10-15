import { Button, cn, Separator, Tooltip, TypingDots, toast } from "@folio/ui";
import { BookmarkPlus, Lightbulb, MessageSquarePlus, MessagesSquare, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { createNote } from "@/features/notes/actions";
import { useTranslation } from "@/i18n";
import { transform, useChatDraft } from "@/lib/ai";
import { useWorkspace } from "@/stores/workspace";

const COLORS = ["yellow", "green", "blue", "pink", "purple"] as const;

export function SelectionToolbar({
  notebookId,
  sourceId,
  sourceTitle,
  selection,
  onDone,
  onHighlight,
}: {
  notebookId: string;
  sourceId: string;
  sourceTitle: string;
  selection: { start: number; end: number; text: string; x: number; y: number };
  onDone: () => void;
  onHighlight: (color: string, note?: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [explain, setExplain] = useState<{ text: string; done: boolean } | null>(null);
  const [annotating, setAnnotating] = useState(false);
  const [note, setNote] = useState("");
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onDone();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);

  const ask = () => {
    useChatDraft.getState().send({ quote: { text: selection.text, sourceId, sourceTitle } });
    useWorkspace.getState().open({ kind: "chat", title: t("nav.chat") });
    onDone();
  };

  const runExplain = async () => {
    abort.current?.abort();
    abort.current = new AbortController();
    setExplain({ text: "", done: false });
    try {
      const r = await transform(
        { notebookId, action: "explain", text: selection.text },
        (full) => setExplain({ text: full, done: false }),
        abort.current.signal,
      );
      setExplain({ text: r.text, done: true });
    } catch (e) {
      if ((e as Error).name !== "AbortError") setExplain({ text: `⚠️ ${(e as Error).message}`, done: true });
    }
  };

  const toCard = async (extra?: string) => {
    const quote = selection.text.replace(/\n+/g, " ");
    await createNote(
      notebookId,
      {
        title: quote.slice(0, 24),
        markdown: `> ${quote}\n\n— ${sourceTitle}${extra ? `\n\n${extra}` : ""}`,
        kind: "card",
        origin: { type: "source", refId: null, sourceId },
      },
      false,
    );
    toast.success(t("chat.savedCard"));
    onDone();
  };

  const top = Math.max(8, selection.y - 46);
  return (
    <div
      data-toolbar
      className="absolute z-20 -translate-x-1/2 animate-pop"
      style={{ left: Math.max(180, selection.x), top }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="flex items-center gap-0.5 rounded-lg border border-border bg-surface-raised p-1 shadow-lg">
        <Button variant="ghost" size="sm" onClick={ask}>
          <MessagesSquare />
          {t("reader.ask")}
        </Button>
        <Button variant="ghost" size="sm" onClick={runExplain}>
          <Lightbulb />
          {t("reader.explain")}
        </Button>
        <Separator vertical className="mx-0.5" />
        {COLORS.map((c) => (
          <Tooltip key={c} content={t("reader.highlight")}>
            <button
              type="button"
              className={cn("grid size-7 place-items-center rounded-md hover:bg-surface-hover focus-ring")}
              onClick={() => onHighlight(c).then(onDone)}
              aria-label={`${t("reader.highlight")} ${c}`}
            >
              <span className={cn("size-3.5 rounded-full ring-1 ring-black/10", `hl-${c}`)} />
            </button>
          </Tooltip>
        ))}
        <Separator vertical className="mx-0.5" />
        <Tooltip content={t("reader.annotate")}>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setAnnotating(true)}
            aria-label={t("reader.annotate")}
          >
            <MessageSquarePlus />
          </Button>
        </Tooltip>
        <Tooltip content={t("reader.toCard")}>
          <Button variant="ghost" size="icon-sm" onClick={() => toCard()} aria-label={t("reader.toCard")}>
            <BookmarkPlus />
          </Button>
        </Tooltip>
      </div>
      {annotating ? (
        <form
          className="mt-1.5 w-80 rounded-lg border border-border bg-surface-raised p-2 shadow-lg animate-pop"
          onSubmit={(e) => {
            e.preventDefault();
            onHighlight("yellow", note).then(onDone);
          }}
        >
          <textarea
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            placeholder={t("reader.annotationPlaceholder")}
            className="h-20 w-full resize-none rounded-md bg-surface-sunken p-2 text-[13px] outline-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
            }}
          />
          <div className="mt-1.5 flex justify-end">
            <Button type="submit" size="xs" variant="primary">
              {t("common.save")}
            </Button>
          </div>
        </form>
      ) : null}
      {explain ? (
        <div className="mt-1.5 w-[26rem] max-w-[80vw] rounded-lg border border-border bg-surface-raised shadow-lg animate-pop">
          <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs font-medium text-fg-subtle">
            <span className="flex items-center gap-1.5">
              <Lightbulb className="size-3.5 text-accent" />
              {t("reader.explain")}
            </span>
            <button
              type="button"
              onClick={() => setExplain(null)}
              className="rounded p-0.5 hover:bg-surface-hover"
              aria-label={t("common.close")}
            >
              <X className="size-3.5" />
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto px-3 py-2.5">
            {explain.text ? (
              <Markdown text={explain.text} className="prose-sm" />
            ) : (
              <TypingDots className="text-fg-subtle" />
            )}
          </div>
          {explain.done ? (
            <div className="flex justify-end gap-1 border-t border-border px-2 py-1.5">
              <Button size="xs" variant="ghost" onClick={() => toCard(explain.text)}>
                <BookmarkPlus />
                {t("reader.toCard")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
