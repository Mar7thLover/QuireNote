import { describe, expect, it } from "vitest";
import { applyRulesSync, planRules } from "./engine";
import { makeRule } from "./test-utils";
import type { Segment } from "./types";

const text = (segments: Segment[]) =>
  segments.map((s) => (s.type === "text" ? s.text : `[${s.templateId}]`)).join("");

describe("规则顺序与作用域", () => {
  it("按 order 升序执行，相同 order 保持原顺序", () => {
    const rules = [
      makeRule({ id: "a", pattern: "foo", replacement: "bar", order: 2 }),
      makeRule({ id: "b", pattern: "bar", replacement: "baz", order: 1 }),
    ];
    // b 先执行：foo bar → foo baz；a 再执行：→ bar baz
    expect(text(applyRulesSync("foo bar", rules).segments)).toBe("bar baz");
    expect(
      planRules([makeRule({ id: "x", pattern: "x" }), makeRule({ id: "y", pattern: "y" })]).map((r) => r.id),
    ).toEqual(["x", "y"]);
  });

  it("只执行作用域匹配且启用的规则", () => {
    const rules = [
      makeRule({ id: "chat", pattern: "A", replacement: "c", scopes: ["chat"] }),
      makeRule({ id: "note", pattern: "B", replacement: "n", scopes: ["note"] }),
      makeRule({ id: "off", pattern: "C", replacement: "x", enabled: false }),
    ];
    expect(text(applyRulesSync("ABC", rules, { scope: "chat" }).segments)).toBe("cBC");
    expect(text(applyRulesSync("ABC", rules, { scope: "note" }).segments)).toBe("AnC");
    expect(text(applyRulesSync("ABC", rules).segments)).toBe("cnC");
  });
});

describe("纯文本替换", () => {
  it("支持 $1、$<name>、$&、$$", () => {
    const rules = [
      makeRule({ id: "r1", pattern: "(\\w+)@(\\w+)", replacement: "$2 的 $1" }),
      makeRule({ id: "r2", pattern: "(?<n>\\d+)元", replacement: "¥$<n>（$&）$$", order: 1 }),
    ];
    const { segments, errors } = applyRulesSync("alice@home 花了 30元", rules);
    expect(errors).toEqual([]);
    expect(segments).toEqual([{ type: "text", text: "home 的 alice 花了 ¥30（30元）$" }]);
  });

  it("没有 g 标志时只替换第一处", () => {
    const rules = [makeRule({ id: "r", pattern: "a", flags: "", replacement: "b" })];
    expect(text(applyRulesSync("aaa", rules).segments)).toBe("baa");
  });

  it("空匹配不会死循环", () => {
    const rules = [makeRule({ id: "quote", pattern: "^", flags: "gm", replacement: "> " })];
    expect(text(applyRulesSync("一\n二", rules).segments)).toBe("> 一\n> 二");
  });
});

describe("卡片段", () => {
  it("编号捕获组通过 slots 映射成变量，值去掉首尾空白", () => {
    const rules = [
      makeRule({
        id: "term",
        pattern: "【术语：([^｜】]+)｜([^】]+)】",
        templateId: "tpl.term",
        slots: { "1": "term", "2": "def" },
      }),
    ];
    const { segments } = applyRulesSync("前文【术语： 熵 ｜不确定性】后文", rules);
    expect(segments).toEqual([
      { type: "text", text: "前文" },
      {
        type: "card",
        templateId: "tpl.term",
        vars: { term: "熵", def: "不确定性" },
        raw: "【术语： 熵 ｜不确定性】",
        ruleId: "term",
      },
      { type: "text", text: "后文" },
    ]);
  });

  it("命名捕获组直接作为变量名，slots 可以再映射/覆盖", () => {
    const rules = [
      makeRule({
        id: "named",
        pattern: "<(?<who>\\w+)\\s+(?<what>[^>]*)>",
        templateId: "tpl",
        slots: { what: "message", "1": "speaker" },
      }),
    ];
    const [card] = applyRulesSync("<bob hello there>", rules).segments;
    expect(card).toMatchObject({
      type: "card",
      vars: { who: "bob", what: "hello there", message: "hello there", speaker: "bob" },
    });
  });

  it("未参与匹配的组得到空字符串", () => {
    const rules = [
      makeRule({ id: "opt", pattern: "\\[(a)?(b)\\]", templateId: "t", slots: { "1": "x", "2": "y" } }),
    ];
    expect(applyRulesSync("[b]", rules).segments[0]).toMatchObject({ vars: { x: "", y: "b" } });
  });

  it("前面规则产出的卡片不会被后面的规则再处理", () => {
    const rules = [
      makeRule({ id: "card", pattern: "【(\\w+)】", templateId: "t", slots: { "1": "v" }, order: 1 }),
      makeRule({ id: "text", pattern: "\\w+", replacement: "X", order: 2 }),
      makeRule({ id: "card2", pattern: "【", templateId: "t2", order: 3 }),
    ];
    const { segments } = applyRulesSync("ab【cd】ef", rules);
    expect(segments).toEqual([
      { type: "text", text: "X" },
      { type: "card", templateId: "t", vars: { v: "cd" }, raw: "【cd】", ruleId: "card" },
      { type: "text", text: "X" },
    ]);
  });

  it("接受已分段的输入，并且不修改输入", () => {
    const input: Segment[] = [
      { type: "text", text: "a1" },
      { type: "card", templateId: "t", vars: { k: "1" }, raw: "1", ruleId: "x" },
      { type: "text", text: "b1" },
    ];
    const snapshot = structuredClone(input);
    const { segments } = applyRulesSync(input, [makeRule({ id: "d", pattern: "\\d", replacement: "#" })]);
    expect(text(segments)).toBe("a#[t]b#");
    expect(input).toEqual(snapshot);
  });

  it("模板规则忽略空匹配", () => {
    const rules = [makeRule({ id: "e", pattern: "x*", templateId: "t" })];
    const { segments } = applyRulesSync("axxb", rules);
    expect(segments.filter((s) => s.type === "card")).toHaveLength(1);
    expect(text(segments)).toBe("a[t]b");
  });
});

describe("非法正则", () => {
  it("返回错误信息而不是抛出，其余规则照常执行", () => {
    const rules = [
      makeRule({ id: "bad", name: "坏规则", pattern: "(unclosed", order: 1 }),
      makeRule({ id: "badflags", pattern: "a", flags: "gx", order: 2 }),
      makeRule({ id: "good", pattern: "a", replacement: "b", order: 3 }),
    ];
    const { segments, errors } = applyRulesSync("aa", rules);
    expect(text(segments)).toBe("bb");
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({ ruleId: "bad", ruleName: "坏规则", kind: "invalid-pattern" });
    expect(errors[0]?.message).toBeTruthy();
    expect(errors[1]).toMatchObject({ ruleId: "badflags", kind: "invalid-pattern" });
  });
});
