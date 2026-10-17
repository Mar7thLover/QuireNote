import type { Conversation, Note, Notebook } from "@quirenote/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { retrieve } from "../retrieval";
import { countWords, type Overview, type UsageSummary } from "../services/insights";
import { makeServer, readSse, type TestServer } from "./helpers";

let s: TestServer;
let nb: Notebook;

beforeAll(async () => {
  s = await makeServer({ seed: true });
  nb = (await s.json<Notebook[]>("/notebooks"))[0]!;
});

afterAll(async () => {
  await s.dispose();
});

describe("word counts", () => {
  it("counts CJK characters one by one and other scripts by word", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("图灵测试")).toBe(4);
    expect(countWords("Hello, world")).toBe(2);
    expect(countWords("# 标题\n\n**AI** 的历史 2024 年")).toBe(2 + 1 + 3 + 1 + 1);
  });
});

describe("usage tracking", () => {
  it("records tokens for every model call and summarizes them", async () => {
    const before = await s.json<UsageSummary>("/usage/summary");
    const conv = await s.json<Conversation>(`/notebooks/${nb.id}/conversations`, {
      method: "POST",
      json: {},
    });
    const res = await s.request(`/conversations/${conv.id}/messages`, {
      method: "POST",
      json: { content: "达特茅斯会议是哪一年召开的？", parentId: null },
    });
    await readSse(res);
    const after = await s.json<UsageSummary>("/usage/summary");
    expect(after.month.calls).toBeGreaterThan(before.month.calls);
    expect(after.week.inputTokens).toBeGreaterThan(before.week.inputTokens);
    expect(after.week.outputTokens).toBeGreaterThan(before.week.outputTokens);
    expect(after.daily).toHaveLength(14);
    expect(after.daily.at(-1)!.day).toBe(after.today);
    expect(after.daily.at(-1)!.tokens).toBeGreaterThan(0);
    // 假模型没有价目：Token 计入 unpricedTokens，不估算花费。
    expect(after.month.cost).toBe(0);
    expect(after.month.unpricedTokens).toBeGreaterThan(0);
    expect(after.byModel[0]?.model).toBe("fake-chat");
    expect(after.budget).toBeNull();
  });

  it("prices Claude usage and reports the monthly budget", async () => {
    await s.ctx.store.usage.add({
      day: (await s.json<UsageSummary>("/usage/summary")).today,
      providerId: "prov_claude",
      model: "claude-sonnet-5-5",
      kind: "chat",
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      searches: 2,
    });
    await s.json("/settings/aiBudget", { method: "PUT", json: { monthlyUsd: 20 } });
    const sum = await s.json<UsageSummary>("/usage/summary");
    // $2 输入 + $1 输出 + 2 次搜索 $0.02
    expect(sum.month.cost).toBeCloseTo(3.02, 5);
    expect(sum.budget).toBe(20);
    expect(sum.byModel.find((m) => m.model === "claude-sonnet-5-5")?.cost).toBeCloseTo(3.02, 5);
  });
});

describe("home overview", () => {
  it("lists recently opened notes first and counts words", async () => {
    const a = await s.json<Note>(`/notebooks/${nb.id}/notes`, {
      method: "POST",
      json: { title: "旧笔记", markdown: "图灵测试" },
    });
    const b = await s.json<Note>(`/notebooks/${nb.id}/notes`, {
      method: "POST",
      json: { title: "新笔记", markdown: "Hello world" },
    });
    await s.json(`/notes/${a.id}/opened`, { method: "POST" });
    const ov = await s.json<Overview>("/overview");
    expect(ov.recent[0]?.id).toBe(a.id);
    expect(ov.recent[0]?.openedAt).toBeTruthy();
    expect(ov.recent[0]?.notebookTitle).toBe(nb.title);
    expect(ov.recent[0]?.words).toBe(4);
    // 从未打开过的笔记按修改时间补位，openedAt 为空。
    expect(ov.recent.find((r) => r.id === b.id)?.openedAt).toBeNull();
    expect(ov.writing.words).toBeGreaterThanOrEqual(6);
    expect(ov.writing.notes).toBeGreaterThanOrEqual(2);
    expect((await s.request("/notes/nope/opened", { method: "POST" })).status).toBe(404);
  });
});

describe("retrieval without an embedding model", () => {
  it("expands the question with the chat model and still finds passages", async () => {
    const chat = await s.ctx.models.resolve("chat");
    const { results, warning } = await retrieve(s.ctx.store, nb.id, "达特茅斯会议", {
      embedding: null,
      expand: chat,
    });
    expect(warning).toBeUndefined();
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.sourceTitle.includes("达特茅斯"))).toBe(true);
  });
});
