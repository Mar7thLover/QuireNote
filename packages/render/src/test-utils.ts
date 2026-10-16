import type { RenderRule } from "@quirenote/core";

/** 测试用：用最少字段构造一条规则。 */
export function makeRule(partial: Partial<RenderRule> & Pick<RenderRule, "id" | "pattern">): RenderRule {
  return {
    name: partial.id,
    enabled: true,
    flags: "g",
    templateId: null,
    replacement: "",
    slots: {},
    scopes: ["chat", "note", "artifact"],
    order: 0,
    ...partial,
  };
}
