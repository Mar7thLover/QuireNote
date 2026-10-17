/** 对话预设：内置 / 自定义、对话里生效、导入导出（含酒馆预设与角色卡问答风格）。 */
import type { ChatPreset, Conversation, Notebook } from "@quirenote/core";
import { strToU8 } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeServer, readSse, type TestServer } from "./helpers";

let s: TestServer;
let demo: Notebook;
const bodies: { messages: { role: string; content: unknown }[]; temperature?: number; top_p?: number }[] = [];

beforeAll(async () => {
  s = await makeServer({
    seed: true,
    aiSpy: (url, body) => {
      if (url.endsWith("/chat/completions")) bodies.push(body as (typeof bodies)[number]);
    },
  });
  demo = (await s.json<Notebook[]>("/notebooks"))[0]!;
});

afterAll(async () => {
  await s.dispose();
});

const upload = (path: string, bytes: Uint8Array, name: string, extra: Record<string, string> = {}) => {
  const form = new FormData();
  form.append("file", new File([bytes as BlobPart], name));
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return s.request(path, { method: "POST", body: form });
};
const text = (m: { content: unknown }) =>
  typeof m.content === "string" ? m.content : JSON.stringify(m.content);

async function ask(conv: Conversation, q: string) {
  bodies.length = 0;
  const events = await readSse(
    await s.request(`/conversations/${conv.id}/messages`, {
      method: "POST",
      json: { content: q, parentId: null },
    }),
  );
  expect(events.at(-1)!.event).toBe("done");
  return bodies.at(-1)!;
}

describe("对话预设", () => {
  it("内置预设按界面语言命名；不能修改或删除", async () => {
    const zh = await s.json<ChatPreset[]>("/presets?lang=zh");
    expect(zh.map((p) => p.id)).toEqual([
      "builtin.research",
      "builtin.plain",
      "builtin.quiz",
      "builtin.writer",
    ]);
    expect(zh[1]!.name).toBe("通俗讲解");
    expect((await s.json<ChatPreset[]>("/presets?lang=en"))[1]!.name).toBe("Plain explanation");
    expect((await s.request("/presets/builtin.plain", { method: "PATCH", json: { name: "x" } })).status).toBe(
      400,
    );
    expect((await s.request("/presets/builtin.plain", { method: "DELETE" })).status).toBe(400);
  });

  it("对话选了预设：风格、片段和参数都进请求；没选时用 Notebook 的默认", async () => {
    const preset = await s.json<ChatPreset>("/presets", {
      method: "POST",
      json: {
        name: "严谨",
        instructions: "STYLE-MARK 每个结论都要谨慎。",
        format: "FORMAT-MARK 三段以内",
        temperature: 0.3,
        snippets: [
          { content: "START-MARK", position: "system_start" },
          { content: "AFTER-MARK", position: "after_sources" },
          { content: "LAST-MARK", position: "before_question" },
        ],
      },
    });
    const conv = await s.json<Conversation>(`/notebooks/${demo.id}/conversations`, {
      method: "POST",
      json: { presetId: preset.id },
    });
    expect(conv.presetId).toBe(preset.id);
    const body = await ask(conv, "达特茅斯会议是哪一年？");
    const system = body.messages
      .filter((m) => m.role === "system")
      .map(text)
      .join("\n");
    expect(system.startsWith("START-MARK")).toBe(true);
    expect(system).toContain("# 回答风格");
    expect(system).toContain("STYLE-MARK");
    expect(system).toContain("FORMAT-MARK");
    expect(system.lastIndexOf("AFTER-MARK")).toBeGreaterThan(system.indexOf("[1]"));
    expect(text(body.messages.at(-1)!)).toContain("LAST-MARK");
    expect(body.temperature).toBe(0.3);

    // 换回默认风格后不再带风格；Notebook 默认预设对新对话生效
    await s.json(`/conversations/${conv.id}`, { method: "PATCH", json: { presetId: null } });
    expect(JSON.stringify(await ask(conv, "再问一次"))).not.toContain("STYLE-MARK");
    await s.json(`/notebooks/${demo.id}`, { method: "PATCH", json: { defaultPresetId: "builtin.plain" } });
    const plain = await ask(conv, "第三次");
    expect(JSON.stringify(plain)).toContain("通俗的语言");
    // 删除自定义预设：用到它的 Notebook 默认值回到默认
    await s.json(`/notebooks/${demo.id}`, { method: "PATCH", json: { defaultPresetId: preset.id } });
    await s.json(`/presets/${preset.id}`, { method: "DELETE" });
    expect((await s.json<Notebook>(`/notebooks/${demo.id}`)).defaultPresetId).toBeNull();
    expect(
      (await s.request(`/conversations/${conv.id}`, { method: "PATCH", json: { presetId: preset.id } }))
        .status,
    ).toBe(404);
  });

  it("自定义预设部分修改只改给出的字段", async () => {
    const p = await s.json<ChatPreset>("/presets", {
      method: "POST",
      json: { name: "A", instructions: "保留" },
    });
    const next = await s.json<ChatPreset>(`/presets/${p.id}`, {
      method: "PATCH",
      json: { temperature: 1.1 },
    });
    expect(next).toMatchObject({ name: "A", instructions: "保留", temperature: 1.1, builtin: false });
  });
});

describe("预设的导入导出", () => {
  const stPreset = {
    temperature: 0.8,
    top_p: 0.95,
    openai_max_tokens: 800,
    prompts: [
      { identifier: "main", name: "Main", system_prompt: true, role: "system", content: "Write vividly." },
      { identifier: "chatHistory", name: "Chat History", system_prompt: true, marker: true },
      {
        identifier: "jb",
        name: "Reminder",
        role: "system",
        content: "Stay concise.",
        injection_position: 1,
        injection_depth: 0,
      },
      { identifier: "off", name: "Off", role: "system", content: "SHOULD-NOT-APPEAR" },
    ],
    prompt_order: [
      {
        character_id: 100001,
        order: [
          { identifier: "main", enabled: true },
          { identifier: "chatHistory", enabled: true },
          { identifier: "jb", enabled: true },
          { identifier: "off", enabled: false },
        ],
      },
    ],
  };

  it("QuireNote 预设文件往返", async () => {
    const p = await s.json<ChatPreset>("/presets", {
      method: "POST",
      json: { name: "导出我", instructions: "X" },
    });
    const file = new Uint8Array(await (await s.request(`/presets/${p.id}/export`)).arrayBuffer());
    const r = (await (await upload("/presets/import", file, "a.preset.json")).json()) as {
      preset: ChatPreset;
    };
    expect(r.preset).toMatchObject({ name: "导出我", instructions: "X", builtin: false });
    expect(r.preset.id).not.toBe(p.id);
  });

  it("酒馆预设需要插件；启用后按顺序转换，占位片段略过，按深度插入的变成提问前片段", async () => {
    const bytes = strToU8(JSON.stringify(stPreset));
    const off = await upload("/presets/import", bytes, "Vivid.json");
    expect(((await off.json()) as { error: { code: string } }).error.code).toBe("plugin_disabled");
    await s.json("/plugins/sillytavern", { method: "PUT", json: { enabled: true } });
    const r = (await (await upload("/presets/import", bytes, "Vivid.json")).json()) as {
      preset: ChatPreset;
      warnings: string[];
    };
    expect(r.preset).toMatchObject({
      name: "Vivid",
      instructions: "Write vividly.",
      temperature: 0.8,
      topP: 0.95,
      maxTokens: 800,
      snippets: [{ content: "Stay concise.", position: "before_question", role: "system" }],
    });
    expect(JSON.stringify(r.preset.instructions)).not.toContain("SHOULD-NOT-APPEAR");
    expect(r.warnings.length).toBe(1);
    // 导出回酒馆格式：保留原有字段，主提示词更新
    await s.json(`/presets/${r.preset.id}`, { method: "PATCH", json: { instructions: "Write calmly." } });
    const back = (await (await s.request(`/presets/${r.preset.id}/export?format=sillytavern`)).json()) as {
      prompts: { identifier: string; content?: string }[];
      temperature: number;
    };
    expect(back.prompts.find((x) => x.identifier === "main")!.content).toBe("Write calmly.");
    expect(back.prompts.some((x) => x.identifier === "chatHistory")).toBe(true);
    expect(back.temperature).toBe(0.8);
  });

  it("角色卡导入为问答风格", async () => {
    const card = {
      spec: "chara_card_v2",
      data: {
        name: "Aria",
        description: "{{char}} is a ship AI talking to {{user}}.",
        personality: "calm",
        system_prompt: "Keep answers short.",
        post_history_instructions: "Stay in character.",
        first_mes: "Online.",
      },
    };
    const r = (await (
      await upload("/cards/import", strToU8(JSON.stringify(card)), "Aria.json", { as: "preset", lang: "en" })
    ).json()) as { preset: ChatPreset };
    expect(r.preset.name).toBe("Aria");
    expect(r.preset.instructions).toContain('You are playing "Aria"');
    expect(r.preset.instructions).toContain("Aria is a ship AI talking to you.");
    expect(r.preset.instructions).toContain("Keep answers short.");
    expect(r.preset.snippets).toEqual([
      { content: "Stay in character.", position: "before_question", role: "system" },
    ]);
    const world = { entries: { "0": { uid: 0, key: ["k"], content: "c" } } };
    const bad = await upload("/cards/import", strToU8(JSON.stringify(world)), "w.json", { as: "preset" });
    expect(bad.status).toBe(400);
  });
});
