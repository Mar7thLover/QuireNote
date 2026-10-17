import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { qk } from "@/lib/query";

/** 这本 Notebook 有没有资料以外的背景：作者的 AI 说明，或启用中的知识书条目。有的话没勾选资料也能对话。 */
export function useNotebookBackground(notebookId: string): boolean {
  const nb = useQuery({ queryKey: qk.notebook(notebookId), queryFn: () => api.notebooks.get(notebookId) });
  const book = useQuery({ queryKey: qk.lorebook(notebookId), queryFn: () => api.lorebook.get(notebookId) });
  return (
    !!nb.data?.aiInstructions?.trim() ||
    (!!book.data?.settings.enabled && book.data.entries.some((e) => e.enabled))
  );
}
