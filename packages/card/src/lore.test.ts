import {
  type CardLoreEntry,
  DEFAULT_LOREBOOK,
  CardLoreEntry as Entry,
  type LorebookSettings,
} from "@quirenote/core";
import { describe, expect, it } from "vitest";
import { activateLore, estimateTokens, keyMatches, riskyLoreKeys } from "./lore";

const e = (id: string, fields: Partial<CardLoreEntry> = {}): CardLoreEntry =>
  Entry.parse({ id, name: id, ...fields });
const book = (patch: Partial<LorebookSettings> = {}): LorebookSettings => ({ ...DEFAULT_LOREBOOK, ...patch });
const ids = (r: ReturnType<typeof activateLore>) => r.entries.map((a) => a.entry.id);

describe("keyMatches", () => {
  it("默认不区分大小写，中文按字串匹配", () => {
    expect(keyMatches("Terminus", "we land on terminus", false, false)).toBe(true);
    expect(keyMatches("Terminus", "we land on terminus", true, false)).toBe(false);
    expect(keyMatches("端点", "抵达端点星", false, true)).toBe(true);
  });

  it("整词只对拉丁字母生效", () => {
    expect(keyMatches("cat", "concatenate", false, true)).toBe(false);
    expect(keyMatches("cat", "a cat sat", false, true)).toBe(true);
  });

  it("/正则/ 键；有回溯风险的视为不匹配并在导入时标出", () => {
    expect(keyMatches("/seld(o|on)/i", "Hari SELDON", false, false)).toBe(true);
    expect(keyMatches("/(a+)+$/", "aaaa", false, false)).toBe(false);
    expect(riskyLoreKeys([e("bad", { keys: ["/(a+)+$/"] }), e("ok", { keys: ["/a+/"] })])).toEqual([
      { id: "bad", key: "/(a+)+$/" },
    ]);
  });
});

describe("activateLore", () => {
  it("常驻条目总是插入；关键词条目命中才插入", () => {
    const r = activateLore({
      settings: book(),
      entries: [
        e("always", { constant: true, content: "常驻" }),
        e("seldon", { keys: ["谢顿"], content: "谢顿是数学家" }),
      ],
      messages: ["今天天气不错"],
    });
    expect(ids(r)).toEqual(["always"]);
    expect(r.entries[0]!.trigger).toBe("constant");
    const hit = activateLore({
      settings: book(),
      entries: [e("seldon", { keys: ["谢顿"] })],
      messages: ["谢顿是谁"],
    });
    expect(hit.entries[0]!.trigger).toBe("direct");
  });

  it("次关键词四种逻辑", () => {
    const text = ["端点星 基地"];
    const run = (logic: CardLoreEntry["logic"], secondary: string[]) =>
      ids(
        activateLore({
          settings: book(),
          entries: [e("x", { keys: ["端点星"], secondary_keys: secondary, logic })],
          messages: text,
        }),
      );
    expect(run("and_any", ["基地", "帝国"])).toEqual(["x"]);
    expect(run("and_all", ["基地", "帝国"])).toEqual([]);
    expect(run("and_all", ["基地"])).toEqual(["x"]);
    expect(run("not_any", ["帝国"])).toEqual(["x"]);
    expect(run("not_any", ["基地"])).toEqual([]);
    expect(run("not_all", ["基地", "帝国"])).toEqual(["x"]);
    expect(run("not_all", ["基地"])).toEqual([]);
  });

  it("扫描深度：只看最近几条消息", () => {
    const entries = [e("old", { keys: ["川陀"] })];
    const messages = ["川陀", "a", "b", "c"];
    expect(ids(activateLore({ settings: book({ scan_depth: 2 }), entries, messages }))).toEqual([]);
    expect(ids(activateLore({ settings: book({ scan_depth: 3 }), entries, messages }))).toEqual(["old"]);
    expect(
      ids(
        activateLore({
          settings: book({ scan_depth: 0 }),
          entries: [e("x", { keys: ["川陀"], scan_depth: 3 })],
          messages,
        }),
      ),
    ).toEqual(["x"]);
  });

  it("概率、延迟、停用", () => {
    const entries = [
      e("half", { keys: ["k"], probability: 50 }),
      e("late", { keys: ["k"], delay: 4 }),
      e("off", { keys: ["k"], enabled: false }),
    ];
    expect(ids(activateLore({ settings: book(), entries, messages: ["k"], random: () => 0.9 }))).toEqual([]);
    expect(ids(activateLore({ settings: book(), entries, messages: ["k"], random: () => 0.1 }))).toEqual([
      "half",
    ]);
    expect(
      ids(activateLore({ settings: book(), entries, messages: ["k"], turnCount: 4, random: () => 0.1 })),
    ).toEqual(["half", "late"]);
  });

  it("sticky 在触发后保持，cooldown 在触发后跳过", () => {
    const entries = [e("stick", { keys: ["k"], sticky: 2 }), e("cool", { keys: ["k"], cooldown: 2 })];
    const r = activateLore({
      settings: book(),
      entries,
      messages: ["无关"],
      lastUsed: new Map([["stick", 1]]),
    });
    expect(r.entries.map((a) => [a.entry.id, a.trigger])).toEqual([["stick", "sticky"]]);
    expect(
      ids(activateLore({ settings: book(), entries, messages: ["无关"], lastUsed: new Map([["stick", 2]]) })),
    ).toEqual([]);
    expect(
      ids(activateLore({ settings: book(), entries, messages: ["k"], lastUsed: new Map([["cool", 1]]) })),
    ).toEqual(["stick"]);
    expect(
      ids(activateLore({ settings: book(), entries, messages: ["k"], lastUsed: new Map([["cool", 2]]) })),
    ).toEqual(["cool", "stick"]);
  });

  it("同组只留一条，按权重抽取", () => {
    const entries = [
      e("a", { keys: ["k"], group: "g", group_weight: 10 }),
      e("b", { keys: ["k"], group: "g", group_weight: 90 }),
    ];
    expect(ids(activateLore({ settings: book(), entries, messages: ["k"], random: () => 0.05 }))).toEqual([
      "a",
    ]);
    expect(ids(activateLore({ settings: book(), entries, messages: ["k"], random: () => 0.5 }))).toEqual([
      "b",
    ]);
  });

  it("递归：入选条目的正文触发别的条目；prevent / exclude / 层数上限", () => {
    const entries = [
      e("a", { keys: ["基地"], content: "基地由谢顿建立" }),
      e("b", { keys: ["谢顿"], content: "谢顿提出心理史学" }),
      e("c", { keys: ["心理史学"], content: "心理史学预测群体" }),
      e("d", { keys: ["谢顿"], content: "不该被递归触发", exclude_recursion: true }),
    ];
    const msg = ["说说基地"];
    expect(ids(activateLore({ settings: book(), entries, messages: msg }))).toEqual(["a"]);
    const deep = activateLore({ settings: book({ recursive: true }), entries, messages: msg });
    expect(ids(deep).sort()).toEqual(["a", "b", "c"]);
    expect(deep.entries.find((x) => x.entry.id === "b")!.trigger).toBe("recursive");
    expect(
      ids(
        activateLore({ settings: book({ recursive: true, max_recursion: 1 }), entries, messages: msg }),
      ).sort(),
    ).toEqual(["a", "b"]);
    const prevented = entries.map((x) => (x.id === "a" ? { ...x, prevent_recursion: true } : x));
    expect(
      ids(activateLore({ settings: book({ recursive: true }), entries: prevented, messages: msg })),
    ).toEqual(["a"]);
  });

  it("预算：先保常驻，再保直接命中，最后递归；同级按优先级", () => {
    const long = "字".repeat(100);
    const entries = [
      e("const", { constant: true, content: long, priority: 1 }),
      e("low", { keys: ["k"], content: long, priority: 10 }),
      e("high", { keys: ["k"], content: long, priority: 90 }),
    ];
    const r = activateLore({ settings: book({ token_budget: 210 }), entries, messages: ["k"] });
    expect(ids(r).sort()).toEqual(["const", "high"]);
    expect(r.trimmed.map((a) => a.entry.id)).toEqual(["low"]);
    expect(r.tokens).toBe(200);
    expect(ids(activateLore({ settings: book({ token_budget: 0 }), entries, messages: ["k"] }))).toHaveLength(
      3,
    );
  });

  it("按位置和顺序分组输出", () => {
    const r = activateLore({
      settings: book(),
      entries: [
        e("late", { constant: true, content: "后", order: 200 }),
        e("early", { constant: true, content: "前", order: 10 }),
        e("pre", { constant: true, content: "资料前", position: "before_sources" }),
        e("deep", { constant: true, content: "深处", position: "at_depth", depth: 2, role: "user" }),
      ],
      messages: ["q"],
    });
    expect(r.after).toBe("前\n\n后");
    expect(r.before).toBe("资料前");
    expect(r.atDepth).toEqual([{ depth: 2, role: "user", content: "深处" }]);
    expect(ids(r)).toEqual(["early", "deep", "pre", "late"]);
  });

  it("整本停用时什么都不插入", () => {
    expect(
      activateLore({
        settings: book({ enabled: false }),
        entries: [e("x", { constant: true })],
        messages: ["q"],
      }).entries,
    ).toEqual([]);
  });

  it("token 估算：中文每字 1 个，其他 4 字符 1 个", () => {
    expect(estimateTokens("一二三")).toBe(3);
    expect(estimateTokens("abcdefgh")).toBe(2);
  });
});
