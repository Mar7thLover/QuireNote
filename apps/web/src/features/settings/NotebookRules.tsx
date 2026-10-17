/**
 * 各 Notebook 自带的渲染规则（导入卡片时带来）：可以开关、移除，或设为全局。
 * 设为全局 = 把规则和它用到的模板复制进全局设置，再从这本 Notebook 里拿掉。
 */
import { type Notebook, newId, type RenderPack, type RenderRule } from "@quirenote/core";
import { analyzePattern, builtinTemplates } from "@quirenote/render";
import { Badge, Button, cn, Switch, toast } from "@quirenote/ui";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Globe, Trash2 } from "lucide-react";
import { useRenderStore } from "@/features/render/store";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api";
import { qk, queryClient, upsertInList } from "@/lib/query";
import { SettingsSection } from "@/routes/settings";

async function savePack(nb: Notebook, render: RenderPack) {
  upsertInList(qk.notebooks, { ...nb, render });
  useRenderStore
    .getState()
    .setNotebookPack(nb.id, render.rules.length || render.templates.length ? render : undefined);
  try {
    await api.notebooks.update(nb.id, { render });
  } finally {
    queryClient.invalidateQueries({ queryKey: qk.notebooks });
    queryClient.invalidateQueries({ queryKey: qk.notebook(nb.id) });
  }
}

/** 从 pack 里拿掉一条规则；它用的模板没有别的规则再用时一起拿掉。 */
function without(pack: RenderPack, rule: RenderRule): RenderPack {
  const rules = pack.rules.filter((r) => r.id !== rule.id);
  const templates = pack.templates.filter(
    (t) => t.id !== rule.templateId || rules.some((r) => r.templateId === t.id),
  );
  return { ...pack, rules, templates };
}

function makeGlobal(nb: Notebook, pack: RenderPack, rule: RenderRule): Promise<void> {
  const store = useRenderStore.getState();
  let templateId = rule.templateId;
  const tpl = rule.templateId ? pack.templates.find((t) => t.id === rule.templateId) : undefined;
  if (tpl) {
    const same = store.templates.find((t) => t.html === tpl.html && t.css === tpl.css);
    if (same) templateId = same.id;
    else {
      const taken = new Set([...builtinTemplates, ...store.templates].map((t) => t.id));
      let id = tpl.id;
      for (let i = 2; taken.has(id); i++) id = `${tpl.id}-${i}`;
      store.setTemplates([...store.templates, { ...tpl, id, builtin: false }]);
      templateId = id;
    }
  }
  const order = Math.max(100, ...store.rules.map((r) => r.order)) + 1;
  const id = store.rules.some((r) => r.id === rule.id) ? newId("rule") : rule.id;
  store.setRules([...store.rules, { ...rule, id, templateId, order }]);
  return savePack(nb, without(pack, rule));
}

export function NotebookRules() {
  const { t } = useTranslation();
  const notebooks = useQuery({ queryKey: qk.notebooks, queryFn: api.notebooks.list });
  const withRules = (notebooks.data ?? []).filter((nb) => nb.render?.rules.length);
  if (!withRules.length) return null;

  return (
    <SettingsSection title={t("render.notebookRules")} description={t("render.notebookRulesDesc")}>
      <div className="flex flex-col gap-4">
        {withRules.map((nb) => {
          const pack = nb.render!;
          const rules = [...pack.rules].sort((a, b) => a.order - b.order);
          return (
            <div key={nb.id} className="overflow-hidden rounded-xl border border-border bg-surface">
              <div className="flex items-center gap-2 border-b border-border bg-surface-sunken/60 px-3.5 py-2">
                <span aria-hidden>{nb.icon}</span>
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{nb.title}</span>
              </div>
              {rules.map((r, i) => {
                const a = analyzePattern(r.pattern, r.flags);
                const tpl = r.templateId ? pack.templates.find((x) => x.id === r.templateId) : undefined;
                return (
                  <div
                    key={r.id}
                    className={cn(
                      "flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-2.5",
                      i > 0 && "border-t border-border",
                    )}
                  >
                    <Switch
                      checked={r.enabled}
                      onCheckedChange={(v) =>
                        savePack(nb, {
                          ...pack,
                          rules: pack.rules.map((x) => (x.id === r.id ? { ...x, enabled: v } : x)),
                        })
                      }
                      aria-label={r.name}
                    />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[13px] font-medium">{r.name}</span>
                      <code className="truncate text-xs text-fg-subtle">
                        /{r.pattern}/{r.flags}
                        {tpl ? ` → ${tpl.name}` : ""}
                      </code>
                    </div>
                    {!a.valid ? (
                      <Badge tone="danger">{a.error}</Badge>
                    ) : a.risk !== "none" ? (
                      <Badge
                        tone={a.risk === "danger" ? "danger" : "warning"}
                        title={a.issues.map((x) => x.message).join("\n")}
                      >
                        <AlertTriangle />
                        {t("render.redosWarning")}
                      </Badge>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        makeGlobal(nb, pack, r).then(
                          () => toast.success(t("render.madeGlobal")),
                          (e) => toast.error(e instanceof Error ? e.message : String(e)),
                        )
                      }
                    >
                      <Globe />
                      {t("render.makeGlobal")}
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={t("common.delete")}
                      onClick={() => savePack(nb, without(pack, r))}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </SettingsSection>
  );
}
