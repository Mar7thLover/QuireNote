import type { NoteInput } from "@quirenote/core";
import i18n from "@/i18n";
import { api } from "@/lib/api";
import { qk, queryClient, upsertInList } from "@/lib/query";
import { useWorkspace } from "@/stores/workspace";

/** 新建笔记并在工作区中打开。 */
export async function createNote(nb: string, input: Partial<NoteInput> = {}, open = true) {
  const note = await api.notes.create(nb, { title: "", markdown: "", ...input });
  upsertInList(qk.notes(nb), note);
  queryClient.setQueryData(qk.note(note.id), note);
  if (open)
    useWorkspace
      .getState()
      .open({ kind: "note", id: note.id, title: note.title || i18n.t("notes.titlePlaceholder") });
  return note;
}
