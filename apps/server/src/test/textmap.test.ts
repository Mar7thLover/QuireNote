import { describe, expect, it } from "vitest";
import { equalRuns, offsetMap, relocateRange, remapPageOffsets } from "../textmap";

const relocate = (a: string, b: string, start: number, end: number) =>
  relocateRange(offsetMap(a, b), a, b, start, end);

describe("text offset mapping", () => {
  it("maps positions across an insertion before them", () => {
    const a = "第一段。\n第二段有重点。\n";
    const b = "前言。\n第一段。\n第二段有重点。\n";
    const s = a.indexOf("重点");
    expect(relocate(a, b, s, s + 2)).toEqual({ start: b.indexOf("重点"), end: b.indexOf("重点") + 2 });
  });

  it("drops ranges whose text was rewritten", () => {
    const a = "保留这一句。\n这句会被改掉。\n";
    const b = "保留这一句。\n完全不同的内容。\n";
    const s = a.indexOf("会被改掉");
    expect(relocate(a, b, s, s + 4)).toBeNull();
    expect(relocate(a, b, 0, 5)).toEqual({ start: 0, end: 5 });
  });

  it("follows a range when the same line moved elsewhere", () => {
    const a = "A 行\nB 行\n重点句子在这里\n";
    const b = "重点句子在这里\nA 行\nB 行\n";
    const s = a.indexOf("重点");
    expect(relocate(a, b, s, s + 4)).toEqual({ start: 0, end: 4 });
  });

  it("handles edits inside the same line by searching for the quote", () => {
    const a = "前面的话，重点在此，后面的话。";
    const b = "前面改过的话，重点在此，后面的话。";
    const s = a.indexOf("重点在此");
    expect(relocate(a, b, s, s + 4)).toEqual({
      start: b.indexOf("重点在此"),
      end: b.indexOf("重点在此") + 4,
    });
  });

  it("keeps runs ordered and non-overlapping", () => {
    const runs = equalRuns("a\nb\nc\nd\n", "a\nx\nc\nd\ny\n");
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i]!.a).toBeGreaterThanOrEqual(runs[i - 1]!.a + runs[i - 1]!.len);
      expect(runs[i]!.b).toBeGreaterThanOrEqual(runs[i - 1]!.b + runs[i - 1]!.len);
    }
  });

  it("moves page offsets and keeps them monotonic from 0", () => {
    const a = "第一页内容\n第二页内容\n第三页内容\n";
    const b = "新增\n第一页内容\n第三页内容\n";
    const pages = [0, a.indexOf("第二页"), a.indexOf("第三页")];
    const out = remapPageOffsets(offsetMap(a, b), pages);
    expect(out[0]).toBe(0);
    expect(out[2]).toBe(b.indexOf("第三页"));
    expect(out[1]).toBeLessThanOrEqual(out[2]!);
  });
});
