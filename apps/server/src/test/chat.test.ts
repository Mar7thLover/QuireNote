import type { Citation, Conversation, Message, Notebook } from "@quirenote/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pathTo } from "../services/chat";
import { makeServer, readSse, type TestServer } from "./helpers";

let s: TestServer;
let nb: Notebook;
let conv: Conversation;

beforeAll(async () => {
  s = await makeServer({ seed: true });
  nb = (await s.json<Notebook[]>("/notebooks"))[0]!;
  conv = await s.json<Conversation>(`/notebooks/${nb.id}/conversations`, { method: "POST", json: {} });
});

afterAll(async () => {
  await s.dispose();
});

async function send(body: Record<string, unknown>) {
  const res = await s.request(`/conversations/${conv.id}/messages`, { method: "POST", json: body });
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  return readSse(res);
}

describe("chat with citations", () => {
  let firstUser: Message;
  let firstAnswer: Message;

  it("streams user → start → delta* → citations → done with valid citations", async () => {
    const events = await send({ content: "达特茅斯会议是哪一年召开的？", parentId: null });
    const names = events.map((e) => e.event);
    expect(names[0]).toBe("user");
    expect(names[1]).toBe("start");
    expect(names.filter((n) => n === "delta").length).toBeGreaterThan(2);
    expect(names.slice(-2)).toEqual(["citations", "done"]);
    firstUser = events[0]!.data as Message;
    firstAnswer = events.at(-1)!.data as Message;
    expect((events[1]!.data as { id: string }).id).toBe(firstAnswer.id);
    const streamed = events
      .filter((e) => e.event === "delta")
      .map((e) => (e.data as { text: string }).text)
      .join("");
    expect(streamed.length).toBeGreaterThan(20);
    const citations = events.find((e) => e.event === "citations")!.data as Citation[];
    expect(citations.length).toBeGreaterThan(0);
    expect(citations.some((c) => c.sourceTitle.includes("达特茅斯"))).toBe(true);
    expect(firstAnswer.content).toContain("1956");
    // 每个引用都能在资料全文中定位到原文。
    for (const c of citations) {
      const content = await s.json<{ text: string }>(`/sources/${c.sourceId}/content`);
      expect(content.text.slice(c.start, c.end)).toBe(c.quote);
      expect(firstAnswer.content).toContain(`[${c.n}`);
    }
    expect(firstAnswer.status).toBe("done");
    expect(firstAnswer.model).toMatch(/^prov_\w+:fake-chat$/);
    const updated = await s.json<Conversation>(`/conversations/${conv.id}`);
    expect(updated.activeLeafId).toBe(firstAnswer.id);
    expect(updated.title).toContain("达特茅斯");
  });

  it("continues the thread, then branches by editing the first question", async () => {
    const follow = await send({ content: "感知机有什么局限？", parentId: firstAnswer.id });
    const followUser = follow[0]!.data as Message;
    expect(followUser.parentId).toBe(firstAnswer.id);

    // 编辑第一条消息 = 以其 parent（null）为父新建分支。
    const edit = await send({ content: "图灵测试是什么？", parentId: firstUser.parentId });
    const editUser = edit[0]!.data as Message;
    const editAnswer = edit.at(-1)!.data as Message;
    expect(editUser.parentId).toBeNull();
    const all = await s.json<Message[]>(`/conversations/${conv.id}/messages`);
    expect(all.filter((m) => m.parentId === null)).toHaveLength(2);
    expect(all).toHaveLength(6);
    // 新分支路径不包含旧分支。
    const path = pathTo(all, editAnswer.id).map((m) => m.id);
    expect(path).toEqual([editUser.id, editAnswer.id]);
    expect((await s.json<Conversation>(`/conversations/${conv.id}`)).activeLeafId).toBe(editAnswer.id);

    // 切换回旧分支
    const patched = await s.json<Conversation>(`/conversations/${conv.id}`, {
      method: "PATCH",
      json: { activeLeafId: firstAnswer.id },
    });
    expect(patched.activeLeafId).toBe(firstAnswer.id);
  });

  it("regenerates an answer as a sibling under the same user message", async () => {
    const events = await send({ regenerateOf: firstAnswer.id, parentId: null });
    expect(events[0]!.event).toBe("start");
    const regenerated = events.at(-1)!.data as Message;
    expect(regenerated.id).not.toBe(firstAnswer.id);
    expect(regenerated.parentId).toBe(firstUser.id);
    const all = await s.json<Message[]>(`/conversations/${conv.id}/messages`);
    expect(all.filter((m) => m.parentId === firstUser.id && m.role === "assistant")).toHaveLength(2);
  });

  it("validates input before streaming", async () => {
    const empty = await s.request(`/conversations/${conv.id}/messages`, {
      method: "POST",
      json: { content: " ", parentId: null },
    });
    expect(empty.status).toBe(400);
    expect((await empty.json()).error.code).toBe("bad_request");
    const badParent = await s.request(`/conversations/${conv.id}/messages`, {
      method: "POST",
      json: { content: "hi", parentId: "msg_nope" },
    });
    expect(badParent.status).toBe(400);
    const regenUser = await s.request(`/conversations/${conv.id}/messages`, {
      method: "POST",
      json: { regenerateOf: firstUser.id, parentId: null },
    });
    expect(regenUser.status).toBe(400);
    const missing = await s.request(`/conversations/conv_missing/messages`, {
      method: "POST",
      json: { content: "x", parentId: null },
    });
    expect(missing.status).toBe(404);
  });

  it("answers without sources when none are selected", async () => {
    const sources = await s.json<{ id: string }[]>(`/notebooks/${nb.id}/sources`);
    const events = await send({ content: "图灵测试", parentId: null, sourceIds: ["src_none"] });
    const done = events.at(-1)!.data as Message;
    expect(done.citations).toEqual([]);
    expect(done.content).toMatch(/没有资料片段/);
    expect(sources.length).toBe(3);
  });

  it("strips citation numbers that do not exist (via mocked model)", async () => {
    // 用 OpenAI 兼容 provider + mock fetch 返回带无效编号的回答。
    const sse = (t: string) =>
      `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta: { content: t }, finish_reason: null }] })}\n\n`;
    const finish = `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`;
    const body = `${sse("1956 年召开 [1]，")}${sse("另见 [42]。")}${finish}data: [DONE]\n\n`;
    const mock = (async () =>
      new Response(body, { headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch;
    const s2 = await makeServer({ seed: true, aiFetch: mock });
    try {
      const prov = await s2.json<{ id: string }>("/providers", {
        method: "POST",
        json: {
          kind: "openai-compatible",
          name: "mock",
          baseUrl: "http://mock.local/v1",
          apiKey: "sk-test-0000",
        },
      });
      await s2.json("/models/assignments", {
        method: "PUT",
        json: { capability: "chat", providerId: prov.id, model: "m" },
      });
      const nb2 = (await s2.json<Notebook[]>("/notebooks"))[0]!;
      const c2 = await s2.json<Conversation>(`/notebooks/${nb2.id}/conversations`, {
        method: "POST",
        json: {},
      });
      const res = await s2.request(`/conversations/${c2.id}/messages`, {
        method: "POST",
        json: { content: "达特茅斯会议", parentId: null },
      });
      const events = await readSse(res);
      const done = events.at(-1)!.data as Message;
      expect(done.content).toBe("1956 年召开 [1]，另见。");
      expect(done.citations.map((c) => c.n)).toEqual([1]);
      expect(done.model).toBe(`${prov.id}:m`);
    } finally {
      await s2.dispose();
    }
  });
});

describe("switching models inside a conversation", () => {
  it("uses the conversation's model, validates it, and falls back when its provider goes away", async () => {
    const alt = await s.json<{ id: string }>("/providers", {
      method: "POST",
      json: {
        kind: "openai-compatible",
        name: "备用",
        baseUrl: "http://fake-llm.test/v1",
        models: [{ id: "fake-alt", capabilities: ["chat"] }],
      },
    });
    const c = await s.json<Conversation>(`/notebooks/${nb.id}/conversations`, { method: "POST", json: {} });
    expect(c.model).toBeNull();
    const switched = await s.json<Conversation>(`/conversations/${c.id}`, {
      method: "PATCH",
      json: { model: { providerId: alt.id, model: "fake-alt" } },
    });
    expect(switched.model).toEqual({ providerId: alt.id, model: "fake-alt" });
    const ask = async () => {
      const res = await s.request(`/conversations/${c.id}/messages`, {
        method: "POST",
        json: { content: "图灵测试", parentId: null },
      });
      return (await readSse(res)).at(-1)!.data as Message;
    };
    expect((await ask()).model).toBe(`${alt.id}:fake-alt`);

    // 不支持对话的 provider、不存在的 provider 都拒绝。
    const search = await s.json<{ id: string }>("/providers", {
      method: "POST",
      json: { kind: "tavily", name: "搜索", apiKey: "tvly-x" },
    });
    for (const providerId of [search.id, "prov_missing"]) {
      const bad = await s.request(`/conversations/${c.id}`, {
        method: "PATCH",
        json: { model: { providerId, model: "x" } },
      });
      expect(bad.status).toBe(400);
    }

    // provider 删除后退回全局对话分配。
    await s.json(`/providers/${alt.id}`, { method: "DELETE" });
    expect((await ask()).model).toMatch(/:fake-chat$/);
    const reset = await s.json<Conversation>(`/conversations/${c.id}`, {
      method: "PATCH",
      json: { model: null },
    });
    expect(reset.model).toBeNull();
  });
});
