// @vitest-environment jsdom
import { type CardTemplate, ThemeSettings } from "@quirenote/core";
import { describe, expect, it } from "vitest";
import { builtinRules } from "./builtin/rules";
import { builtinTemplates, termTemplate } from "./builtin/templates";
import { defaultThemeSettings } from "./srcdoc";
import { makeRule } from "./test-utils";
import { exportTheme, importTheme } from "./theme-file";

const myTemplate: CardTemplate = {
  id: "my.card",
  name: "我的卡片",
  description: "",
  html: `<div class="m">{{title}}{{#each items}}<i>{{.}}</i>{{/each}}</div>`,
  css: ".m{color:var(--card-fg)}",
  slots: [
    { name: "title", sample: "标题" },
    { name: "items", sample: "a||b" },
  ],
  builtin: false,
};
const myRule = makeRule({
  id: "my.rule",
  pattern: "@@(\\w+)",
  templateId: "my.card",
  slots: { "1": "title" },
});

function mustImport(text: string, options?: Parameters<typeof importTheme>[1]) {
  const res = importTheme(text, options);
  if (!res.ok) throw new Error(`${res.error}\n${res.issues.join("\n")}`);
  return res;
}

describe("defaultThemeSettings", () => {
  it("符合 ThemeSettings schema", () => {
    expect(ThemeSettings.parse(defaultThemeSettings)).toEqual(defaultThemeSettings);
  });
});

describe(".quirenote-theme 往返", () => {
  it("导出再导入得到相同内容且没有警告", () => {
    const text = exportTheme({
      name: "清晨",
      author: "QuireNote",
      theme: { accent: "#0a7", radius: 8 },
      templates: [myTemplate, termTemplate],
      rules: [myRule],
    });
    const json = JSON.parse(text);
    expect(json).toMatchObject({ format: "quirenote-theme", version: 1, name: "清晨", author: "QuireNote" });
    expect(json.templates).toHaveLength(1); // 内置模板不导出

    const res = mustImport(text);
    expect(res.warnings).toEqual([]);
    expect(res.theme.templates).toEqual([myTemplate]);
    expect(res.theme.rules).toEqual([myRule]);
    expect(res.theme.theme).toEqual({ accent: "#0a7", radius: 8 });
  });

  it("导出非法内容时抛出", () => {
    expect(() => exportTheme({ name: "x", theme: { radius: 99 } })).toThrow();
  });
});

describe("拒绝非法文件", () => {
  it.each([
    ["不是 JSON", "{not json"],
    ["格式标记错误", JSON.stringify({ format: "other", version: 1, name: "x" })],
    ["版本不支持", JSON.stringify({ format: "quirenote-theme", version: 2, name: "x" })],
    [
      "字段类型错误",
      JSON.stringify({ format: "quirenote-theme", version: 1, name: "x", rules: [{ id: 1 }] }),
    ],
    ["根不是对象", "[]"],
  ])("%s", (_label, text) => {
    const res = importTheme(text);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBeTruthy();
  });

  it("schema 错误给出带路径的 issues", () => {
    const res = importTheme(
      JSON.stringify({ format: "quirenote-theme", version: 1, name: "x", theme: { radius: 100 } }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.some((i) => i.startsWith("theme.radius"))).toBe(true);
  });

  it("超过大小上限", () => {
    const res = importTheme(exportTheme({ name: "x" }), { maxBytes: 10 });
    expect(res.ok).toBe(false);
  });
});

describe("导入时的清洗与检查", () => {
  it("清洗模板中的脚本、事件属性、javascript: 链接和危险 CSS，并给出警告", () => {
    const evil: CardTemplate = {
      ...myTemplate,
      html: `<div onclick="steal()">{{title}}<script>alert(1)</script><a href="javascript:alert(1)">x</a></div>`,
      css: `@import url(https://evil/x.css);.m{background:url(https://evil/p.png);color:red}`,
    };
    const res = mustImport(exportTheme({ name: "x", templates: [evil] }));
    const t = res.theme.templates[0];
    expect(t?.html).not.toMatch(/onclick|script|javascript/);
    expect(t?.html).toContain("{{title}}");
    expect(t?.css).not.toContain("evil");
    expect(t?.css).toContain("color:red");
    expect(res.warnings).toHaveLength(2);
  });

  it("声明为内置的模板改为普通模板", () => {
    const text = JSON.stringify({
      format: "quirenote-theme",
      version: 1,
      name: "x",
      templates: [{ ...myTemplate, builtin: true }],
    });
    const res = mustImport(text);
    expect(res.theme.templates[0]?.builtin).toBe(false);
    expect(res.warnings).toHaveLength(1);
  });

  it("禁用非法或有灾难性回溯风险的规则", () => {
    const rules = [
      makeRule({ id: "bad", pattern: "(" }),
      makeRule({ id: "redos", pattern: "(a+)+$" }),
      makeRule({ id: "slow", pattern: "\\d+\\d+" }),
    ];
    const res = mustImport(exportTheme({ name: "x", rules }));
    expect(res.theme.rules.map((r) => [r.id, r.enabled])).toEqual([
      ["bad", false],
      ["redos", false],
      ["slow", true],
    ]);
    expect(res.warnings).toHaveLength(3);
  });

  it("规则引用不存在的模板时给出警告", () => {
    const res = mustImport(
      exportTheme({ name: "x", rules: [makeRule({ id: "r", pattern: "x", templateId: "nope" })] }),
    );
    expect(res.warnings.join()).toContain("nope");
    // 引用内置模板或本地已有模板不警告
    const ok = mustImport(
      exportTheme({
        name: "x",
        rules: [
          makeRule({ id: "r1", pattern: "x", templateId: "builtin.term" }),
          makeRule({ id: "r2", pattern: "y", templateId: "local" }),
        ],
      }),
      { existingTemplateIds: ["local"] },
    );
    expect(ok.warnings).toEqual([]);
  });
});

describe("id 冲突", () => {
  const text = exportTheme({ name: "x", templates: [myTemplate], rules: [myRule] });

  it("默认重命名，并同步更新文件内规则对模板的引用", () => {
    const res = mustImport(text, {
      existingTemplateIds: ["my.card", "my.card-2"],
      existingRuleIds: ["my.rule"],
    });
    expect(res.renamed).toEqual({ templates: { "my.card": "my.card-3" }, rules: { "my.rule": "my.rule-2" } });
    expect(res.theme.templates[0]?.id).toBe("my.card-3");
    expect(res.theme.rules[0]).toMatchObject({ id: "my.rule-2", templateId: "my.card-3" });
    expect(res.warnings).toHaveLength(2);
  });

  it("skip 丢弃冲突条目；replace 保留 id 并告知需要覆盖", () => {
    const skipped = mustImport(text, {
      existingTemplateIds: ["my.card"],
      existingRuleIds: ["my.rule"],
      onConflict: "skip",
    });
    expect(skipped.theme.templates).toEqual([]);
    expect(skipped.theme.rules).toEqual([]);
    expect(skipped.skipped).toEqual({ templates: ["my.card"], rules: ["my.rule"] });

    const replaced = mustImport(text, { existingTemplateIds: ["my.card"], onConflict: "replace" });
    expect(replaced.theme.templates[0]?.id).toBe("my.card");
    expect(replaced.replaced.templates).toEqual(["my.card"]);
  });

  it("与内置 id 冲突时总是改名（即使策略是 replace）", () => {
    const hijack = { ...builtinTemplates[1], builtin: false } as CardTemplate;
    const rule = { ...builtinRules[0], templateId: hijack.id } as (typeof builtinRules)[number];
    const res = mustImport(exportTheme({ name: "x", templates: [hijack], rules: [rule] }), {
      onConflict: "replace",
    });
    expect(res.theme.templates[0]?.id).toBe("imported.term");
    expect(res.theme.rules[0]?.id).toBe("imported.rule.callout");
    expect(res.theme.rules[0]?.templateId).toBe("imported.term");
  });

  it("文件内部重复的 id 也会去重", () => {
    const dup = JSON.stringify({
      format: "quirenote-theme",
      version: 1,
      name: "x",
      templates: [myTemplate, myTemplate],
    });
    const res = mustImport(dup);
    expect(res.theme.templates.map((t) => t.id)).toEqual(["my.card", "my.card-2"]);
  });
});
