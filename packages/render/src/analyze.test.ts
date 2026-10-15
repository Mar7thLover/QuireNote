import { describe, expect, it } from "vitest";
import { analyzePattern } from "./analyze";
import { builtinRules } from "./builtin/rules";

const codes = (pattern: string, flags = "") => analyzePattern(pattern, flags).issues.map((i) => i.code);

describe("analyzePattern", () => {
  it.each([
    "(a+)+",
    "^(a+)+$",
    "(\\w+\\s?)*$",
    "(?:\\s*\\w+)*x",
    "(.*)*y",
    "((ab)*c?)+",
    "([a-z]+)*\\d",
    "(?<x>\\d+)+!",
  ])("嵌套量词 %s → danger", (pattern) => {
    const res = analyzePattern(pattern);
    expect(res.risk).toBe("danger");
    expect(res.issues.map((i) => i.code)).toContain("nested-quantifier");
  });

  it("报告问题位置与片段", () => {
    const [issue] = analyzePattern("x(a+)+y").issues;
    expect(issue).toMatchObject({ code: "nested-quantifier", start: 1, end: 6, snippet: "(a+)+" });
  });

  it.each(["(a|ab)*c", "(.|\\s)*x", "(\\w|\\d)+!"])("重叠交替 %s → 警告", (pattern) => {
    expect(codes(pattern)).toContain("overlapping-alternation");
  });

  it("忽略大小写时字母大小写视为重叠", () => {
    expect(codes("(?:a|B|b)+", "")).not.toContain("overlapping-alternation");
    expect(codes("(?:a|B|b)+", "i")).toContain("overlapping-alternation");
    expect(codes("(?:[a-c]|C)+", "")).not.toContain("overlapping-alternation");
    expect(codes("(?:[a-c]|C)+", "i")).toContain("overlapping-alternation");
  });

  it.each(["\\d+\\d+x", ".*.*=.*", "\\w+\\s*\\w+$"])("相邻重叠量词 %s → 警告", (pattern) => {
    expect(codes(pattern)).toContain("adjacent-quantifiers");
    expect(analyzePattern(pattern).risk).toBe("warning");
  });

  it("超大重复次数给出警告", () => {
    expect(codes("a{2000}")).toContain("large-repeat");
  });

  it.each([
    "(\\d+,)*\\d+",
    "(?:[^,]+,)*",
    "(a+b)*",
    "【术语：([^｜|】]+)｜([^】]+)】",
    "^#{1,6}\\s(.+)$",
    "(?:\\|\\||[^|])+",
    "\\b(?:foo|bar)+\\b",
    "(?<=\\$)\\d+(?:\\.\\d{2})?",
  ])("安全模式 %s → 无问题", (pattern) => {
    expect(analyzePattern(pattern)).toEqual({ valid: true, risk: "none", issues: [] });
  });

  it("非法正则返回 valid=false 而不是抛出", () => {
    const res = analyzePattern("(abc");
    expect(res.valid).toBe(false);
    expect(res.error).toBeTruthy();
    expect(res.issues[0]?.code).toBe("invalid");
  });

  it("所有内置规则都没有风险", () => {
    for (const rule of builtinRules) {
      expect(analyzePattern(rule.pattern, rule.flags), rule.id).toEqual({
        valid: true,
        risk: "none",
        issues: [],
      });
    }
  });
});
