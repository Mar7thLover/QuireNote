import { CardTemplate, RenderRule } from "@quirenote/core";
import { describe, expect, it } from "vitest";
import { builtinRuleSamples, builtinRules } from "./builtin/rules";
import { builtinTemplates } from "./builtin/templates";
import { applyRulesSync } from "./engine";
import { templateVariables } from "./template";
import type { CardSegment } from "./types";

const cards = (input: string) =>
  applyRulesSync(input, builtinRules).segments.filter((s): s is CardSegment => s.type === "card");

const only = (input: string) => {
  const list = cards(input);
  expect(list, input).toHaveLength(1);
  return list[0] as CardSegment;
};

describe("内置模板", () => {
  it("七个模板齐全、符合 schema、id 唯一，slots 覆盖模板用到的变量", () => {
    expect(builtinTemplates.map((t) => t.name)).toEqual([
      "知识卡",
      "术语卡",
      "对比卡",
      "时间线卡",
      "引用卡",
      "要点 / 提示卡",
      "数据卡",
    ]);
    expect(new Set(builtinTemplates.map((t) => t.id)).size).toBe(builtinTemplates.length);
    for (const t of builtinTemplates) {
      expect(CardTemplate.parse(t)).toEqual(t);
      expect(t.builtin).toBe(true);
      const slotNames = t.slots.map((s) => s.name);
      for (const v of templateVariables(t.html)) expect(slotNames, `${t.id} 缺少 slot ${v}`).toContain(v);
    }
  });

  it("模板只通过主题变量取色", () => {
    for (const t of builtinTemplates) {
      expect(t.css).toContain("var(--card-");
      // 不允许直接写死背景/文字颜色（提示卡的语义色调除外）
      expect(t.css, t.id).not.toMatch(/(?:^|[;{])(?:color|background(?:-color)?):\s*#/m);
    }
  });
});

describe("内置规则", () => {
  it("规则符合 schema，引用的模板都存在，示例文本各自命中", () => {
    const templateIds = new Set(builtinTemplates.map((t) => t.id));
    for (const rule of builtinRules) {
      expect(RenderRule.parse(rule)).toEqual(rule);
      expect(templateIds.has(rule.templateId ?? "")).toBe(true);
      const sample = builtinRuleSamples[rule.id];
      expect(sample, rule.id).toBeDefined();
      const card = only(sample ?? "");
      expect(card.ruleId).toBe(rule.id);
      expect(card.raw).toBe(sample);
    }
  });

  it("术语卡：全角和半角竖线、全角和半角冒号都支持", () => {
    for (const input of [
      "【术语：熵｜不确定性的度量】",
      "【术语:熵|不确定性的度量】",
      "【术语： 熵 | 不确定性的度量 】",
    ]) {
      expect(only(input)).toMatchObject({
        templateId: "builtin.term",
        vars: { term: "熵", definition: "不确定性的度量" },
      });
    }
    expect(only("【Term: Entropy | a measure of uncertainty | 熵】").vars).toEqual({
      term: "Entropy",
      definition: "a measure of uncertainty",
      alias: "熵",
    });
  });

  it("对比卡：|| 是列表分隔符，单个 | 或 ｜ 是字段分隔符", () => {
    const expected = {
      leftTitle: "TCP",
      rightTitle: "UDP",
      leftPoints: "面向连接||可靠传输",
      rightPoints: "无连接||开销小",
    };
    expect(only("【对比：TCP｜UDP｜面向连接||可靠传输｜无连接||开销小】").vars).toEqual(expected);
    expect(only("【对比:TCP|UDP|面向连接||可靠传输|无连接||开销小】").vars).toEqual(expected);
  });

  it("数据卡、引用卡、时间线卡、知识卡、要点卡", () => {
    expect(only("【数据：3.8 亿｜月活用户｜2024 Q4】").vars).toEqual({
      value: "3.8 亿",
      label: "月活用户",
      note: "2024 Q4",
    });
    expect(only("【引用：知识就是力量｜培根】").vars).toEqual({ quote: "知识就是力量", source: "培根" });
    expect(only("【引用：没有出处的话】").vars).toEqual({ quote: "没有出处的话", source: "" });
    expect(only("【时间线：1950::图灵测试||1956::达特茅斯】").vars).toEqual({
      title: "",
      events: "1950::图灵测试||1956::达特茅斯",
    });
    expect(only("【时间线：简史|1950::图灵测试||1956::达特茅斯】").vars).toEqual({
      title: "简史",
      events: "1950::图灵测试||1956::达特茅斯",
    });
    expect(only("【知识：标题｜正文】").vars).toEqual({ title: "标题", body: "正文", points: "" });
    expect(only("【要点：复习｜回忆||间隔】")).toMatchObject({
      templateId: "builtin.knowledge",
      vars: { title: "复习", points: "回忆||间隔" },
    });
  });

  it("提示卡：行首 > [!kind]，大小写不限，多行文本中逐行匹配", () => {
    const input = "正文\n> [!tip] 先回忆再看答案\n> 普通引用\n>[!WARNING]别熬夜\n";
    const list = cards(input);
    expect(list.map((c) => c.vars)).toEqual([
      { kind: "tip", content: "先回忆再看答案" },
      { kind: "WARNING", content: "别熬夜" },
    ]);
    expect(cards("文中 > [!tip] 不在行首")).toHaveLength(0);
  });

  it("混合文本：卡片与正文交错，格式不完整时保持原文", () => {
    const input =
      "定义见【术语：熵｜不确定性】。数据【数据：71%｜海洋覆盖率】。残缺的【术语：只有名字】保持原样。";
    const { segments, errors } = applyRulesSync(input, builtinRules, { scope: "chat" });
    expect(errors).toEqual([]);
    expect(segments.map((s) => s.type)).toEqual(["text", "card", "text", "card", "text"]);
    expect(segments[4]).toEqual({ type: "text", text: "。残缺的【术语：只有名字】保持原样。" });
  });
});
