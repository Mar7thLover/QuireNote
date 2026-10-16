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
import { AlertCircle, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { PanelShell, PanelTitle } from "@/components/Panel";
import { useSelectedSourceIds } from "@/features/sources/hooks";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { Icon } from "@/lib/icons";
import { qk, queryClient, removeFromList, upsertInList } from "@/lib/query";
import { useWorkspace } from "@/stores/workspace";

const GROUPS = ["text", "learn", "visual", "media"] as const;

/** 每类生成物的卡片色调，让入口一眼可辨。 */
const HUE: Record<string, number> = { text: 272, learn: 152, visual: 30, media: 340 };

export function StudioPanel({ notebookId }: { notebookId: string }) {
  const { t } = useTranslation();
  const artifacts = useQuery({
    queryKey: qk.artifacts(notebookId),
    queryFn: () => api.artifacts.list(notebookId),
    refetchInterval: (q) =>
      q.state.data?.some((a) => a.status === "generating" || a.status === "pending") ? 4000 : false,
  });
  const list = [...(artifacts.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <PanelShell toolbar={<PanelTitle count={list.length}>{t("studio.title")}</PanelTitle>}>
      <div className="@container h-full overflow-y-auto">
        <div className="space-y-4 p-3">
          {GROUPS.map((g) => (
            <section key={g}>
              <h3 className="mb-1.5 px-0.5 text-[11px] font-semibold tracking-wide text-fg-subtle">
                {t(`studio.group_${g}`)}
              </h3>
              <div className="grid grid-cols-2 gap-1.5 @[420px]:grid-cols-3">
                {(Object.keys(ARTIFACT_KIND_META) as ArtifactKind[])
                  .filter((k) => ARTIFACT_KIND_META[k].group === g)
                  .map((k) => (
                    <GenerateTile key={k} kind={k} notebookId={notebookId} hue={HUE[g]!} />
                  ))}
              </div>
            </section>
          ))}
        </div>
        <div className="border-t border-border p-3">
          <h3 className="mb-2 px-0.5 text-[11px] font-semibold tracking-wide text-fg-subtle">生成记录</h3>
          {list.length === 0 ? (
            <p className="px-1 py-6 text-center text-[13px] leading-relaxed text-fg-subtle">
              {t("studio.emptyDesc")}
            </p>
          ) : (
            <div className="space-y-1">
              {list.map((a) => (
                <ArtifactRow key={a.id} artifact={a} notebookId={notebookId} />
              ))}
            </div>
          )}
        </div>
      </div>
    </PanelShell>
  );
}

function GenerateTile({ kind, notebookId, hue }: { kind: ArtifactKind; notebookId: string; hue: number }) {
  const { t } = useTranslation();
  const meta = ARTIFACT_KIND_META[kind];
  const sourceIds = useSelectedSourceIds(notebookId);
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
          className="group flex h-[52px] items-center gap-2 rounded-lg border border-border bg-surface px-2.5 text-left transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:border-border-strong hover:shadow-sm focus-ring data-[state=open]:border-accent"
        >
          <span
            className="grid size-7 shrink-0 place-items-center rounded-md transition-transform group-hover:scale-105"
            style={{ background: `oklch(0.94 0.04 ${hue} / 0.9)`, color: `oklch(0.48 0.13 ${hue})` }}
          >
            <Icon name={meta.icon} className="size-4" />
          </span>
          <span className="truncate text-[13px] font-medium">{meta.label}</span>
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
          <div className="flex items-center gap-2">
            <Icon name={meta.icon} className="size-4 text-accent" />
            <span className="text-sm font-semibold">{meta.label}</span>
          </div>
          <Textarea
            autoFocus
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder={t("studio.instructionsPlaceholder")}
            rows={3}
            className="text-[13px]"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) gen.mutate();
            }}
          />
          <div className="flex items-center justify-between">
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
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-hover focus-ring"
        >
          <span
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-md bg-surface-sunken text-fg-muted",
              a.status === "error" && "bg-danger-soft text-danger",
            )}
          >
            {busy ? (
              <Spinner className="size-3.5 text-accent" />
            ) : a.status === "error" ? (
              <AlertCircle className="size-4" />
            ) : (
              <Icon name={meta.icon} className="size-4" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">{a.title}</span>
            <span className="block truncate text-[11.5px] text-fg-subtle">
              {busy
                ? t("studio.generating")
                : a.status === "error"
                  ? a.error
                  : `${meta.label} · ${relativeTime(a.updatedAt)}`}
            </span>
          </span>
          {busy ? (
            <span className="h-1 w-10 overflow-hidden rounded-full bg-surface-sunken">
              <span className="skeleton block h-full w-full" />
            </span>
          ) : null}
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
