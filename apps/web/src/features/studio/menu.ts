import type { Artifact } from "@quirenote/core";
import { toast } from "@quirenote/ui";
import { BookOpen, Copy, FileDown, FilePlus2, Pencil, Repeat, Trash2 } from "lucide-react";
import { createNote } from "@/features/notes/actions";
import i18n from "@/i18n";
import { api } from "@/lib/api";
import { copyText, downloadText } from "@/lib/clipboard";
import type { MenuSection } from "@/lib/contextMenu";
import { qk, queryClient, removeFromList, upsertInList } from "@/lib/query";
import { useWorkspace } from "@/stores/workspace";
import { artifactToMarkdown } from "./export";

/** 列表里的生成物可能不带最新内容：优先用单条缓存。 */
const latest = (a: Artifact) => queryClient.getQueryData<Artifact>(qk.artifact(a.id)) ?? a;

const fileName = (title: string) => title.replace(/[\\/:*?"<>|]/g, "_") || "artifact";

/**
 * 一个生成物的菜单：Studio 生成记录的右键，以及生成物面板空白处的右键（inPanel，不再有「打开」）。
 */
export function artifactSections(
  nb: string,
  artifact: Artifact,
  opts: { inPanel?: boolean } = {},
): MenuSection[] {
  const t = i18n.t.bind(i18n);
  const a = latest(artifact);
  const ready = a.status === "ready" && !!a.data;
  const cards = a.data?.kind === "flashcards" ? a.data.cards : null;
  return [
    [
      ...(opts.inPanel
        ? []
        : [
            {
              id: "art.open",
              label: t("common.open"),
              icon: BookOpen,
              onSelect: () => useWorkspace.getState().open({ kind: "artifact", id: a.id, title: a.title }),
            },
          ]),
      {
        id: "art.rename",
        label: t("common.rename"),
        icon: Pencil,
        onSelect: async () => {
          const title = prompt(t("common.rename"), a.title)?.trim();
          if (!title || title === a.title) return;
          try {
            const next = await api.artifacts.update(a.id, { title });
            upsertInList(qk.artifacts(nb), next);
            queryClient.setQueryData(qk.artifact(a.id), next);
            useWorkspace.getState().api?.getPanel(`artifact:${a.id}`)?.api.setTitle(title);
          } catch (e) {
            toast.error((e as Error).message);
          }
        },
      },
    ],
    [
      {
        id: "art.copy",
        label: t("notes.copyMarkdown"),
        icon: Copy,
        disabled: !ready,
        onSelect: () => copyText(artifactToMarkdown(latest(artifact)), true),
      },
      {
        id: "art.export",
        label: t("menu.exportMarkdown"),
        icon: FileDown,
        disabled: !ready,
        onSelect: () => {
          const cur = latest(artifact);
          downloadText(artifactToMarkdown(cur), `${fileName(cur.title)}.md`);
        },
      },
      {
        id: "art.note",
        label: t("chat.saveAsNote"),
        icon: FilePlus2,
        disabled: !ready,
        onSelect: () => {
          const cur = latest(artifact);
          void createNote(nb, {
            title: cur.title,
            markdown: artifactToMarkdown(cur),
            origin: { type: "studio", refId: cur.id, sourceId: null },
          });
        },
      },
      ...(cards?.length
        ? [
            {
              id: "art.review",
              label: t("studio.addToReview"),
              icon: Repeat,
              onSelect: () =>
                api.review
                  .addCards(
                    nb,
                    cards.map((c) => ({ front: c.front, back: c.back, artifactId: a.id })),
                  )
                  .then((r) => {
                    toast.success(t("studio.addedToReview", { count: r.length }));
                    queryClient.invalidateQueries({ queryKey: qk.review(nb) });
                    queryClient.invalidateQueries({ queryKey: qk.reviewStats(nb) });
                  })
                  .catch((e: Error) => toast.error(e.message)),
            },
          ]
        : []),
    ],
    [
      {
        id: "art.delete",
        label: t("common.delete"),
        icon: Trash2,
        danger: true,
        onSelect: () => {
          if (!confirm(t("studio.deleteConfirm"))) return;
          removeFromList(qk.artifacts(nb), a.id);
          useWorkspace.getState().close({ kind: "artifact", id: a.id });
          api.artifacts
            .remove(a.id)
            .catch((e: Error) => toast.error(e.message))
            .finally(() => queryClient.invalidateQueries({ queryKey: qk.artifacts(nb) }));
        },
      },
    ],
  ];
}
