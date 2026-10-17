/** 设置 → 预设与模板 里的「笔记模板」「Notebook 模板」两页。 */
import type { NoteTemplate } from "@quirenote/core";
import { Badge, Button, cn, Input, Textarea, toast } from "@quirenote/ui";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  customNoteTemplates,
  saveNoteTemplates,
  useNotebookTemplates,
  useNoteTemplates,
} from "@/features/templates/useTemplates";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/query";
import { Field } from "./Presets";

export function NoteTemplates() {
  const { t } = useTranslation();
  const list = useNoteTemplates();
  const [selected, setSelected] = useState<string | null>(null);
  const current = list.find((x) => x.id === selected) ?? list[0] ?? null;

  const create = async () => {
    const tpl: NoteTemplate = {
      id: `tpl_${Date.now().toString(36)}`,
      name: t("templates.newNoteTemplateName"),
      description: "",
      icon: "📝",
      markdown: "## \n\n",
      kind: "note",
      builtin: false,
    };
    await saveNoteTemplates([...(await customNoteTemplates()), tpl]);
    setSelected(tpl.id);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-start">
        <div className="flex shrink-0 flex-col gap-1 md:w-60">
          <Button size="sm" variant="primary" className="mb-1 self-start" onClick={create}>
            <Plus />
            {t("templates.newNoteTemplate")}
          </Button>
          {list.map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setSelected(x.id)}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors focus-ring",
                current?.id === x.id ? "bg-surface-hover" : "hover:bg-surface-hover/60",
              )}
            >
              <span aria-hidden>{x.icon}</span>
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{x.name}</span>
              {x.builtin ? <Badge className="h-4 px-1.5 text-[10px]">{t("presets.builtin")}</Badge> : null}
            </button>
          ))}
        </div>
        <div className="min-w-0 flex-1 rounded-xl border border-border bg-surface p-4">
          {current ? (
            <NoteTemplateEditor key={current.id} tpl={current} onDeleted={() => setSelected(null)} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function NoteTemplateEditor({ tpl, onDeleted }: { tpl: NoteTemplate; onDeleted: () => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(tpl);
  useEffect(() => setDraft(tpl), [tpl]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(tpl);
  const readOnly = tpl.builtin;
  const save = async () => {
    const list = await customNoteTemplates();
    await saveNoteTemplates(list.map((x) => (x.id === tpl.id ? draft : x)));
    toast.success(t("presets.saved"));
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Input
          value={draft.icon}
          disabled={readOnly}
          onChange={(e) => setDraft({ ...draft, icon: e.target.value.slice(0, 4) })}
          className="h-8 w-12 text-center"
          aria-label="icon"
        />
        <Input
          value={draft.name}
          disabled={readOnly}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          className="h-8 min-w-0 flex-1 text-[14px] font-medium"
          aria-label={t("presets.name")}
        />
        {readOnly ? null : (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("common.delete")}
            onClick={async () => {
              if (!confirm(t("templates.deleteConfirm", { name: tpl.name }))) return;
              await saveNoteTemplates((await customNoteTemplates()).filter((x) => x.id !== tpl.id));
              onDeleted();
            }}
          >
            <Trash2 />
          </Button>
        )}
      </div>
      {readOnly ? <p className="text-[12.5px] text-fg-subtle">{t("templates.builtinReadOnly")}</p> : null}
      <Field label={t("presets.description")}>
        <Input
          value={draft.description}
          disabled={readOnly}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        />
      </Field>
      <Field label={t("templates.markdown")}>
        <Textarea
          value={draft.markdown}
          disabled={readOnly}
          rows={14}
          className="font-mono text-[12.5px]"
          onChange={(e) => setDraft({ ...draft, markdown: e.target.value })}
        />
      </Field>
      {readOnly ? null : (
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(tpl)}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" disabled={!dirty} onClick={save}>
            {t("common.save")}
          </Button>
        </div>
      )}
    </div>
  );
}

export function NotebookTemplates() {
  const { t } = useTranslation();
  const templates = useNotebookTemplates();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["notebookTemplates"] });
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {(templates.data ?? []).map((x, i) => (
          <div
            key={x.id}
            className={cn("flex items-center gap-3 px-3.5 py-2.5", i > 0 && "border-t border-border")}
          >
            <span className="text-lg" aria-hidden>
              {x.icon}
            </span>
            {x.builtin ? (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium">{x.name}</span>
                <span className="block truncate text-[12px] text-fg-subtle">{x.description}</span>
              </span>
            ) : (
              <Input
                defaultValue={x.name}
                className="h-7 min-w-0 flex-1 text-[13.5px]"
                aria-label={t("presets.name")}
                onBlur={(e) =>
                  e.target.value.trim() && e.target.value !== x.name
                    ? api.notebookTemplates.rename(x.id, { name: e.target.value }).then(refresh)
                    : undefined
                }
              />
            )}
            {x.builtin ? (
              <Badge className="h-4 px-1.5 text-[10px]">{t("presets.builtin")}</Badge>
            ) : (
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={t("common.delete")}
                onClick={async () => {
                  if (!confirm(t("templates.deleteConfirm", { name: x.name }))) return;
                  await api.notebookTemplates.remove(x.id).catch((e: Error) => toast.error(e.message));
                  refresh();
                }}
              >
                <Trash2 />
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
