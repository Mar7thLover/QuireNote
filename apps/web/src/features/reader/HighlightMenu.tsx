import type { SourceContent } from "@quirenote/core";
import { Button, cn, Separator, Tooltip, toast } from "@quirenote/ui";
import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api";
import { qk, queryClient } from "@/lib/query";
import { HIGHLIGHT_COLORS } from "./SelectionToolbar";

type Highlight = SourceContent["highlights"][number];

function patchCache(sourceId: string, fn: (list: Highlight[]) => Highlight[]) {
  queryClient.setQueryData<SourceContent>(qk.content(sourceId), (old) =>
    old ? { ...old, highlights: fn(old.highlights) } : old,
  );
}

/** 点击正文里的高亮弹出：改颜色、写批注、删除。 */
export function HighlightMenu({
  sourceId,
  highlight,
  x,
  y,
  onClose,
}: {
  sourceId: string;
  highlight: Highlight;
  x: number;
  y: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState(highlight.note);
  const ref = useRef<HTMLDivElement>(null);
  // 关闭（点外面、Esc）时组件直接卸载，textarea 的 onBlur 不一定触发：关闭前先保存批注。
  const close = useRef(onClose);
  close.current = () => {
    if (note.trim() !== highlight.note) void update({ note: note.trim() });
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close.current();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, []);

  const update = async (changes: { color?: string; note?: string }) => {
    const before = highlight;
    patchCache(sourceId, (list) => list.map((h) => (h.id === highlight.id ? { ...h, ...changes } : h)));
    try {
      await api.sources.updateHighlight(sourceId, highlight.id, changes);
    } catch (e) {
      patchCache(sourceId, (list) => list.map((h) => (h.id === before.id ? before : h)));
      toast.error((e as Error).message);
    }
  };

  const remove = async () => {
    patchCache(sourceId, (list) => list.filter((h) => h.id !== highlight.id));
    onClose();
    try {
      await api.sources.removeHighlight(sourceId, highlight.id);
    } catch (e) {
      patchCache(sourceId, (list) => [...list, highlight]);
      toast.error((e as Error).message);
    }
  };

  const saveNote = () => {
    if (note.trim() !== highlight.note) void update({ note: note.trim() });
  };

  return (
    <div
      ref={ref}
      data-toolbar
      className="absolute z-20 w-72 -translate-x-1/2 animate-pop rounded-lg border border-border bg-surface-raised p-1.5 shadow-lg"
      style={{ left: Math.max(150, x), top: y + 8 }}
    >
      <div className="flex items-center gap-0.5">
        {HIGHLIGHT_COLORS.map((c) => {
          const active = highlight.by !== "ai" && highlight.color === c;
          return (
            <button
              key={c}
              type="button"
              onClick={() => update({ color: c })}
              className={cn(
                "grid size-7 place-items-center rounded-md hover:bg-surface-hover focus-ring",
                active && "bg-surface-hover",
              )}
              aria-label={`${t("reader.highlightColor")} ${c}`}
              aria-pressed={active}
            >
              <span
                className={cn(
                  "size-3.5 rounded-full ring-1 ring-black/10",
                  `hl-${c}`,
                  active && "ring-2 ring-accent",
                )}
              />
            </button>
          );
        })}
        <div className="flex-1" />
        <Separator vertical className="mx-0.5" />
        <Tooltip content={t("reader.deleteHighlight")}>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-danger hover:text-danger"
            onClick={remove}
            aria-label={t("reader.deleteHighlight")}
          >
            <Trash2 />
          </Button>
        </Tooltip>
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={saveNote}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) close.current();
        }}
        placeholder={t("reader.notePlaceholder")}
        aria-label={t("reader.annotate")}
        className="mt-1 h-16 w-full resize-none rounded-md bg-surface-sunken p-2 text-[13px] outline-none"
      />
    </div>
  );
}
