import type { NoteInput } from "@quirenote/core";
import { api } from "@/lib/api";
import { qk, queryClient, upsertInList } from "@/lib/query";
import { useWorkspace } from "@/stores/workspace";

/** 新建笔记并在工作区中打开。 */
export async function createNote(nb: string, input: Partial<NoteInput> = {}, open = true) {
  const note = await api.notes.create(nb, { title: "", markdown: "", ...input });
  upsertInList(qk.notes(nb), note);
  queryClient.setQueryData(qk.note(note.id), note);
  if (open) useWorkspace.getState().open({ kind: "note", id: note.id, title: note.title || "无标题" });
  return note;
}
