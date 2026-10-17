import type { Source } from "@quirenote/core";
import { toast } from "@quirenote/ui";
import {
  BookOpen,
  CheckSquare,
  Download,
  ExternalLink,
  Link2,
  ListChecks,
  MessageSquareQuote,
  Pencil,
  Sparkles,
  Trash2,
} from "lucide-react";
import i18n from "@/i18n";
import { api } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import type { MenuSection } from "@/lib/contextMenu";
import { qk, queryClient, removeFromList, upsertInList } from "@/lib/query";
import { useWorkspace } from "@/stores/workspace";

/** 乐观更新一份资料，失败时回滚。 */
async function patchSource(nb: string, s: Source, patch: Partial<Pick<Source, "title" | "selected">>) {
  const prev = queryClient.getQueryData<Source[]>(qk.sources(nb));
  upsertInList(qk.sources(nb), { ...s, ...patch });
  try {
    await api.sources.update(s.id, patch);
  } catch (e) {
    if (prev) queryClient.setQueryData(qk.sources(nb), prev);
    toast.error((e as Error).message);
  }
}

/** 资料列表里一份资料的右键菜单。 */
export function sourceSections(nb: string, s: Source): MenuSection[] {
  const t = i18n.t.bind(i18n);
  const ready = s.status === "ready";
  const others = () =>
    (queryClient.getQueryData<Source[]>(qk.sources(nb)) ?? []).filter(
      (x) => x.id !== s.id && x.status === "ready" && x.selected,
    );
  return [
    [
      {
        id: "src.open",
        label: t("common.open"),
        icon: BookOpen,
        onSelect: () => useWorkspace.getState().open({ kind: "reader", id: s.id, title: s.title }),
      },
      {
        id: "src.ask",
        label: t("menu.askSource"),
        icon: MessageSquareQuote,
        disabled: !ready,
        onSelect: () =>
          useWorkspace.getState().open({ kind: "chat", title: t("nav.chat"), extra: { onlySource: s.id } }),
      },
    ],
    [
      {
        id: "src.use",
        label: t("menu.useSource"),
        icon: CheckSquare,
        checked: ready && s.selected,
        disabled: !ready,
        onSelect: () => void patchSource(nb, s, { selected: !s.selected }),
      },
      {
        id: "src.only",
        label: t("menu.onlyThis"),
        icon: ListChecks,
        disabled: !ready,
        onSelect: () => {
          for (const x of others()) void patchSource(nb, x, { selected: false });
          if (!s.selected) void patchSource(nb, s, { selected: true });
        },
      },
      {
        id: "src.auto",
        label: t("reader.autoHighlight"),
        icon: Sparkles,
        disabled: !ready,
        onSelect: () =>
          api.sources
            .autoHighlight(s.id)
            .then(() => toast(t("reader.autoHighlight"), { description: t("sources.status_processing") }))
            .catch((e: Error) => toast.error(e.message)),
      },
    ],
    [
      ...(s.url
        ? [
            {
              id: "src.page",
              label: t("menu.openPage"),
              icon: ExternalLink,
              onSelect: () => window.open(s.url!, "_blank", "noopener"),
            },
            {
              id: "src.copyUrl",
              label: t("menu.copyLink"),
              icon: Link2,
              onSelect: () => copyText(s.url!, true),
            },
          ]
        : []),
      ...(s.hasFile
        ? [
            {
              id: "src.file",
              label: t("menu.downloadFile"),
              icon: Download,
              onSelect: () => window.open(api.sources.fileUrl(s.id)),
            },
          ]
        : []),
      {
        id: "src.rename",
        label: t("common.rename"),
        icon: Pencil,
        onSelect: () => {
          const title = prompt(t("common.rename"), s.title)?.trim();
          if (title && title !== s.title) void patchSource(nb, s, { title });
        },
      },
    ],
    [
      {
        id: "src.delete",
        label: t("common.delete"),
        icon: Trash2,
        danger: true,
        onSelect: () => {
          if (!confirm(t("sources.deleteConfirm"))) return;
          removeFromList(qk.sources(nb), s.id);
          useWorkspace.getState().close({ kind: "reader", id: s.id });
          api.sources
            .remove(s.id)
            .catch((e: Error) => toast.error(e.message))
            .finally(() => queryClient.invalidateQueries({ queryKey: qk.sources(nb) }));
        },
      },
    ],
  ];
}
