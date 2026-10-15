import { describe, expect, it } from "vitest";
import { collapseContext, diffLines } from "./diff";

describe("diffLines", () => {
  it("识别新增、删除和不变的行", () => {
    const d = diffLines("a\nb\nc", "a\nx\nc\nd");
    expect(d).toEqual([
      { type: "same", text: "a" },
      { type: "del", text: "b" },
      { type: "add", text: "x" },
      { type: "same", text: "c" },
      { type: "add", text: "d" },
    ]);
  });

  it("空文本到有内容", () => {
    expect(diffLines("", "x").filter((l) => l.type === "add")).toHaveLength(1);
  });

  it("折叠远离改动的上下文", () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n");
    const after = before.replace("l10", "changed");
    const c = collapseContext(diffLines(before, after), 1);
    expect(c[0]).toEqual({ type: "gap", count: 9 });
    expect(c.filter((l) => l.type === "add")).toHaveLength(1);
    // 删除行与新增行各占一行，所以后面的上下文从第 13 项开始
    expect(c.at(-1)).toEqual({ type: "gap", count: 8 });
  });
});
