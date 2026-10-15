import { ELEMENT_TYPE_META, type Element } from "@folio/core";
import { Button, Tag, Textarea, toast } from "@folio/ui";
import { useMutation } from "@tanstack/react-query";
import { FileText, Layers, MessageCircleQuestion, Sparkles, Trash2, X } from "lucide-react";
import { useSources } from "@/features/sources/hooks";
import { useTranslation } from "@/i18n";
import { useChatDraft } from "@/lib/ai";
import { api } from "@/lib/api";
import { qk, queryClient, removeFromList, upsertInList } from "@/lib/query";
import { useWorkspace } from "@/stores/workspace";
import { MasteryBar } from "./ElementsPanel";

export function ElementDetail({
  el,
  notebookId,
  all,
  onClose,
}: {
  el: Element;
  notebookId: string;
  all: Element[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const sources = useSources(notebookId);
  const jumpTo = useWorkspace((s) => s.jumpTo);
  const meta = ELEMENT_TYPE_META[el.type];

  const update = useMutation({
    mutationFn: (patch: Partial<Element>) => api.elements.update(el.id, patch),
    onSuccess: (x) => upsertInList(qk.elements(notebookId), x),
  });
  const enrich = useMutation({
    mutationFn: () => api.elements.enrich(el.id),
    onSuccess: (x) => upsertInList(qk.elements(notebookId), x),
  });
  const cards = useMutation({
    mutationFn: () => api.elements.cards(notebookId, [el.id]),
    onSuccess: (r) => {
      toast.success(t("studio.addedToReview", { count: r.length }));
      queryClient.invalidateQueries({ queryKey: qk.review(notebookId) });
    },
  });
  const remove = useMutation({
    mutationFn: () => api.elements.remove(el.id),
    onMutate: () => {
      removeFromList(qk.elements(notebookId), el.id);
      onClose();
    },
  });

  const ask = () => {
    useChatDraft.getState().send({ text: `关于「${el.name}」，请进一步解释：` });
    useWorkspace.getState().open({ kind: "chat", title: t("nav.chat") });
  };

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-bg-subtle/50 animate-fade">
      <div className="flex items-start gap-2 border-b border-border p-3.5">
        <div className="min-w-0 flex-1">
          <Tag color={meta.color}>{meta.label}</Tag>
          <h3 className="mt-1.5 text-[17px] font-semibold leading-snug">{el.name}</h3>
          {el.aliases.length ? (
            <p className="mt-0.5 text-xs text-fg-subtle">{el.aliases.join(" · ")}</p>
          ) : null}
        </div>
        <Button size="icon-xs" variant="ghost" onClick={onClose} aria-label={t("common.close")}>
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3.5">
        <section>
          <h4 className="mb-1.5 text-[11px] font-semibold text-fg-subtle">{t("elements.definition")}</h4>
          <Textarea
            key={el.updatedAt}
            defaultValue={el.definition}
            onBlur={(e) => e.target.value !== el.definition && update.mutate({ definition: e.target.value })}
            rows={4}
            className="bg-surface font-serif text-[14px]"
          />
        </section>
        <section>
          <h4 className="mb-1.5 text-[11px] font-semibold text-fg-subtle">{t("elements.mastery")}</h4>
          <MasteryBar value={el.mastery} />
        </section>
        {el.relations.length ? (
          <section>
            <h4 className="mb-1.5 text-[11px] font-semibold text-fg-subtle">{t("elements.relations")}</h4>
            <ul className="space-y-1">
              {el.relations.map((r) => {
                const target = all.find((x) => x.id === r.targetId);
                return target ? (
                  <li key={r.targetId} className="text-[13px]">
                    <span className="text-fg-subtle">{r.label} → </span>
                    {target.name}
                  </li>
                ) : null;
              })}
            </ul>
          </section>
        ) : null}
        <section>
          <h4 className="mb-1.5 text-[11px] font-semibold text-fg-subtle">
            {t("elements.refs")} · {el.refs.length}
          </h4>
          <div className="space-y-1.5">
            {el.refs.map((r, i) => {
              const src = sources.data?.find((s) => s.id === r.sourceId);
              return (
                <button
                  key={i}
                  type="button"
                  disabled={!r.sourceId}
                  onClick={async () => {
                    if (!r.sourceId) return;
                    // 通过片段 id 找到原文偏移
                    const chunks = await queryClient.fetchQuery({
                      queryKey: ["chunks", r.sourceId],
                      queryFn: () => api.sources.chunks(r.sourceId!),
                    });
                    const c = chunks.find((x) => x.id === r.chunkId);
                    const idx = c ? c.text.indexOf(r.quote.slice(0, 20)) : -1;
                    const start = c ? c.start + Math.max(0, idx) : 0;
                    jumpTo(
                      r.sourceId,
                      start,
                      start + (idx >= 0 ? r.quote.length : (c?.end ?? 0) - (c?.start ?? 0)),
                    );
                  }}
                  className="block w-full rounded-lg border border-border bg-surface p-2.5 text-left transition-colors hover:border-accent/50 focus-ring"
                >
                  <span className="flex items-center gap-1 text-[11px] text-fg-subtle">
                    <FileText className="size-3" />
                    {src?.title ?? "对话 / 笔记"}
                  </span>
                  <span className="mt-1 line-clamp-3 block font-serif text-[13px] leading-relaxed">
                    {r.quote}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
      <div className="grid grid-cols-2 gap-1.5 border-t border-border p-2.5">
        <Button size="sm" variant="secondary" onClick={() => enrich.mutate()} loading={enrich.isPending}>
          <Sparkles />
          {t("elements.enrich")}
        </Button>
        <Button size="sm" variant="secondary" onClick={ask}>
          <MessageCircleQuestion />
          {t("elements.askAbout")}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => cards.mutate()} loading={cards.isPending}>
          <Layers />
          {t("elements.makeCards")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-danger"
          onClick={() => confirm(`删除「${el.name}」？`) && remove.mutate()}
        >
          <Trash2 />
          {t("common.delete")}
        </Button>
      </div>
    </aside>
  );
}
