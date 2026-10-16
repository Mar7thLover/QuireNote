import type { Message } from "@quirenote/core";
import { describe, expect, it } from "vitest";
import { latestLeaf, visiblePath } from "./tree";

let t = 0;
const m = (id: string, parentId: string | null, role: "user" | "assistant" = "user"): Message => ({
  id,
  parentId,
  role,
  conversationId: "c",
  content: id,
  citations: [],
  model: null,
  status: "done",
  createdAt: new Date(2026, 0, 1, 0, 0, t++).toISOString(),
});

// u1 → a1 → u2 → a2
//         ↘ u2b → a2b      （编辑 u2 产生的分支）
//    ↘ a1b                 （重新生成 a1）
const msgs = [
  m("u1", null),
  m("a1", "u1", "assistant"),
  m("u2", "a1"),
  m("a2", "u2", "assistant"),
  m("u2b", "a1"),
  m("a2b", "u2b", "assistant"),
  m("a1b", "u1", "assistant"),
];

describe("chat tree", () => {
  it("无 activeLeaf 时沿最新分支走到叶子", () => {
    expect(visiblePath(msgs, null).map((p) => p.message.id)).toEqual(["u1", "a1b"]);
  });

  it("按 activeLeaf 计算路径和兄弟序号", () => {
    const path = visiblePath(msgs, "a2b");
    expect(path.map((p) => p.message.id)).toEqual(["u1", "a1", "u2b", "a2b"]);
    expect(path[1]).toMatchObject({ index: 0 });
    expect(path[1]!.siblings.map((s) => s.id)).toEqual(["a1", "a1b"]);
    expect(path[2]).toMatchObject({ index: 1 });
  });

  it("切换分支后走到该分支最新叶子", () => {
    expect(latestLeaf(msgs, "a1")).toBe("a2b");
    expect(latestLeaf(msgs, "u2")).toBe("a2");
  });

  it("activeLeaf 不存在时回退", () => {
    expect(visiblePath(msgs, "nope").at(-1)!.message.id).toBe("a1b");
  });
});
