import { newId, type RenderRule, type RuleScope } from "@quirenote/core";
import { analyzePattern, builtinRuleSamples, builtinRules, builtinTemplates } from "@quirenote/render";
import { Badge, Button, Checkbox, cn, Input, Select, Switch, Textarea } from "@quirenote/ui";
import { AlertTriangle, ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Markdown } from "@/components/Markdown";
import { builtinRuleName, builtinRuleSample, builtinTemplateName } from "@/features/render/labels";
import { useRenderStore } from "@/features/render/store";
import { useTranslation } from "@/i18n";
import { SettingsSection } from "@/routes/settings";
import { NotebookRules } from "./NotebookRules";

const SCOPES: RuleScope[] = ["chat", "note", "artifact"];

export function RuleSettings() {
  const { t } = useTranslation();
  const { rules, setRules, disabledBuiltins, toggleBuiltin, templates } = useRenderStore();
  const [test, setTest] = useState(
    `${Object.keys(builtinRuleSamples).map(builtinRuleSample).join("\n\n")}\n\n${t("render.testSample")}`,
  );
  const tplOptions = [...builtinTemplates, ...templates].map((x) => ({
    value: x.id,
    label: builtinTemplateName(x),
  }));
  const sorted = [...rules].sort((a, b) => a.order - b.order);

  const update = (id: string, patch: Partial<RenderRule>) =>
    setRules(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const move = (id: string, dir: -1 | 1) => {
    const i = sorted.findIndex((r) => r.id === id);
    const j = i + dir;
    if (j < 0 || j >= sorted.length) return;
    const a = sorted[i]!;
    const b = sorted[j]!;
    setRules(
      rules.map((r) =>
        r.id === a.id ? { ...r, order: b.order } : r.id === b.id ? { ...r, order: a.order } : r,
      ),
    );
  };

  return (
    <>
      <SettingsSection
        title={t("render.rules")}
        description={t("render.rulesDesc")}
        action={
          <Button
            size="sm"
            variant="primary"
            onClick={() =>
              setRules([
                ...rules,
                {
                  id: newId("rule"),
                  name: t("render.newRuleName"),
                  enabled: true,
                  pattern: t("render.newRulePattern"),
                  flags: "g",
                  templateId: "builtin.term",
                  replacement: "",
                  slots: { "1": "name" },
                  scopes: ["chat", "note"],
                  order: (sorted.at(-1)?.order ?? 100) + 1,
                },
              ])
            }
          >
            <Plus />
            {t("render.newRule")}
          </Button>
        }
      >
        <div className="space-y-2">
          {sorted.map((r, i) => (
            <RuleCard
              key={r.id}
              rule={r}
              tplOptions={tplOptions}
              first={i === 0}
              last={i === sorted.length - 1}
              onChange={(p) => update(r.id, p)}
              onMove={(d) => move(r.id, d)}
              onDelete={() => setRules(rules.filter((x) => x.id !== r.id))}
            />
          ))}
          {sorted.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-6 text-center text-[13px] text-fg-subtle">
              {t("render.noRules")}
            </p>
          ) : null}
        </div>
      </SettingsSection>

      <NotebookRules />

      <SettingsSection title={t("render.builtinRules")}>
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          {builtinRules.map((r, i) => (
            <div
              key={r.id}
              className={cn("flex items-center gap-3 px-3.5 py-2.5", i > 0 && "border-t border-border")}
            >
              <Switch
                checked={!disabledBuiltins.includes(r.id)}
                onCheckedChange={(v) => toggleBuiltin(r.id, v)}
                aria-label={builtinRuleName(r)}
              />
              <span className="w-28 shrink-0 text-[13px] font-medium">{builtinRuleName(r)}</span>
              <code className="min-w-0 flex-1 truncate text-xs text-fg-subtle">
                {builtinRuleSample(r.id)}
              </code>
            </div>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title={t("render.testInput")} description={t("render.testDesc")}>
        <div className="grid gap-4 lg:grid-cols-2">
          <Textarea
            value={test}
            onChange={(e) => setTest(e.target.value)}
            rows={14}
            className="font-mono text-[12.5px]"
          />
          <div className="max-h-[28rem] overflow-y-auto rounded-xl border border-border bg-surface p-4">
            <Markdown text={test} scope="note" />
          </div>
        </div>
      </SettingsSection>
    </>
  );
}

function RuleCard({
  rule: r,
  tplOptions,
  first,
  last,
  onChange,
  onMove,
  onDelete,
}: {
  rule: RenderRule;
  tplOptions: { value: string; label: string }[];
  first: boolean;
  last: boolean;
  onChange: (p: Partial<RenderRule>) => void;
  onMove: (d: -1 | 1) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const analysis = analyzePattern(r.pattern, r.flags);
  return (
    <div className="rounded-xl border border-border bg-surface p-3.5">
      <div className="flex items-center gap-2">
        <Switch checked={r.enabled} onCheckedChange={(v) => onChange({ enabled: v })} aria-label="enabled" />
        <Input
          value={r.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="h-7 w-48 text-[13px] font-medium"
        />
        {analysis.risk !== "none" ? (
          <Badge
            tone={analysis.risk === "danger" ? "danger" : "warning"}
            title={analysis.issues.map((x) => x.message).join("\n")}
          >
            <AlertTriangle />
            {t("render.redosWarning")}
          </Badge>
        ) : null}
        {!analysis.valid ? <Badge tone="danger">{analysis.error}</Badge> : null}
        <span className="flex-1" />
        <Button size="icon-xs" variant="ghost" disabled={first} onClick={() => onMove(-1)} aria-label="up">
          <ArrowUp />
        </Button>
        <Button size="icon-xs" variant="ghost" disabled={last} onClick={() => onMove(1)} aria-label="down">
          <ArrowDown />
        </Button>
        <Button size="icon-xs" variant="ghost" onClick={onDelete} aria-label={t("common.delete")}>
          <Trash2 />
        </Button>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_5rem]">
        <Input
          value={r.pattern}
          onChange={(e) => onChange({ pattern: e.target.value })}
          placeholder={t("render.pattern")}
          className="font-mono text-[12.5px]"
          spellCheck={false}
        />
        <Input
          value={r.flags}
          onChange={(e) => onChange({ flags: e.target.value })}
          placeholder={t("render.flags")}
          className="font-mono text-[12.5px]"
        />
      </div>
      <div className="mt-3 grid items-center gap-3 sm:grid-cols-2">
        <Select
          value={r.templateId ?? "__text"}
          onValueChange={(v) => onChange({ templateId: v === "__text" ? null : v })}
          options={[{ value: "__text", label: t("render.plainText") }, ...tplOptions]}
        />
        {r.templateId ? (
          <Input
            value={Object.entries(r.slots)
              .map(([k, v]) => `${k}=${v}`)
              .join(", ")}
            onChange={(e) =>
              onChange({
                slots: Object.fromEntries(
                  e.target.value
                    .split(",")
                    .map((p) => p.split("=").map((x) => x.trim()))
                    .filter((p) => p.length === 2 && p[0] && p[1]) as [string, string][],
                ),
              })
            }
            placeholder={t("render.slotsPlaceholder")}
            className="font-mono text-[12.5px]"
          />
        ) : (
          <Input
            value={r.replacement}
            onChange={(e) => onChange({ replacement: e.target.value })}
            placeholder={`${t("render.replacement")}${t("render.replacementHint")}`}
            className="font-mono text-[12.5px]"
          />
        )}
      </div>
      <div className="mt-3 flex items-center gap-4 text-[13px]">
        <span className="text-xs text-fg-subtle">{t("render.scopes")}</span>
        {SCOPES.map((s) => (
          <label key={s} className="flex items-center gap-1.5">
            <Checkbox
              checked={r.scopes.includes(s)}
              onCheckedChange={(v) =>
                onChange({ scopes: v ? [...r.scopes, s] : r.scopes.filter((x) => x !== s) })
              }
            />
            {t(`render.scope_${s}`)}
          </label>
        ))}
      </div>
    </div>
  );
}
