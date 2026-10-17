/** 写作模板：笔记模板（内置 + 设置里的自定义）与 Notebook 模板（服务端）。 */
import { builtinNoteTemplates, fillTemplate, type NoteTemplate } from "@quirenote/core";
import { useQuery } from "@tanstack/react-query";
import { createNote } from "@/features/notes/actions";
import { currentLang } from "@/i18n";
import { api } from "@/lib/api";
import { qk, queryClient } from "@/lib/query";

const KEY = "noteTemplates";

export function useNoteTemplates(): NoteTemplate[] {
  const lang = currentLang();
  const custom = useQuery({
    queryKey: qk.noteTemplates,
    queryFn: async () => (await api.settings.get<NoteTemplate[]>(KEY)) ?? [],
    staleTime: 60_000,
  });
  return [...builtinNoteTemplates(lang), ...(custom.data ?? [])];
}

export async function saveNoteTemplates(list: NoteTemplate[]): Promise<void> {
  queryClient.setQueryData(qk.noteTemplates, list);
  await api.settings.put(KEY, list);
}

export async function customNoteTemplates(): Promise<NoteTemplate[]> {
  return (
    queryClient.getQueryData<NoteTemplate[]>(qk.noteTemplates) ??
    (await api.settings.get<NoteTemplate[]>(KEY)) ??
    []
  );
}

/** 用模板新建笔记：占位符（日期等）在这时填上。 */
export function createFromNoteTemplate(notebookId: string, tpl: NoteTemplate) {
  const title = tpl.builtin ? "" : tpl.name;
  return createNote(notebookId, {
    title,
    markdown: fillTemplate(tpl.markdown, { title, lang: currentLang() }),
    kind: tpl.kind,
  });
}

export function useNotebookTemplates() {
  const lang = currentLang();
  return useQuery({
    queryKey: qk.notebookTemplates(lang),
    queryFn: () => api.notebookTemplates.list(lang),
    staleTime: 60_000,
  });
}
