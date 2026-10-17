import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { qk } from "@/lib/query";

/** 这本 Notebook 有没有写了内容的笔记。 */
export function useNotebookHasNotes(notebookId: string): boolean {
  const notes = useQuery({ queryKey: qk.notes(notebookId), queryFn: () => api.notes.list(notebookId) });
  return !!notes.data?.some((n) => n.markdown.trim());
}

/** 这本 Notebook 有没有资料以外的材料：笔记（也算资料，可以引用）、启用中的知识书条目或 AI 说明。有的话没勾选资料也能提问。 */
export function useNotebookBackground(notebookId: string): boolean {
  const nb = useQuery({ queryKey: qk.notebook(notebookId), queryFn: () => api.notebooks.get(notebookId) });
  const book = useQuery({ queryKey: qk.lorebook(notebookId), queryFn: () => api.lorebook.get(notebookId) });
  const notes = useNotebookHasNotes(notebookId);
  return (
    notes ||
    !!nb.data?.aiInstructions?.trim() ||
    (!!book.data?.settings.enabled && book.data.entries.some((e) => e.enabled))
  );
}
