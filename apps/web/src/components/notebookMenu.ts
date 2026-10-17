import type { Notebook } from "@quirenote/core";
import { toast } from "@quirenote/ui";
import {
  BookOpen,
  Download,
  ExternalLink,
  LayoutTemplate,
  Pencil,
  Pin,
  PinOff,
  Share2,
  Trash2,
} from "lucide-react";
import i18n from "@/i18n";
import { api } from "@/lib/api";
import type { MenuSection } from "@/lib/contextMenu";
import { qk, queryClient, removeFromList, upsertInList } from "@/lib/query";
import { useUi } from "@/stores/ui";

async function updateNotebook(nb: Notebook, patch: { pinned?: boolean; title?: string }) {
  upsertInList(qk.notebooks, { ...nb, ...patch });
  try {
    const next = await api.notebooks.update(nb.id, patch);
    upsertInList(qk.notebooks, next);
    queryClient.setQueryData(qk.notebook(nb.id), next);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    queryClient.invalidateQueries({ queryKey: qk.notebooks });
  }
}

/**
 * 一本 Notebook 的菜单：首页卡片的右键与「…」、侧栏里的 Notebook 共用。
 * open 由调用方传入（路由跳转）；onDeleted 用于删掉当前所在的 Notebook 后离开工作区。
 */
export function notebookSections(
  nb: Notebook,
  opts: { open?: () => void; onDeleted?: () => void } = {},
): MenuSection[] {
  const t = i18n.t.bind(i18n);
  return [
    [
      ...(opts.open ? [{ id: "nb.open", label: t("common.open"), icon: BookOpen, onSelect: opts.open }] : []),
      {
        id: "nb.newTab",
        label: t("menu.openInNewTab"),
        icon: ExternalLink,
        onSelect: () => window.open(`/n/${nb.id}`, "_blank", "noopener"),
      },
    ],
    [
      {
        id: "nb.rename",
        label: t("common.rename"),
        icon: Pencil,
        onSelect: () => {
          const title = prompt(t("common.rename"), nb.title)?.trim();
          if (title && title !== nb.title) void updateNotebook(nb, { title });
        },
      },
      {
        id: "nb.pin",
        label: nb.pinned ? t("home.unpin") : t("home.pin"),
        icon: nb.pinned ? PinOff : Pin,
        onSelect: () => void updateNotebook(nb, { pinned: !nb.pinned }),
      },
    ],
    [
      {
        id: "nb.export",
        label: t("common.export"),
        icon: Download,
        onSelect: () => window.open(api.notebooks.exportUrl(nb.id)),
      },
      {
        id: "nb.share",
        label: t("cards.menuShare"),
        icon: Share2,
        onSelect: () => useUi.getState().set({ shareCard: { kind: "notebook", id: nb.id, name: nb.title } }),
      },
      {
        id: "nb.template",
        label: t("templates.saveAsTemplate"),
        icon: LayoutTemplate,
        onSelect: () =>
          api.notebookTemplates
            .saveFrom(nb.id)
            .then((tpl) => {
              queryClient.invalidateQueries({ queryKey: ["notebookTemplates"] });
              toast.success(t("templates.savedNotebook", { name: tpl.name }));
            })
            .catch((e: Error) => toast.error(e.message)),
      },
    ],
    [
      {
        id: "nb.delete",
        label: t("common.delete"),
        icon: Trash2,
        danger: true,
        onSelect: () => {
          if (!confirm(t("home.deleteConfirm", { title: nb.title }))) return;
          removeFromList(qk.notebooks, nb.id);
          api.notebooks
            .remove(nb.id)
            .then(() => {
              toast.success(t("common.delete"));
              opts.onDeleted?.();
            })
            .catch((e: Error) => toast.error(e.message))
            .finally(() => queryClient.invalidateQueries({ queryKey: qk.notebooks }));
        },
      },
    ],
  ];
}
