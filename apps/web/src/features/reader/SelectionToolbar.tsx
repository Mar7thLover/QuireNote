import type { SourceContent } from "@quirenote/core";
import { Button, cn, Separator, Tooltip, TypingDots, toast } from "@quirenote/ui";
import { BookmarkPlus, Check, Eraser, Lightbulb, MessageSquarePlus, MessagesSquare, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { createNote } from "@/features/notes/actions";
import { useTranslation } from "@/i18n";
import { transform, useChatDraft } from "@/lib/ai";
import { api } from "@/lib/api";
import { qk, queryClient } from "@/lib/query";
import { useWorkspace } from "@/stores/workspace";

export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink", "purple"] as const;

type Highlight = SourceContent["highlights"][number];

/** 工具栏作用的文字范围：选中的文字，或被点击的高亮。x / y 是相对滚动容器的锚点（文字上沿中点）。 */
export interface ToolbarTarget {
  start: number;
  end: number;
  text: string;
  x: number;
  y: number;
}

function setHighlights(sourceId: string, fn: (list: Highlight[]) => Highlight[]) {
  queryClient.setQueryData<SourceContent>(qk.content(sourceId), (old) =>
    old ? { ...old, highlights: fn(old.highlights) } : old,
  );
}

/**
 * 阅读器里唯一的高亮工具栏：选中文字、点击已有高亮都弹出它。
 * 范围内已有高亮时：颜色按钮显示当前颜色、点击即改色；并出现「取消高亮」，一次清掉范围内所有高亮。
 */
export function SelectionToolbar({
  notebookId,
  sourceId,
  sourceTitle,
  target,
  highlights,
  onDone,
}: {
  notebookId: string;
  sourceId: string;
  sourceTitle: string;
  target: ToolbarTarget;
  highlights: Highlight[];
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const covered = highlights.filter((h) => h.start < target.end && h.end > target.start);
  const userCovered = covered.filter((h) => h.by === "user");
  const colors = new Set(userCovered.map((h) => h.color));
  const activeColor = userCovered.length && colors.size === 1 ? userCovered[0]!.color : null;
  const [explain, setExplain] = useState<{ text: string; done: boolean } | null>(null);
  const [annotating, setAnnotating] = useState(false);
  const [note, setNote] = useState(() =>
    userCovered
      .map((h) => h.note)
      .filter(Boolean)
      .join("\n"),
  );
  const abort = useRef<AbortController | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // 工具栏始终留在阅读区内：按自身宽度夹住水平位置，阅读区太窄时换行。
  const [place, setPlace] = useState<{ left: number; maxWidth?: number; rowHeight: number }>({
    left: target.x,
    rowHeight: 42,
  });
  useLayoutEffect(() => {
    const el = boxRef.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent) return;
    const measure = () => {
      const maxWidth = parent.clientWidth - 16;
      const w = Math.min(el.offsetWidth, maxWidth);
      const left = Math.min(Math.max(target.x, w / 2 + 8), parent.clientWidth - w / 2 - 8);
      const rowHeight = (el.firstElementChild as HTMLElement | null)?.offsetHeight ?? 42;
      setPlace((p) =>
        p.left === left && p.maxWidth === maxWidth && p.rowHeight === rowHeight
          ? p
          : { left, maxWidth, rowHeight },
      );
    };
    measure();
    // 换行、展开批注 / 解释都会改变尺寸：尺寸一变就重新定位。
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [target.x]);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onDone();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.content(sourceId) });

  /** 高亮或改色：服务端会把重叠的高亮合并成一条，所以这里只需要提交一次。 */
  const highlight = async (color: string, nextNote?: string) => {
    const start = Math.min(target.start, ...userCovered.map((h) => h.start));
    const end = Math.max(target.end, ...userCovered.map((h) => h.end));
    try {
      if (userCovered.length === 1 && start === userCovered[0]!.start && end === userCovered[0]!.end) {
        const h = userCovered[0]!;
        const changes = { color, ...(nextNote !== undefined ? { note: nextNote } : {}) };
        setHighlights(sourceId, (list) => list.map((x) => (x.id === h.id ? { ...x, ...changes } : x)));
        await api.sources.updateHighlight(sourceId, h.id, changes);
      } else {
        // 合并时服务端会拼接旧批注；改批注的场景先删掉旧的，避免重复。
        if (nextNote !== undefined)
          for (const h of userCovered) await api.sources.removeHighlight(sourceId, h.id);
        await api.sources.addHighlight(sourceId, { start, end, color, note: nextNote });
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
    await refresh();
    onDone();
  };

  const remove = async () => {
    const ids = new Set(covered.map((h) => h.id));
    setHighlights(sourceId, (list) => list.filter((h) => !ids.has(h.id)));
    onDone();
    try {
      for (const id of ids) await api.sources.removeHighlight(sourceId, id);
      toast.success(t("reader.removed"));
    } catch (e) {
      toast.error((e as Error).message);
    }
    await refresh();
  };

  const ask = () => {
    useChatDraft.getState().send({ quote: { text: target.text, sourceId, sourceTitle } });
    useWorkspace.getState().open({ kind: "chat", title: t("nav.chat") });
    onDone();
  };

  const runExplain = async () => {
    abort.current?.abort();
    abort.current = new AbortController();
    setExplain({ text: "", done: false });
    try {
      const r = await transform(
        { notebookId, action: "explain", text: target.text },
        (full) => setExplain({ text: full, done: false }),
        abort.current.signal,
      );
      setExplain({ text: r.text, done: true });
    } catch (e) {
      if ((e as Error).name !== "AbortError") setExplain({ text: `⚠️ ${(e as Error).message}`, done: true });
    }
  };

  const toCard = async (extra?: string) => {
    const quote = target.text.replace(/\n+/g, " ");
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

  // 工具栏（可能换成两行）放在选中文字上方。
  const top = Math.max(8, target.y - place.rowHeight - 8);
  return (
    <div
      ref={boxRef}
      data-toolbar
      className="absolute z-20 w-max -translate-x-1/2 animate-pop"
      style={{ left: place.left, top, maxWidth: place.maxWidth }}
      onMouseDown={(e) => {
        // 保留选区（文本框除外，否则无法输入批注）。
        if (!(e.target as HTMLElement).closest("textarea")) e.preventDefault();
      }}
    >
      <div className="flex flex-wrap items-center gap-0.5 rounded-lg border border-border bg-surface-raised p-1 shadow-lg">
        <Button variant="ghost" size="sm" onClick={ask}>
          <MessagesSquare />
          {t("reader.ask")}
        </Button>
        <Button variant="ghost" size="sm" onClick={runExplain}>
          <Lightbulb />
          {t("reader.explain")}
        </Button>
        <Separator vertical className="mx-0.5" />
        {HIGHLIGHT_COLORS.map((c) => {
          const active = activeColor === c;
          const label = active
            ? t("reader.currentColor", { color: t(`reader.color_${c}`) })
            : t("reader.highlightAs", { color: t(`reader.color_${c}`) });
          return (
            <Tooltip key={c} content={label}>
              <button
                type="button"
                className={cn(
                  "grid size-7 place-items-center rounded-md hover:bg-surface-hover focus-ring",
                  active && "bg-surface-hover",
                )}
                onClick={() => (active ? onDone() : highlight(c))}
                aria-label={label}
                aria-pressed={active}
              >
                <span
                  className={cn(
                    "grid size-4 place-items-center rounded-full ring-1 ring-black/10",
                    `hl-${c}`,
                    active && "ring-2 ring-fg/60",
                  )}
                >
                  {active ? <Check className="size-3 text-fg" strokeWidth={3} /> : null}
                </span>
              </button>
            </Tooltip>
          );
        })}
        {covered.length ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-danger hover:bg-danger-soft hover:text-danger"
            onClick={remove}
          >
            <Eraser />
            {t("reader.removeHighlight")}
          </Button>
        ) : null}
        <Separator vertical className="mx-0.5" />
        <Tooltip content={t("reader.annotate")}>
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn(annotating && "bg-surface-hover")}
            onClick={() => setAnnotating((v) => !v)}
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
            void highlight(activeColor ?? "yellow", note.trim());
          }}
        >
          <textarea
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("reader.annotationPlaceholder")}
            aria-label={t("reader.annotate")}
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
