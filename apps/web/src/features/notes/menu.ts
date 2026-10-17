import type { Note } from "@quirenote/core";
import { toast } from "@quirenote/ui";
import {
  BookOpen,
  Copy,
  CreditCard,
  FileDown,
  FileText,
  LayoutTemplate,
  MessagesSquare,
  Pin,
  PinOff,
  Share2,
  Trash2,
} from "lucide-react";
import { customNoteTemplates, saveNoteTemplates } from "@/features/templates/useTemplates";
import i18n from "@/i18n";
import { api } from "@/lib/api";
import { copyText, downloadText } from "@/lib/clipboard";
import type { MenuSection } from "@/lib/contextMenu";
import { qk, queryClient, removeFromList, upsertInList } from "@/lib/query";
import { draftQuestion } from "@/lib/workspaceActions";
import { useUi } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";

/** 正在编辑的笔记可能比列表里的新：优先用单条缓存。 */
const latest = (note: Note) => queryClient.getQueryData<Note>(qk.note(note.id)) ?? note;

async function patchNote(nb: string, note: Note, patch: Partial<Pick<Note, "pinned" | "kind">>) {
  upsertInList(qk.notes(nb), { ...latest(note), ...patch });
  try {
    const n = await api.notes.update(note.id, patch);
    upsertInList(qk.notes(nb), n);
    queryClient.setQueryData<Note>(qk.note(n.id), (old) => ({ ...(old ?? n), ...n, doc: old?.doc ?? n.doc }));
  } catch (e) {
    toast.error((e as Error).message);
    queryClient.invalidateQueries({ queryKey: qk.notes(nb) });
  }
}

/**
 * 一条笔记的菜单：笔记列表的右键、编辑器顶栏的「…」共用。
 * withOpen：列表里多一项「打开」；编辑器里已经打开着就不需要。
 */
export function noteSections(nb: string, note: Note, opts: { withOpen?: boolean } = {}): MenuSection[] {
  const t = i18n.t.bind(i18n);
  const n = latest(note);
  const title = n.title || t("common.untitled");
  return [
    [
      ...(opts.withOpen
        ? [
            {
              id: "note.open",
              label: t("common.open"),
              icon: BookOpen,
              onSelect: () => useWorkspace.getState().open({ kind: "note", id: n.id, title }),
            },
          ]
        : []),
      {
        id: "note.ask",
        label: t("menu.askAboutNote"),
        icon: MessagesSquare,
        onSelect: () => draftQuestion(t("menu.askAboutNotePrompt", { title })),
      },
    ],
    [
      {
        id: "note.pin",
        label: n.pinned ? t("home.unpin") : t("home.pin"),
        icon: n.pinned ? PinOff : Pin,
        onSelect: () => void patchNote(nb, n, { pinned: !n.pinned }),
      },
      {
        id: "note.kind",
        label: n.kind === "card" ? t("notes.toNote") : t("notes.toFlashcard"),
        icon: n.kind === "card" ? FileText : CreditCard,
        onSelect: () => void patchNote(nb, n, { kind: n.kind === "card" ? "note" : "card" }),
      },
    ],
    [
      {
        id: "note.copy",
        label: t("notes.copyMarkdown"),
        icon: Copy,
        onSelect: () => copyText(latest(note).markdown, true),
      },
      {
        id: "note.export",
        label: t("menu.exportMarkdown"),
        icon: FileDown,
        onSelect: () => {
          const cur = latest(note);
          const name = (cur.title || t("common.untitled")).replace(/[\\/:*?"<>|]/g, "_");
          downloadText(cur.title ? `# ${cur.title}\n\n${cur.markdown}` : cur.markdown, `${name}.md`);
        },
      },
      {
        id: "note.share",
        label: t("cards.menuShare"),
        icon: Share2,
        onSelect: () =>
          useUi.getState().set({
            shareCard: { kind: "note", id: n.id, name: latest(note).title || t("common.untitled") },
          }),
      },
      {
        id: "note.template",
        label: t("templates.saveAsTemplate"),
        icon: LayoutTemplate,
        onSelect: async () => {
          const cur = latest(note);
          const list = await customNoteTemplates();
          await saveNoteTemplates([
            ...list,
            {
              id: `tpl_${Date.now().toString(36)}`,
              name: cur.title || t("common.untitled"),
              description: "",
              icon: "📝",
              markdown: cur.markdown,
              kind: cur.kind,
              builtin: false,
            },
          ]);
          toast.success(t("templates.savedNote", { name: cur.title || t("common.untitled") }));
        },
      },
    ],
    [
      {
        id: "note.delete",
        label: t("common.delete"),
        icon: Trash2,
        danger: true,
        onSelect: () => {
          if (!confirm(t("notes.deleteConfirm"))) return;
          removeFromList(qk.notes(nb), note.id);
          useWorkspace.getState().close({ kind: "note", id: note.id });
          api.notes.remove(note.id).catch((e: Error) => {
            toast.error(e.message);
            queryClient.invalidateQueries({ queryKey: qk.notes(nb) });
          });
        },
      },
    ],
  ];
}
