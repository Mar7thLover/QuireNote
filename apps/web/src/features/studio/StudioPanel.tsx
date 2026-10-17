import { ARTIFACT_KIND_META, type Artifact, type ArtifactKind } from "@quirenote/core";
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  cn,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Spinner,
  Textarea,
} from "@quirenote/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, BookOpen, ChevronRight, Sparkles, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { PanelShell } from "@/components/Panel";
import { useNotebookHasNotes } from "@/features/lorebook/useBackground";
import { useSelectedSourceIds } from "@/features/sources/hooks";
import { currentLang, useTranslation } from "@/i18n";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { Icon } from "@/lib/icons";
import { useAssignments, useProviders } from "@/lib/models";
import { qk, queryClient, removeFromList, upsertInList } from "@/lib/query";
import { type Tint, tintBg, tintInk } from "@/lib/tints";
import { useWorkspace } from "@/stores/workspace";

type Group = "text" | "learn" | "visual" | "media";
const GROUPS: Group[] = ["text", "learn", "visual", "media"];

/** 每组一种插画底色（与首页卡片同一组颜色），只用在图标底色和插画区。 */
const GROUP_TINT: Record<Group, Tint> = { text: "sand", learn: "sage", visual: "blue", media: "clay" };
const groupBg = (g: Group) => tintBg(GROUP_TINT[g]);

const FEATURED: ArtifactKind[] = ["report", "mindmap", "audio"];
const KINDS = Object.keys(ARTIFACT_KIND_META) as ArtifactKind[];

const label = (k: ArtifactKind) =>
  currentLang() === "en" ? ARTIFACT_KIND_META[k].labelEn : ARTIFACT_KIND_META[k].label;

/** 生成方式的说明标签：音频是合成还是系统语音、配图由谁来画等，都按当前配置如实显示。 */
function useKindTags(): (k: ArtifactKind) => string[] {
  const { t } = useTranslation();
  const assignments = useAssignments();
  const providers = useProviders();
  const has = (cap: string) => assignments.data?.find((a) => a.capability === cap);
  return (k) => {
    switch (k) {
      case "report":
      case "briefing":
      case "faq":
      case "study_guide":
        return [t("studio.tag_cited"), t("studio.tag_editable")];
      case "flashcards":
      case "quiz":
        return [t("studio.tag_review")];
      case "audio":
        return [has("tts") ? t("studio.tag_tts") : t("studio.tag_systemVoice")];
      case "image": {
        const a = has("image");
        if (!a) return [t("studio.tag_needsImage")];
        const kind = providers.data?.find((p) => p.id === a.providerId)?.kind ?? "";
        return [kind.startsWith("anthropic") ? t("studio.tag_svg") : t("studio.tag_imageModel")];
      }
      case "video":
        return [t("studio.tag_ffmpeg")];
      default:
        return [t("studio.tag_editable")];
    }
  };
}

export function StudioPanel({ notebookId }: { notebookId: string }) {
  const { t } = useTranslation();
  const sourceIds = useSelectedSourceIds(notebookId);
  const hasNotes = useNotebookHasNotes(notebookId);
  const tagsOf = useKindTags();
  const artifacts = useQuery({
    queryKey: qk.artifacts(notebookId),
    queryFn: () => api.artifacts.list(notebookId),
    refetchInterval: (q) =>
      q.state.data?.some((a) => a.status === "generating" || a.status === "pending") ? 4000 : false,
  });
  const list = [...(artifacts.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <PanelShell>
      <div className="@container h-full overflow-y-auto">
        <div className="mx-auto flex max-w-[880px] flex-col gap-6 px-4 pt-4 pb-8">
          <p
            className={cn(
              "flex items-center gap-2 text-[13px]",
              sourceIds.length || hasNotes ? "text-fg-subtle" : "text-warning",
            )}
          >
            <BookOpen className="size-4 shrink-0" strokeWidth={1.6} />
            {sourceIds.length
              ? t(hasNotes ? "studio.scopeWithNotes" : "studio.scope", { count: sourceIds.length })
              : hasNotes
                ? t("studio.scopeNotes")
                : t("studio.scopeNone")}
          </p>

          <section className="flex flex-col gap-2.5">
            <h3 className="text-[13px] font-medium text-fg-muted">{t("studio.featured")}</h3>
            <div className="grid grid-cols-1 gap-2.5 @[480px]:grid-cols-3">
              {FEATURED.map((k) => (
                <Generate key={k} kind={k} notebookId={notebookId} sourceIds={sourceIds} card>
                  <FeaturedCard kind={k} tags={tagsOf(k)} />
                </Generate>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-2.5">
            <h3 className="text-[13px] font-medium text-fg-muted">{t("studio.all")}</h3>
            <div className="overflow-hidden rounded-xl border border-border bg-surface">
              {GROUPS.map((g, gi) => (
                <div key={g} className={cn(gi > 0 && "border-t border-border")}>
                  <p className="px-3.5 pt-3 pb-1 text-[12px] text-fg-subtle">{t(`studio.group_${g}`)}</p>
                  <div className="grid grid-cols-1 px-1.5 pb-1.5 @[560px]:grid-cols-2">
                    {KINDS.filter((k) => ARTIFACT_KIND_META[k].group === g).map((k) => (
                      <Generate key={k} kind={k} notebookId={notebookId} sourceIds={sourceIds}>
                        <KindRow kind={k} tags={tagsOf(k)} />
                      </Generate>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-2.5">
            <h3 className="text-[13px] font-medium text-fg-muted">{t("studio.history")}</h3>
            {list.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-[13px] leading-relaxed text-fg-subtle">
                {t("studio.emptyDesc")}
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {list.map((a) => (
                  <ArtifactRow key={a.id} artifact={a} notebookId={notebookId} />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </PanelShell>
  );
}

/** 常用生成物：插画区 + 名称 + 一句说明 + 标签，和首页的卡片同一种节奏。 */
function FeaturedCard({ kind, tags }: { kind: ArtifactKind; tags: string[] }) {
  const { t } = useTranslation();
  const meta = ARTIFACT_KIND_META[kind];
  const g = meta.group as Group;
  return (
    <>
      <div
        aria-hidden
        className="grid w-[76px] shrink-0 place-items-center @[480px]:h-[84px] @[480px]:w-auto"
        style={{ background: groupBg(g) }}
      >
        <Icon
          name={meta.icon}
          className="size-7 transition-transform duration-200 ease-out group-hover:scale-105 @[480px]:size-9"
          strokeWidth={1.2}
          style={{ color: tintInk }}
        />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3.5">
        <span className="text-[14.5px] font-medium">{label(kind)}</span>
        <span className="line-clamp-2 text-[12.5px] leading-relaxed text-fg-subtle">
          {t(`studio.desc_${kind}`)}
        </span>
        <span className="mt-auto flex flex-wrap gap-1 pt-1">
          {tags.map((tag) => (
            <span
              key={tag}
              className="rounded-md bg-surface-sunken px-1.5 py-0.5 text-[11.5px] text-fg-muted"
            >
              {tag}
            </span>
          ))}
        </span>
      </div>
    </>
  );
}

function KindRow({ kind, tags }: { kind: ArtifactKind; tags: string[] }) {
  const { t } = useTranslation();
  const meta = ARTIFACT_KIND_META[kind];
  const g = meta.group as Group;
  return (
    <>
      <span
        className="grid size-9 shrink-0 place-items-center rounded-lg"
        style={{ background: groupBg(g), color: tintInk }}
      >
        <Icon name={meta.icon} className="size-[18px]" strokeWidth={1.5} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2">
          <span className="truncate text-[13.5px] font-medium">{label(kind)}</span>
          {tags[0] && ["audio", "image", "video"].includes(kind) ? (
            <span className="shrink-0 rounded bg-surface-sunken px-1.5 text-[11px] leading-5 text-fg-subtle">
              {tags[0]}
            </span>
          ) : null}
        </span>
        <span className="truncate text-[12.5px] text-fg-subtle">{t(`studio.desc_${kind}`)}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100" />
    </>
  );
}

/** 点击任意生成物入口：弹出补充要求，再生成。卡片和列表行共用。 */
function Generate({
  kind,
  notebookId,
  sourceIds,
  card,
  children,
}: {
  kind: ArtifactKind;
  notebookId: string;
  sourceIds: string[];
  /** 卡片样式（常用区）；否则是列表行。 */
  card?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [instructions, setInstructions] = useState("");
  const gen = useMutation({
    mutationFn: () =>
      api.artifacts.create(notebookId, { kind, sourceIds, instructions: instructions.trim() || undefined }),
    onSuccess: (a) => {
      upsertInList(qk.artifacts(notebookId), a);
      setOpen(false);
      setInstructions("");
      useWorkspace.getState().open({ kind: "artifact", id: a.id, title: a.title });
    },
  });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "group text-left focus-ring",
            card
              ? "flex overflow-hidden rounded-xl border border-border bg-surface transition-colors hover:border-border-strong data-[state=open]:border-border-strong @[480px]:flex-col"
              : "flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-surface-hover data-[state=open]:bg-surface-hover",
          )}
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            gen.mutate();
          }}
          className="space-y-3"
        >
          <div className="space-y-1">
            <span className="text-sm font-medium">{label(kind)}</span>
            <p className="text-[12.5px] leading-relaxed text-fg-subtle">{t(`studio.desc_${kind}`)}</p>
          </div>
          <Textarea
            autoFocus
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder={t("studio.instructionsPlaceholder")}
            aria-label={t("studio.instructions")}
            rows={3}
            className="text-[13px]"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) gen.mutate();
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <span className={cn("text-xs", sourceIds.length ? "text-fg-subtle" : "text-danger")}>
              {t("studio.basedOn", { count: sourceIds.length })}
            </span>
            <Button
              type="submit"
              size="sm"
              variant="primary"
              loading={gen.isPending}
              disabled={!sourceIds.length}
            >
              <Sparkles />
              {t("studio.generate")}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function ArtifactRow({ artifact: a, notebookId }: { artifact: Artifact; notebookId: string }) {
  const { t } = useTranslation();
  const meta = ARTIFACT_KIND_META[a.kind];
  const g = meta.group as Group;
  const busy = a.status === "generating" || a.status === "pending";
  const remove = useMutation({
    mutationFn: () => api.artifacts.remove(a.id),
    onMutate: () => {
      removeFromList(qk.artifacts(notebookId), a.id);
      useWorkspace.getState().close({ kind: "artifact", id: a.id });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.artifacts(notebookId) }),
  });
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          onClick={() => useWorkspace.getState().open({ kind: "artifact", id: a.id, title: a.title })}
          className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-hover focus-ring"
        >
          <span
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-lg",
              a.status === "error" && "bg-danger-soft text-danger",
            )}
            style={a.status === "error" ? undefined : { background: groupBg(g), color: tintInk }}
          >
            {busy ? (
              <Spinner className="size-3.5" />
            ) : a.status === "error" ? (
              <AlertCircle className="size-4" />
            ) : (
              <Icon name={meta.icon} className="size-[18px]" strokeWidth={1.5} />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-medium">{a.title}</span>
            <span className="block truncate text-[12px] text-fg-subtle">
              {busy
                ? t("studio.generating")
                : a.status === "error"
                  ? a.error
                  : `${label(a.kind)} · ${relativeTime(a.updatedAt)}`}
            </span>
          </span>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem danger onSelect={() => confirm(t("studio.deleteConfirm")) && remove.mutate()}>
          <Trash2 />
          {t("common.delete")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
