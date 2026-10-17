import type { Element } from "@quirenote/core";
import { toast } from "@quirenote/ui";
import { CheckSquare, Layers, MessageCircleQuestion, PanelRight, Sparkles, Trash2 } from "lucide-react";
import i18n from "@/i18n";
import { api } from "@/lib/api";
import type { MenuSection } from "@/lib/contextMenu";
import { qk, queryClient, removeFromList, upsertInList } from "@/lib/query";
import { draftQuestion } from "@/lib/workspaceActions";

/** 一个元素的右键菜单：列表行和关系图节点共用。 */
export function elementSections(
  nb: string,
  el: Element,
  opts: { open: () => void; selected: boolean; toggle: () => void; onDeleted?: () => void },
): MenuSection[] {
  const t = i18n.t.bind(i18n);
  return [
    [
      { id: "el.open", label: t("menu.viewDetails"), icon: PanelRight, onSelect: opts.open },
      {
        id: "el.ask",
        label: t("elements.askAbout"),
        icon: MessageCircleQuestion,
        onSelect: () => draftQuestion(t("menu.askAboutElementPrompt", { name: el.name })),
      },
    ],
    [
      {
        id: "el.enrich",
        label: t("elements.enrich"),
        icon: Sparkles,
        onSelect: () =>
          api.elements
            .enrich(el.id)
            .then((x) => upsertInList(qk.elements(nb), x))
            .catch((e: Error) => toast.error(e.message)),
      },
      {
        id: "el.cards",
        label: t("elements.makeCards"),
        icon: Layers,
        onSelect: () =>
          api.elements
            .cards(nb, [el.id])
            .then((r) => {
              toast.success(t("studio.addedToReview", { count: r.length }));
              queryClient.invalidateQueries({ queryKey: qk.review(nb) });
            })
            .catch((e: Error) => toast.error(e.message)),
      },
      {
        id: "el.select",
        label: t("menu.select"),
        icon: CheckSquare,
        checked: opts.selected,
        onSelect: opts.toggle,
      },
    ],
    [
      {
        id: "el.delete",
        label: t("common.delete"),
        icon: Trash2,
        danger: true,
        onSelect: () => {
          if (!confirm(t("menu.deleteElementConfirm", { name: el.name }))) return;
          removeFromList(qk.elements(nb), el.id);
          opts.onDeleted?.();
          api.elements.remove(el.id).catch((e: Error) => {
            toast.error(e.message);
            queryClient.invalidateQueries({ queryKey: qk.elements(nb) });
          });
        },
      },
    ],
  ];
}
