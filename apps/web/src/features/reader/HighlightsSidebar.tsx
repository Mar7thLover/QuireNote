import type { SourceContent } from "@folio/core";
import { Button, cn, EmptyState } from "@folio/ui";
import { Highlighter, Sparkles, Trash2 } from "lucide-react";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api";
import { qk, queryClient } from "@/lib/query";
import { useWorkspace } from "@/stores/workspace";

export function HighlightsSidebar({
  sourceId,
  content,
  summary,
}: {
  sourceId: string;
  content: SourceContent;
  summary: string;
}) {
  const { t } = useTranslation();
  const jumpTo = useWorkspace((s) => s.jumpTo);
  const list = [...content.highlights].sort((a, b) => a.start - b.start);

  const remove = async (hid: string) => {
    queryClient.setQueryData<SourceContent>(qk.content(sourceId), (old) =>
      old ? { ...old, highlights: old.highlights.filter((h) => h.id !== hid) } : old,
    );
    await api.sources.removeHighlight(sourceId, hid);
  };

  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-border bg-bg-subtle/60 animate-fade">
      {summary ? (
        <section className="border-b border-border p-3.5">
          <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-fg-subtle">
            <Sparkles className="size-3.5 text-accent" />
            {t("reader.summary")}
          </h4>
          <p className="text-[13px] leading-relaxed text-fg-muted">{summary}</p>
        </section>
      ) : null}
      <section className="p-2">
        <h4 className="px-1.5 pt-1 pb-2 text-xs font-semibold text-fg-subtle">{t("reader.highlights")}</h4>
        {list.length === 0 ? (
          <EmptyState
            icon={<Highlighter />}
            title="—"
            description="选中文字后点击颜色即可高亮，或使用 AI 标注重点。"
          />
        ) : (
          list.map((h) => (
            <div key={h.id} className="group relative mb-1 rounded-md p-2 hover:bg-surface-hover">
              <button
                type="button"
                className="block w-full text-left"
                onClick={() => jumpTo(sourceId, h.start, h.end)}
              >
                <p className="line-clamp-3 font-serif text-[13px] leading-relaxed">
                  <span className={cn("rounded-sm", h.by === "ai" ? "hl-ai" : `hl-${h.color}`)}>
                    {content.text.slice(h.start, h.end)}
                  </span>
                </p>
                {h.note ? <p className="mt-1 text-xs text-fg-muted">✎ {h.note}</p> : null}
                {h.by === "ai" ? <p className="mt-1 text-[11px] text-accent">AI</p> : null}
              </button>
              <Button
                variant="ghost"
                size="icon-xs"
                className="absolute top-1 right-1 opacity-0 group-hover:opacity-100"
                onClick={() => remove(h.id)}
                aria-label={t("common.delete")}
              >
                <Trash2 />
              </Button>
            </div>
          ))
        )}
      </section>
    </aside>
  );
}
