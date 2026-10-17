/**
 * 设置 → 预设与模板：对话预设（回答风格）、笔记模板、Notebook 模板。
 * 对话预设：内置的只读，可以复制一份再改；自定义的可以编辑、导入导出（启用「酒馆兼容」后支持酒馆预设）。
 */
import type { ChatPreset, PresetSnippet } from "@quirenote/core";
import {
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Select,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from "@quirenote/ui";
import { Copy, Download, Plus, Trash2, Upload } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ST_PLUGIN, usePluginEnabled } from "@/features/plugins/catalog";
import { usePresets } from "@/features/presets/usePresets";
import { currentLang, useTranslation } from "@/i18n";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/query";
import { SettingsSection } from "@/routes/settings";
import { NotebookTemplates, NoteTemplates } from "./WritingTemplates";

type Tab = "presets" | "notes" | "notebooks";

export function PresetSettings() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("presets");
  const head = {
    presets: [t("presets.tabPresets"), t("presets.presetsDesc")],
    notes: [t("presets.tabNoteTemplates"), t("templates.noteTemplatesDesc")],
    notebooks: [t("presets.tabNotebookTemplates"), t("templates.notebookTemplatesDesc")],
  }[tab] as [string, string];
  return (
    <>
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="mb-6">
        <TabsList>
          <TabsTrigger value="presets">{t("presets.tabPresets")}</TabsTrigger>
          <TabsTrigger value="notes">{t("presets.tabNoteTemplates")}</TabsTrigger>
          <TabsTrigger value="notebooks">{t("presets.tabNotebookTemplates")}</TabsTrigger>
        </TabsList>
      </Tabs>
      <SettingsSection title={head[0]} description={head[1]}>
        {tab === "presets" ? <ChatPresets /> : tab === "notes" ? <NoteTemplates /> : <NotebookTemplates />}
      </SettingsSection>
    </>
  );
}

const refresh = () => queryClient.invalidateQueries({ queryKey: ["presets"] });

function ChatPresets() {
  const { t } = useTranslation();
  const presets = usePresets();
  const st = usePluginEnabled(ST_PLUGIN);
  const fileRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const list = presets.data ?? [];
  const current = list.find((p) => p.id === selected) ?? list[0] ?? null;

  const create = async (from?: ChatPreset) => {
    try {
      const { id: _id, builtin: _b, ...fields } = from ?? ({} as Partial<ChatPreset>);
      const p = await api.presets.create({
        ...fields,
        name: from ? t("presets.copyName", { name: from.name }) : t("presets.newName"),
      } as Parameters<typeof api.presets.create>[0]);
      await refresh();
      setSelected(p.id);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-start">
      <div className="flex shrink-0 flex-col gap-1 md:w-60">
        <div className="mb-1 flex gap-1.5">
          <Button size="sm" variant="primary" onClick={() => create()}>
            <Plus />
            {t("presets.new")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()}>
            <Upload />
            {t("presets.import")}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                const r = await api.presets.importFile(f, currentLang());
                await refresh();
                setSelected(r.preset.id);
                toast.success(t("presets.imported", { name: r.preset.name }));
                for (const w of r.warnings) toast.warning(w);
              } catch (err) {
                toast.error((err as Error).message);
              }
            }}
          />
        </div>
        {list.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setSelected(p.id)}
            className={cn(
              "flex flex-col items-start rounded-lg px-3 py-2 text-left transition-colors focus-ring",
              current?.id === p.id ? "bg-surface-hover" : "hover:bg-surface-hover/60",
            )}
          >
            <span className="flex w-full items-center gap-1.5 text-[13.5px] font-medium">
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {p.builtin ? <Badge className="h-4 px-1.5 text-[10px]">{t("presets.builtin")}</Badge> : null}
            </span>
            {p.description ? (
              <span className="line-clamp-1 text-[12px] text-fg-subtle">{p.description}</span>
            ) : null}
          </button>
        ))}
      </div>
      <div className="min-w-0 flex-1 rounded-xl border border-border bg-surface p-4">
        {current ? (
          <PresetEditor
            key={current.id}
            preset={current}
            st={st}
            onCopy={() => create(current)}
            onDeleted={() => setSelected(null)}
          />
        ) : null}
      </div>
    </div>
  );
}

const POSITIONS: PresetSnippet["position"][] = ["system_start", "after_sources", "before_question"];
const ROLES: PresetSnippet["role"][] = ["system", "user", "assistant"];

function PresetEditor({
  preset,
  st,
  onCopy,
  onDeleted,
}: {
  preset: ChatPreset;
  st: boolean;
  onCopy: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(preset);
  useEffect(() => setDraft(preset), [preset]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(preset);
  const readOnly = preset.builtin;
  const set = <K extends keyof ChatPreset>(k: K, v: ChatPreset[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  const save = async () => {
    try {
      const { id, builtin: _b, ...fields } = draft;
      await api.presets.update(id, fields);
      await refresh();
      toast.success(t("presets.saved"));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={draft.name}
          disabled={readOnly}
          onChange={(e) => set("name", e.target.value)}
          className="h-8 min-w-0 flex-1 text-[14px] font-medium"
          aria-label={t("presets.name")}
        />
        <Button size="sm" variant="ghost" onClick={onCopy}>
          <Copy />
          {t("presets.copy")}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost">
              <Download />
              {t("common.export")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => window.open(api.presets.exportUrl(preset.id, "quire", currentLang()))}
            >
              {t("presets.exportQuire")}
            </DropdownMenuItem>
            {st ? (
              <DropdownMenuItem
                onSelect={() => window.open(api.presets.exportUrl(preset.id, "sillytavern", currentLang()))}
              >
                {t("presets.exportSt")}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        {readOnly ? null : (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("common.delete")}
            onClick={async () => {
              if (!confirm(t("presets.deleteConfirm", { name: preset.name }))) return;
              await api.presets.remove(preset.id).catch((e: Error) => toast.error(e.message));
              await refresh();
              onDeleted();
            }}
          >
            <Trash2 />
          </Button>
        )}
      </div>
      {readOnly ? <p className="text-[12.5px] text-fg-subtle">{t("presets.builtinHint")}</p> : null}
      <Field label={t("presets.description")}>
        <Input
          value={draft.description}
          disabled={readOnly}
          onChange={(e) => set("description", e.target.value)}
        />
      </Field>
      <Field label={t("presets.instructions")} hint={t("presets.instructionsHint")}>
        <Textarea
          value={draft.instructions}
          disabled={readOnly}
          rows={7}
          onChange={(e) => set("instructions", e.target.value)}
          placeholder={t("presets.instructionsPlaceholder")}
        />
      </Field>
      <Field label={t("presets.format")} hint={t("presets.formatHint")}>
        <Textarea
          value={draft.format}
          disabled={readOnly}
          rows={2}
          onChange={(e) => set("format", e.target.value)}
        />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label={t("presets.temperature")}>
          <Input
            type="number"
            step="0.1"
            min={0}
            max={2}
            disabled={readOnly}
            value={draft.temperature ?? ""}
            placeholder={t("presets.modelDefault")}
            onChange={(e) => set("temperature", num(e.target.value))}
          />
        </Field>
        <Field label="Top P">
          <Input
            type="number"
            step="0.05"
            min={0}
            max={1}
            disabled={readOnly}
            value={draft.topP ?? ""}
            placeholder={t("presets.modelDefault")}
            onChange={(e) => set("topP", num(e.target.value))}
          />
        </Field>
        <Field label={t("presets.maxTokens")}>
          <Input
            type="number"
            step="100"
            min={16}
            disabled={readOnly}
            value={draft.maxTokens ?? ""}
            placeholder={t("presets.modelDefault")}
            onChange={(e) => set("maxTokens", num(e.target.value))}
          />
        </Field>
      </div>
      <Field label={t("presets.snippets")} hint={t("presets.snippetsHint")}>
        <div className="flex flex-col gap-2">
          {draft.snippets.map((s, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-lg border border-border p-2.5">
              <div className="flex items-center gap-2">
                <Select
                  value={s.position}
                  className="h-7 w-44 text-[12.5px]"
                  ariaLabel={t("presets.position")}
                  onValueChange={(v) =>
                    set(
                      "snippets",
                      draft.snippets.map((x, j) =>
                        j === i ? { ...x, position: v as PresetSnippet["position"] } : x,
                      ),
                    )
                  }
                  options={POSITIONS.map((p) => ({ value: p, label: t(`presets.pos_${p}`) }))}
                />
                <Select
                  value={s.role}
                  className="h-7 w-24 text-[12.5px]"
                  ariaLabel={t("presets.role")}
                  onValueChange={(v) =>
                    set(
                      "snippets",
                      draft.snippets.map((x, j) =>
                        j === i ? { ...x, role: v as PresetSnippet["role"] } : x,
                      ),
                    )
                  }
                  options={ROLES.map((r) => ({ value: r, label: t(`lorebook.role_${r}`) }))}
                />
                <span className="flex-1" />
                {readOnly ? null : (
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={t("common.delete")}
                    onClick={() =>
                      set(
                        "snippets",
                        draft.snippets.filter((_, j) => j !== i),
                      )
                    }
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
              <Textarea
                value={s.content}
                rows={3}
                disabled={readOnly}
                onChange={(e) =>
                  set(
                    "snippets",
                    draft.snippets.map((x, j) => (j === i ? { ...x, content: e.target.value } : x)),
                  )
                }
              />
            </div>
          ))}
          {readOnly ? null : (
            <Button
              size="sm"
              variant="ghost"
              className="self-start"
              onClick={() =>
                set("snippets", [
                  ...draft.snippets,
                  { content: "", position: "system_start", role: "system" },
                ])
              }
            >
              <Plus />
              {t("presets.addSnippet")}
            </Button>
          )}
        </div>
      </Field>
      {readOnly ? null : (
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(preset)}>
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

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: children 总是输入框或一组输入框，label 包住它们即可关联
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-fg-muted">{label}</span>
      {children}
      {hint ? <span className="text-[12px] leading-relaxed text-fg-subtle">{hint}</span> : null}
    </label>
  );
}
