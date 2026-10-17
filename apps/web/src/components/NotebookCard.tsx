import type { Notebook } from "@quirenote/core";
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  tagColor,
  toast,
} from "@quirenote/ui";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Download, LayoutTemplate, MoreHorizontal, Pin, PinOff, Share2, Trash2 } from "lucide-react";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { qk, queryClient, removeFromList, upsertInList } from "@/lib/query";
import { useUi } from "@/stores/ui";

/** 首页的 Notebook 卡片：色带、标题、简介、资料与笔记数；右键或「…」可置顶、导出、删除。 */
export function NotebookCard({ nb }: { nb: Notebook }) {
  const { t } = useTranslation();
  const color = tagColor(nb.color);

  const update = useMutation({
    mutationFn: (patch: { pinned?: boolean }) => api.notebooks.update(nb.id, patch),
    onMutate: (patch) => upsertInList(qk.notebooks, { ...nb, ...patch }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.notebooks }),
  });
  const remove = useMutation({
    mutationFn: () => api.notebooks.remove(nb.id),
    onMutate: () => removeFromList(qk.notebooks, nb.id),
    onSuccess: () => toast.success(t("common.delete")),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.notebooks }),
  });
  const onDelete = () => {
    if (confirm(t("home.deleteConfirm", { title: nb.title }))) remove.mutate();
  };

  const menu = (
    Item: typeof DropdownMenuItem | typeof ContextMenuItem,
    Sep: typeof DropdownMenuSeparator | typeof ContextMenuSeparator,
  ) => (
    <>
      <Item onSelect={() => update.mutate({ pinned: !nb.pinned })}>
        {nb.pinned ? <PinOff /> : <Pin />}
        {nb.pinned ? t("home.unpin") : t("home.pin")}
      </Item>
      <Item onSelect={() => window.open(api.notebooks.exportUrl(nb.id))}>
        <Download />
        {t("common.export")}
      </Item>
      <Item
        onSelect={() => useUi.getState().set({ shareCard: { kind: "notebook", id: nb.id, name: nb.title } })}
      >
        <Share2 />
        {t("cards.menuShare")}
      </Item>
      <Item
        onSelect={() =>
          api.notebookTemplates
            .saveFrom(nb.id)
            .then((tpl) => {
              queryClient.invalidateQueries({ queryKey: ["notebookTemplates"] });
              toast.success(t("templates.savedNotebook", { name: tpl.name }));
            })
            .catch((e: Error) => toast.error(e.message))
        }
      >
        <LayoutTemplate />
        {t("templates.saveAsTemplate")}
      </Item>
      <Sep />
      <Item danger onSelect={onDelete}>
        <Trash2 />
        {t("common.delete")}
      </Item>
    </>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Link
          to="/n/$notebookId"
          params={{ notebookId: nb.id }}
          className="group flex min-h-44 flex-col overflow-hidden rounded-xl border border-border bg-surface transition-colors hover:border-border-strong focus-ring"
        >
          {/* 色带取 Notebook 自己的颜色，低饱和，只做区分 */}
          <div
            aria-hidden
            className="h-14 shrink-0"
            style={{ background: `color-mix(in srgb, ${color} 22%, var(--surface-sunken))` }}
          />
          <div className="flex flex-1 flex-col gap-1.5 p-4">
            <div className="flex items-start gap-2">
              <h3 className="min-w-0 flex-1 truncate text-[15.5px] font-medium">{nb.title}</h3>
              {nb.pinned ? <Pin className="mt-1 size-3.5 shrink-0 text-fg-subtle" /> : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="-mt-0.5 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 focus-visible:opacity-100"
                    onClick={(e) => e.preventDefault()}
                    aria-label={t("common.more")}
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                  {menu(DropdownMenuItem, DropdownMenuSeparator)}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {nb.description ? (
              <p className="line-clamp-2 text-[13.5px] leading-relaxed text-fg-subtle">{nb.description}</p>
            ) : null}
            <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2">
              <span className="rounded-md bg-surface-sunken px-2 py-0.5 text-[12.5px] text-fg-muted">
                {t("home.sources", { count: nb.stats?.sources ?? 0 })}
              </span>
              <span className="rounded-md bg-surface-sunken px-2 py-0.5 text-[12.5px] text-fg-muted">
                {t("home.notes", { count: nb.stats?.notes ?? 0 })}
              </span>
              <span className="ml-auto text-[12.5px] text-fg-subtle">{relativeTime(nb.updatedAt)}</span>
            </div>
          </div>
        </Link>
      </ContextMenuTrigger>
      <ContextMenuContent>{menu(ContextMenuItem, ContextMenuSeparator)}</ContextMenuContent>
    </ContextMenu>
  );
}
