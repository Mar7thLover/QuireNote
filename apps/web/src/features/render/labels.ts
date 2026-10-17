import type { CardTemplate, RenderRule } from "@quirenote/core";
import { builtinRuleSamples } from "@quirenote/render";
import i18n from "@/i18n";

/** 内置模板和规则的名称、示例文字写在 @quirenote/render 里（中文）；界面上按语言取 i18n 里的版本。 */
const builtinKey = (id: string) => id.replace(/^builtin\.(rule\.)?/, "");

export function builtinTemplateName(tpl: Pick<CardTemplate, "id" | "name" | "builtin">): string {
  return tpl.builtin ? i18n.t(`render.tpl_${builtinKey(tpl.id)}`, { defaultValue: tpl.name }) : tpl.name;
}

/** 设置里展示的内置模板：名称和变量示例换成界面语言的版本（HTML/CSS 不变）。 */
export function localizedBuiltinTemplate(tpl: CardTemplate): CardTemplate {
  if (!tpl.builtin) return tpl;
  const key = builtinKey(tpl.id);
  return {
    ...tpl,
    name: builtinTemplateName(tpl),
    slots: tpl.slots.map((s) => ({
      ...s,
      sample: i18n.t(`render.tplSample_${key}_${s.name}`, { defaultValue: s.sample }),
    })),
  };
}

export function builtinRuleName(rule: Pick<RenderRule, "id" | "name">): string {
  return rule.id.startsWith("builtin.")
    ? i18n.t(`render.rule_${builtinKey(rule.id)}`, { defaultValue: rule.name })
    : rule.name;
}

/** 内置规则的示例：英文界面用英文关键词写的同一张卡片（内置规则两种写法都认）。 */
export function builtinRuleSample(ruleId: string): string {
  const sample = builtinRuleSamples[ruleId] ?? "";
  return i18n.t(`render.sample_${builtinKey(ruleId)}`, { defaultValue: sample });
}
