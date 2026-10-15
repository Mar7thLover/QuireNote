import { describe, expect, it } from "vitest";
import { newId, parseCitationMarkers, usedCitationNumbers } from "./util";

describe("parseCitationMarkers", () => {
  it("解析单个和组合编号", () => {
    const text = "图灵于 1950 年提出模仿游戏[1]。后来塞尔反驳[2, 3]，并且[4][5]。";
    expect(parseCitationMarkers(text).map((m) => m.n)).toEqual([1, 2, 3, 4, 5]);
  });

  it("忽略代码块里的方括号", () => {
    const text = "数组 `a[1]` 不算，```\nx[2]\n``` 也不算，但这个算[3]";
    expect(usedCitationNumbers(text)).toEqual([3]);
  });

  it("去重保序", () => {
    expect(usedCitationNumbers("a[2] b[1] c[2]")).toEqual([2, 1]);
  });

  it("忽略 0 和非数字", () => {
    expect(usedCitationNumbers("[0] [x] [12a]")).toEqual([]);
  });
});

describe("newId", () => {
  it("带前缀且唯一", () => {
    const a = newId("nb");
    expect(a).toMatch(/^nb_[0-9a-z]{14}$/);
    expect(newId("nb")).not.toBe(a);
  });
});
