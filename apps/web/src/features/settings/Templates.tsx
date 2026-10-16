import { type CardTemplate, newId, type QuirenoteTheme } from "@quirenote/core";
import {
  builtinRules,
  builtinTemplates,
  exportTheme,
  importTheme,
  templateVariables,
} from "@quirenote/render";
import { Badge, Button, cn, Input, Textarea, toast } from "@quirenote/ui";
import { Copy, Download, Plus, ShieldCheck, Trash2, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { SandboxCard } from "@/features/render/RenderedSegments";
import { useRenderStore } from "@/features/render/store";
import { useTranslation } from "@/i18n";
import { SettingsSection } from "@/routes/settings";
import { useTheme } from "@/stores/theme";

export function TemplateSettings() {
  const { t } = useTranslation();
  const { templates, setTemplates, rules, setRules } = useRenderStore();
  const all = [...builtinTemplates, ...templates];
  const [selectedId, setSelectedId] = useState(all[0]!.id);
  const selected = all.find((x) => x.id === selectedId) ?? all[0]!;
  const fileRef = useRef<HTMLInputElement>(null);
  const theme = useTheme();

  const fork = (tpl: CardTemplate) => {
    const copy = { ...tpl, id: newId("tpl"), name: `${tpl.name}（副本）`, builtin: false };
    setTemplates([...templates, copy]);
    setSelectedId(copy.id);
  };

  const doExport = () => {
    const text = exportTheme({
      name: "我的 Quirenote 主题",
      author: "",
      theme: {
        mode: theme.mode,
        accent: theme.accent,
        radius: theme.radius,
        density: theme.density,
        fontSans: theme.fontSans,
        fontSerif: theme.fontSerif,
      },
      templates,
      rules,
    });
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "my-theme.quirenote-theme";
    a.click();
    URL.revokeObjectURL(url);
  };

  const doImport = async (file: File) => {
    const res = importTheme(await file.text(), {
      existingTemplateIds: all.map((x) => x.id),
      existingRuleIds: [...builtinRules, ...rules].map((r) => r.id),
      onConflict: "rename",
    });
    if (!res.ok) {
      toast.error(`导入失败：${res.error}`);
      return;
    }
    const th = res.theme as QuirenoteTheme;
    setTemplates([...templates, ...th.templates]);
    setRules([...rules, ...th.rules]);
    if (th.theme) theme.set(th.theme);
    toast.success(`已导入「${th.name}」：${th.templates.length} 个模板，${th.rules.length} 条规则`, {
      description: res.warnings.length ? res.warnings.slice(0, 3).join("；") : undefined,
    });
  };

  return (
    <SettingsSection
      title={t("render.templates")}
      description={t("render.sandboxNote")}
      action={
        <div className="flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()}>
            <Upload />
            {t("render.importTheme")}
          </Button>
          <Button size="sm" variant="ghost" onClick={doExport}>
            <Download />
            {t("render.exportTheme")}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".quirenote-theme,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) doImport(f);
              e.target.value = "";
            }}
          />
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[13rem_1fr]">
        <div className="space-y-1">
          {all.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => setSelectedId(tpl.id)}
              className={cn(
                "flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-[13px] hover:bg-surface-hover",
                selected.id === tpl.id && "bg-surface-hover font-medium",
              )}
            >
              <span className="flex-1 truncate">{tpl.name}</span>
              {tpl.builtin ? <Badge className="h-4 px-1.5 text-[10px]">{t("render.builtin")}</Badge> : null}
            </button>
          ))}
          <Button
            size="sm"
            variant="ghost"
            className="w-full justify-start"
            onClick={() => {
              const tpl: CardTemplate = {
                id: newId("tpl"),
                name: "新模板",
                description: "",
                html: '<div class="card">\n  <h3>{{title}}</h3>\n  <p>{{body}}</p>\n</div>',
                css: ".card{padding:16px 18px;border:1px solid var(--card-border);border-radius:var(--card-radius);background:var(--card-bg)}\nh3{margin:0 0 6px;color:var(--card-accent)}",
                slots: [
                  { name: "title", sample: "标题" },
                  { name: "body", sample: "正文内容" },
                ],
                builtin: false,
              };
              setTemplates([...templates, tpl]);
              setSelectedId(tpl.id);
            }}
          >
            <Plus />
            {t("render.newTemplate")}
          </Button>
        </div>
        <TemplateEditor
          key={selected.id}
          tpl={selected}
          onFork={() => fork(selected)}
          onChange={(next) => setTemplates(templates.map((x) => (x.id === next.id ? next : x)))}
          onDelete={() => {
            setTemplates(templates.filter((x) => x.id !== selected.id));
            setSelectedId(builtinTemplates[0]!.id);
          }}
        />
      </div>
    </SettingsSection>
  );
}

function TemplateEditor({
  tpl,
  onChange,
  onFork,
  onDelete,
}: {
  tpl: CardTemplate;
  onChange: (t: CardTemplate) => void;
  onFork: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(tpl);
  const readOnly = tpl.builtin;
  const vars = useMemo(() => Object.fromEntries(draft.slots.map((s) => [s.name, s.sample])), [draft.slots]);
  const detected = useMemo(() => {
    try {
      return templateVariables(draft.html);
    } catch {
      return [];
    }
  }, [draft.html]);

  const commit = (patch: Partial<CardTemplate>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (!readOnly) onChange(next);
  };

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex items-center gap-2">
        <Input
          value={draft.name}
          onChange={(e) => commit({ name: e.target.value })}
          disabled={readOnly}
          className="h-9 max-w-xs font-medium"
        />
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onFork}>
          <Copy />
          {readOnly ? "复制为自定义模板" : "复制"}
        </Button>
        {!readOnly ? (
          <Button size="icon-sm" variant="ghost" onClick={onDelete} aria-label={t("common.delete")}>
            <Trash2 />
          </Button>
        ) : null}
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-fg-subtle">{t("render.html")}</span>
            <Textarea
              value={draft.html}
              onChange={(e) => commit({ html: e.target.value })}
              readOnly={readOnly}
              rows={10}
              spellCheck={false}
              className="font-mono text-[12.5px] leading-relaxed"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-fg-subtle">{t("render.css")}</span>
            <Textarea
              value={draft.css}
              onChange={(e) => commit({ css: e.target.value })}
              readOnly={readOnly}
              rows={8}
              spellCheck={false}
              className="font-mono text-[12.5px] leading-relaxed"
            />
          </label>
        </div>
        <div className="space-y-3">
          <div>
            <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-fg-subtle">
              {t("render.preview")}
              <ShieldCheck className="size-3.5 text-success" />
            </span>
            <div className="rounded-xl border border-dashed border-border-strong bg-bg p-4">
              <SandboxCard template={draft} vars={vars} className="block w-full border-0" />
            </div>
          </div>
          <div>
            <span className="mb-1 block text-xs font-medium text-fg-subtle">
              {t("render.slots")}{" "}
              <span className="font-normal">（模板中检测到：{detected.join("、") || "无"}）</span>
            </span>
            <div className="space-y-1.5">
              {draft.slots.map((s, i) => (
                <div key={i} className="flex gap-1.5">
                  <Input
                    value={s.name}
                    disabled={readOnly}
                    onChange={(e) =>
                      commit({
                        slots: draft.slots.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                      })
                    }
                    className="h-7 w-28 font-mono text-xs"
                  />
                  <Input
                    value={s.sample}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        slots: draft.slots.map((x, j) => (j === i ? { ...x, sample: e.target.value } : x)),
                      })
                    }
                    className="h-7 flex-1 text-xs"
                  />
                </div>
              ))}
              {!readOnly ? (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    commit({ slots: [...draft.slots, { name: `var${draft.slots.length + 1}`, sample: "" }] })
                  }
                >
                  <Plus />
                  添加变量
                </Button>
              ) : null}
            </div>
          </div>
          <p className="text-[11.5px] leading-relaxed text-fg-subtle">
            语法：<code>{"{{var}}"}</code> 转义输出，<code>{"{{var|默认}}"}</code>，
            <code>{"{{#if var}}…{{/if}}"}</code>，<code>{"{{#each list}}{{.}}{{/each}}"}</code>（列表用 ||
            分隔）。颜色请使用 <code>var(--card-*)</code> 主题变量以跟随深浅色。
          </p>
        </div>
      </div>
    </div>
  );
}
