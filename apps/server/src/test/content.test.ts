/** 笔记资源、知识书（含对话注入）、Quire 卡导入导出、酒馆格式导入、备份包里的知识书与资源。 */
import type {
  Asset,
  Conversation,
  LorebookSettings,
  LoreEntry,
  Message,
  Note,
  Notebook,
  QuireCard,
} from "@quirenote/core";
import { strToU8, unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeServer, readSse, type TestServer } from "./helpers";

const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

let s: TestServer;
let demo: Notebook;
const prompts: unknown[] = [];

beforeAll(async () => {
  s = await makeServer({
    seed: true,
    aiSpy: (url, body) => {
      if (url.endsWith("/chat/completions")) prompts.push(body);
    },
  });
  demo = (await s.json<Notebook[]>("/notebooks"))[0]!;
});

afterAll(async () => {
  await s.dispose();
});

const upload = (
  path: string,
  bytes: Uint8Array,
  name: string,
  extra: Record<string, string> = {},
  server: TestServer = s,
) => {
  const form = new FormData();
  form.append("file", new File([bytes as BlobPart], name));
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return server.request(path, { method: "POST", body: form });
};
const newNotebook = (title: string) => s.json<Notebook>("/notebooks", { method: "POST", json: { title } });

describe("部分更新", () => {
  it("PATCH 只改给出的字段，不把其余字段重置成默认值", async () => {
    const nb = await s.json<Notebook>("/notebooks", {
      method: "POST",
      json: { title: "补丁", description: "简介", icon: "🧠", color: "rose" },
    });
    const pinned = await s.json<Notebook>(`/notebooks/${nb.id}`, { method: "PATCH", json: { pinned: true } });
    expect(pinned).toMatchObject({ pinned: true, description: "简介", icon: "🧠", color: "rose" });

    await s.json(`/notebooks/${nb.id}/lorebook`, {
      method: "PATCH",
      json: { token_budget: 300, recursive: true },
    });
    const book = await s.json<LorebookSettings>(`/notebooks/${nb.id}/lorebook`, {
      method: "PATCH",
      json: { enabled: false },
    });
    expect(book).toMatchObject({ enabled: false, token_budget: 300, recursive: true });

    const e = await s.json<LoreEntry>(`/notebooks/${nb.id}/lorebook/entries`, {
      method: "POST",
      json: { name: "条目", keys: ["k"], content: "正文", position: "at_depth" },
    });
    const updated = await s.json<LoreEntry>(`/lorebook/entries/${e.id}`, {
      method: "PATCH",
      json: { priority: 5 },
    });
    expect(updated).toMatchObject({
      priority: 5,
      name: "条目",
      keys: ["k"],
      content: "正文",
      position: "at_depth",
    });
  });
});

describe("资源", () => {
  it("上传图片、按内容去重、原样读回", async () => {
    const nb = await newNotebook("资源测试");
    const res = await upload(`/notebooks/${nb.id}/assets`, PNG, "dot.png");
    expect(res.status).toBe(201);
    const a = (await res.json()) as Asset;
    expect(a.id).toMatch(/^ast_\w+\.png$/);
    expect(a.mime).toBe("image/png");
    const again = (await (await upload(`/notebooks/${nb.id}/assets`, PNG, "other.png")).json()) as Asset;
    expect(again.id).toBe(a.id);
    const file = await s.request(`/assets/${a.id}`);
    expect(file.headers.get("content-type")).toContain("image/png");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PNG);
  });

  it("SVG 去掉脚本；不认识的类型拒绝", async () => {
    const nb = await newNotebook("SVG");
    const svg = strToU8(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect onload="x()" width="2"/></svg>',
    );
    const a = (await (await upload(`/notebooks/${nb.id}/assets`, svg, "x.svg")).json()) as Asset;
    const text = await (await s.request(`/assets/${a.id}`)).text();
    expect(text).not.toMatch(/script|onload/i);
    expect(text).toContain("<rect");
    expect((await upload(`/notebooks/${nb.id}/assets`, strToU8("MZ executable"), "a.exe")).status).toBe(400);
    expect((await s.request("/assets/..%2F..%2Fsecret.png")).status).toBe(404);
  });
});

describe("知识书", () => {
  let nb: Notebook;
  beforeAll(async () => {
    nb = await newNotebook("知识书测试");
  });

  it("条目增删改、整本设置、测试触发", async () => {
    const created = await s.json<LoreEntry>(`/notebooks/${nb.id}/lorebook/entries`, {
      method: "POST",
      json: { name: "端点星", keys: ["端点星", "Terminus"], content: "端点星位于银河边缘。" },
    });
    expect(created).toMatchObject({ notebookId: nb.id, position: "after_sources", enabled: true });
    await s.json(`/lorebook/entries/${created.id}`, { method: "PATCH", json: { priority: 5 } });
    await s.json(`/notebooks/${nb.id}/lorebook/entries`, {
      method: "POST",
      json: { name: "常驻", constant: true, content: "总是在。" },
    });
    const settings = await s.json<LorebookSettings>(`/notebooks/${nb.id}/lorebook`, {
      method: "PATCH",
      json: { token_budget: 500, recursive: true },
    });
    expect(settings).toMatchObject({ token_budget: 500, recursive: true, scan_depth: 4 });
    const book = await s.json<{ settings: LorebookSettings; entries: LoreEntry[] }>(
      `/notebooks/${nb.id}/lorebook`,
    );
    expect(book.entries).toHaveLength(2);
    expect(book.entries.find((e) => e.id === created.id)!.priority).toBe(5);

    const test = await s.json<{ entries: { name: string; trigger: string }[] }>(
      `/notebooks/${nb.id}/lorebook/test`,
      {
        method: "POST",
        json: { text: "我们去 terminus 看看" },
      },
    );
    expect(test.entries.map((e) => [e.name, e.trigger]).sort()).toEqual([
      ["常驻", "constant"],
      ["端点星", "direct"],
    ]);
    await s.json(`/lorebook/entries/${created.id}`, { method: "DELETE" });
    expect((await s.json<{ entries: LoreEntry[] }>(`/notebooks/${nb.id}/lorebook`)).entries).toHaveLength(1);
  });

  it("从元素生成条目，同名不重复", async () => {
    const ts = new Date().toISOString();
    await s.ctx.store.elements.insert({
      id: "el_test_seldon",
      ownerId: s.ctx.store.ownerId,
      notebookId: nb.id,
      type: "person",
      name: "哈里·谢顿",
      definition: "心理史学的创立者。",
      aliases: ["谢顿"],
      refs: [],
      relations: [],
      mastery: 0,
      props: {},
      createdAt: ts,
      updatedAt: ts,
    } as never);
    const r = await s.json<{ created: number }>(`/notebooks/${nb.id}/lorebook/from-elements?lang=en`, {
      method: "POST",
    });
    expect(r.created).toBe(1);
    const again = await s.json<{ created: number }>(`/notebooks/${nb.id}/lorebook/from-elements`, {
      method: "POST",
    });
    expect(again.created).toBe(0);
    const entry = (await s.json<{ entries: LoreEntry[] }>(`/notebooks/${nb.id}/lorebook`)).entries.find(
      (e) => e.name === "哈里·谢顿",
    )!;
    expect(entry.keys).toEqual(["哈里·谢顿", "谢顿"]);
    expect(entry.content).toBe("哈里·谢顿: 心理史学的创立者。");
  });

  it("导出为酒馆世界书（需要启用「酒馆兼容」插件）", async () => {
    const off = await s.request(`/notebooks/${nb.id}/lorebook/export?format=sillytavern`);
    expect(off.status).toBe(400);
    expect(((await off.json()) as { error: { code: string } }).error.code).toBe("plugin_disabled");
    await s.json("/plugins/sillytavern", { method: "PUT", json: { enabled: true } });
    const res = await s.request(`/notebooks/${nb.id}/lorebook/export?format=sillytavern`);
    const wi = (await res.json()) as { entries: Record<string, { key: string[]; constant: boolean }> };
    expect(Object.values(wi.entries).some((e) => e.constant)).toBe(true);
    expect(res.headers.get("content-disposition")).toContain(".json");
  });
});

describe("对话里的知识书", () => {
  let conv: Conversation;
  beforeAll(async () => {
    const post = (json: unknown) =>
      s.json(`/notebooks/${demo.id}/lorebook/entries`, { method: "POST", json });
    await post({ name: "会议", keys: ["达特茅斯"], content: "LORE-AFTER-MARK", order: 10 });
    await post({ name: "前置", constant: true, content: "LORE-BEFORE-MARK", position: "before_sources" });
    await post({
      name: "深处",
      constant: true,
      content: "LORE-DEPTH-MARK",
      position: "at_depth",
      depth: 0,
      role: "user",
    });
    await post({ name: "不相干", keys: ["量子色动力学"], content: "LORE-NEVER-MARK" });
    await s.json(`/notebooks/${demo.id}`, {
      method: "PATCH",
      json: { aiInstructions: "NB-INSTRUCTIONS-MARK" },
    });
    conv = await s.json<Conversation>(`/notebooks/${demo.id}/conversations`, { method: "POST", json: {} });
  });

  it("触发的条目按位置进提示词，记在回答上，不进引用", async () => {
    prompts.length = 0;
    const res = await s.request(`/conversations/${conv.id}/messages`, {
      method: "POST",
      json: { content: "达特茅斯会议是哪一年召开的？", parentId: null },
    });
    const events = await readSse(res);
    const done = events.at(-1)!.data as Message;
    expect(done.status).toBe("done");
    expect(done.lore?.map((l) => l.name).sort()).toEqual(["会议", "前置", "深处"]);
    expect(done.lore?.find((l) => l.name === "会议")?.trigger).toBe("direct");
    expect(done.citations.length).toBeGreaterThan(0);
    expect(done.citations.every((c) => !c.quote.includes("LORE-"))).toBe(true);

    const body = prompts.at(-1) as { messages: { role: string; content: unknown }[] };
    const text = (m: { content: unknown }) =>
      typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    const system = body.messages
      .filter((m) => m.role === "system")
      .map(text)
      .join("\n");
    expect(system).toContain("NB-INSTRUCTIONS-MARK");
    expect(system).toContain("LORE-BEFORE-MARK");
    expect(system).toContain("LORE-AFTER-MARK");
    expect(system).not.toContain("LORE-NEVER-MARK");
    // 资料片段在 before 与 after 之间
    expect(system.indexOf("LORE-BEFORE-MARK")).toBeLessThan(system.indexOf("达特茅斯"));
    expect(system.lastIndexOf("LORE-AFTER-MARK")).toBeGreaterThan(system.indexOf("达特茅斯"));
    // 深度 0：紧贴在最后一条用户消息之后
    const all = body.messages.map(text);
    const depthIdx = all.findIndex((m) => m.includes("LORE-DEPTH-MARK"));
    expect(depthIdx).toBeGreaterThan(-1);
    expect(depthIdx).toBeGreaterThan(all.findIndex((m) => m.includes("达特茅斯会议是哪一年")));
  });

  it("整本停用后不再插入", async () => {
    await s.json(`/notebooks/${demo.id}/lorebook`, { method: "PATCH", json: { enabled: false } });
    const events = await readSse(
      await s.request(`/conversations/${conv.id}/messages`, {
        method: "POST",
        json: { content: "达特茅斯会议有谁参加？", parentId: null },
      }),
    );
    expect((events.at(-1)!.data as Message).lore).toBeUndefined();
    const body = prompts.at(-1) as { messages: { content: unknown }[] };
    expect(JSON.stringify(body)).not.toContain("LORE-BEFORE-MARK");
    expect(JSON.stringify(body)).toContain("NB-INSTRUCTIONS-MARK");
    await s.json(`/notebooks/${demo.id}/lorebook`, { method: "PATCH", json: { enabled: true } });
  });
});

describe("Quire 卡", () => {
  let nb: Notebook;
  let note: Note;
  let asset: Asset;

  beforeAll(async () => {
    nb = await newNotebook("基地");
    asset = (await (await upload(`/notebooks/${nb.id}/assets`, PNG, "map.png")).json()) as Asset;
    note = await s.json<Note>(`/notebooks/${nb.id}/notes`, {
      method: "POST",
      json: {
        title: "心理史学",
        markdown: `# 心理史学\n\n![地图](asset://${asset.id})\n\n【概念：心理史学】`,
      },
    });
    await s.json(`/notebooks/${nb.id}/notes`, {
      method: "POST",
      json: { title: "第二篇", markdown: "无图" },
    });
    await s.json(`/notebooks/${nb.id}/lorebook/entries`, {
      method: "POST",
      json: { name: "谢顿", keys: ["谢顿"], content: "谢顿是数学家。" },
    });
    await s.json(`/notebooks/${nb.id}`, {
      method: "PATCH",
      json: {
        aiInstructions: "像图书管理员一样回答。",
        render: {
          rules: [
            {
              id: "rule_term",
              name: "概念",
              enabled: true,
              pattern: "【概念：([^】]+)】",
              flags: "g",
              templateId: "tpl_term",
              replacement: "",
              slots: { "1": "name" },
              scopes: ["note"],
              order: 1,
            },
            {
              id: "rule_unused",
              name: "没用到",
              enabled: true,
              pattern: "【从未出现】",
              flags: "g",
              templateId: null,
              replacement: "x",
              slots: {},
              scopes: ["note"],
              order: 2,
            },
          ],
          templates: [
            {
              id: "tpl_term",
              name: "概念卡",
              description: "",
              html: "<b>{{name}}</b>",
              css: "",
              slots: [{ name: "name", sample: "" }],
              builtin: false,
            },
          ],
        },
      },
    });
  });

  it("单条笔记：JSON 里内联资源，只带用到的规则", async () => {
    const res = await s.request(`/notes/${note.id}/card?format=json&creator=Mar`);
    expect(res.headers.get("content-type")).toContain("application/json");
    const card = (await res.json()) as QuireCard;
    expect(card.spec).toBe("quire_card_v1");
    expect(card.data).toMatchObject({ kind: "note", name: "心理史学", creator: "Mar" });
    expect(card.data.notes).toHaveLength(1);
    expect(card.data.assets).toHaveLength(1);
    expect(card.data.assets[0]!.uri).toMatch(/^data:image\/png;base64,/);
    expect(card.data.render?.rules.map((r) => r.id)).toEqual(["rule_term"]);
    expect(card.data.render?.templates.map((t) => t.id)).toEqual(["tpl_term"]);
    expect(card.data.lorebook).toBeUndefined();
  });

  it("整本：默认带知识书和 AI 说明，不带资料；可关掉", async () => {
    const card = (await (await s.request(`/notebooks/${nb.id}/card?format=json`)).json()) as QuireCard;
    expect(card.data.kind).toBe("notebook");
    expect(card.data.notes).toHaveLength(2);
    expect(card.data.lorebook?.entries.map((e) => e.name)).toEqual(["谢顿"]);
    expect(card.data.ai_instructions).toBe("像图书管理员一样回答。");
    expect(card.data.sources).toEqual([]);
    const bare = (await (
      await s.request(`/notebooks/${nb.id}/card?format=json&lorebook=0&instructions=0&render=0`)
    ).json()) as QuireCard;
    expect(bare.data.lorebook).toBeUndefined();
    expect(bare.data.ai_instructions).toBe("");
    expect(bare.data.render).toBeUndefined();
    const withSources = (await (
      await s.request(`/notebooks/${demo.id}/card?format=json&sources=1`)
    ).json()) as QuireCard;
    expect(withSources.data.sources.length).toBeGreaterThan(0);
    expect(withSources.data.sources[0]!.text.length).toBeGreaterThan(20);
  });

  it(".quire 压缩包：card.json + assets/", async () => {
    const res = await s.request(`/notebooks/${nb.id}/card?format=quire`);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toContain(".quire");
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const card = JSON.parse(new TextDecoder().decode(files["card.json"])) as QuireCard;
    const uri = card.data.assets[0]!.uri;
    expect(uri).toMatch(/^embedded:\/\/assets\//);
    expect(files[uri.replace("embedded://", "")]).toEqual(PNG);
  });

  it("预览后导入为新 Notebook：笔记、资源、规则、知识书、说明都在", async () => {
    const zip = new Uint8Array(
      await (await s.request(`/notebooks/${nb.id}/card?format=quire`)).arrayBuffer(),
    );
    const preview = await (await upload("/cards/preview", zip, "基地.quire")).json();
    expect(preview).toMatchObject({
      format: "quire-zip",
      kind: "notebook",
      name: "基地",
      lore: { total: 1, constant: [] },
      rules: { total: 2, disabled: [] },
      assets: 1,
      aiInstructions: "像图书管理员一样回答。",
    });
    const res = await upload("/cards/import", zip, "基地.quire");
    expect(res.status).toBe(201);
    const r = (await res.json()) as {
      notebookId: string;
      created: boolean;
      notes: number;
      lore: number;
      assets: number;
    };
    expect(r).toMatchObject({ created: true, notes: 2, lore: 1, assets: 1 });
    const copy = await s.json<Notebook>(`/notebooks/${r.notebookId}`);
    expect(copy.title).toBe("基地");
    expect(copy.aiInstructions).toBe("像图书管理员一样回答。");
    expect(copy.render?.rules.map((x) => x.id).sort()).toEqual(["rule_term", "rule_unused"]);
    const notes = await s.json<Note[]>(`/notebooks/${r.notebookId}/notes`);
    const md = notes.find((n) => n.title === "心理史学")!.markdown;
    const id = /asset:\/\/([\w.-]+)/.exec(md)![1]!;
    expect(id).not.toBe(asset.id);
    expect(new Uint8Array(await (await s.request(`/assets/${id}`)).arrayBuffer())).toEqual(PNG);
    expect(
      (await s.json<{ entries: LoreEntry[] }>(`/notebooks/${r.notebookId}/lorebook`)).entries,
    ).toHaveLength(1);
  });

  it("合并进已有 Notebook：规则改名不冲突，已有 AI 说明不覆盖", async () => {
    const json = new Uint8Array(
      await (await s.request(`/notebooks/${nb.id}/card?format=json`)).arrayBuffer(),
    );
    const res = await upload("/cards/import", json, "基地.quire.json", { notebookId: nb.id, lang: "en" });
    const r = (await res.json()) as { created: boolean; warnings: string[] };
    expect(r.created).toBe(false);
    expect(r.warnings.some((w) => w.includes("already has AI instructions"))).toBe(true);
    const after = await s.json<Notebook>(`/notebooks/${nb.id}`);
    expect(after.render?.rules.map((x) => x.id)).toEqual([
      "rule_term",
      "rule_unused",
      "rule_term-2",
      "rule_unused-2",
    ]);
    expect(after.render?.templates.map((x) => x.id)).toEqual(["tpl_term", "tpl_term-2"]);
    expect(after.render!.rules[2]!.templateId).toBe("tpl_term-2");
    expect((await s.json<Note[]>(`/notebooks/${nb.id}/notes`)).length).toBe(4);
  });

  it("有回溯风险的规则导入为停用", async () => {
    const card = (await (await s.request(`/notes/${note.id}/card?format=json`)).json()) as QuireCard;
    card.data.render!.rules[0]!.pattern = "(a+)+$";
    const bytes = strToU8(JSON.stringify(card));
    const preview = (await (await upload("/cards/preview", bytes, "x.json")).json()) as {
      rules: { disabled: string[] };
    };
    expect(preview.rules.disabled).toEqual(["概念"]);
    const r = (await (await upload("/cards/import", bytes, "x.json")).json()) as {
      notebookId: string;
      warnings: string[];
    };
    expect((await s.json<Notebook>(`/notebooks/${r.notebookId}`)).render!.rules[0]!.enabled).toBe(false);
    expect(r.warnings.length).toBe(1);
  });

  it("坏文件返回 400 和说明", async () => {
    const res = await upload("/cards/preview", PNG, "plain.png", { lang: "en" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("no_card_data");
    expect(body.error.message).toMatch(/no card data/i);
  });
});

describe("插件", () => {
  it("「酒馆兼容」默认关闭，数据里已有酒馆内容也不自动开启", async () => {
    const fresh = await makeServer();
    try {
      const list = await fresh.json<{ id: string; enabled: boolean }[]>("/plugins");
      expect(list).toEqual([expect.objectContaining({ id: "sillytavern", enabled: false, builtin: true })]);
      const card = { spec: "chara_card_v2", data: { name: "A", description: "d", first_mes: "hi" } };
      const res = await upload("/cards/preview", strToU8(JSON.stringify(card)), "a.json", {}, fresh);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: expect.objectContaining({ code: "plugin_disabled", plugin: "sillytavern" }),
      });
      // 开启后可以导入；关闭后已导入的内容还在
      await fresh.json("/plugins/sillytavern", { method: "PUT", json: { enabled: true } });
      const r = (await (
        await upload("/cards/import", strToU8(JSON.stringify(card)), "a.json", {}, fresh)
      ).json()) as {
        notebookId: string;
      };
      await fresh.json("/plugins/sillytavern", { method: "PUT", json: { enabled: false } });
      expect(
        (await fresh.json<{ entries: unknown[] }>(`/notebooks/${r.notebookId}/lorebook`)).entries.length,
      ).toBeGreaterThan(0);
    } finally {
      await fresh.dispose();
    }
    // 已有酒馆内容（世界书条目带 extensions.sillytavern）的数据：仍然保持关闭
    const legacy = await makeServer();
    try {
      const nb = await legacy.json<Notebook>("/notebooks", { method: "POST", json: { title: "旧数据" } });
      await legacy.json(`/notebooks/${nb.id}/lorebook/entries`, {
        method: "POST",
        json: { name: "x", extensions: { sillytavern: { uid: 0 } } },
      });
      const list = await legacy.json<{ id: string; enabled: boolean }[]>("/plugins");
      expect(list[0]!.enabled).toBe(false);
    } finally {
      await legacy.dispose();
    }
  });
});

describe("酒馆格式导入", () => {
  beforeAll(async () => {
    await s.json("/plugins/sillytavern", { method: "PUT", json: { enabled: true } });
  });

  it("V2 角色卡 JSON → 新 Notebook：设定笔记、常驻条目、系统提示词", async () => {
    const card = {
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: {
        name: "Aria",
        description: "{{char}} is a ship AI.",
        personality: "calm",
        scenario: "deep space",
        first_mes: "Systems online, {{user}}.",
        mes_example: "",
        system_prompt: "Play {{char}}.",
        creator: "tester",
        tags: [],
        extensions: {},
        character_book: {
          entries: [
            { id: 1, keys: ["reactor"], content: "The reactor hums.", enabled: true, insertion_order: 5 },
          ],
        },
      },
    };
    const r = (await (
      await upload("/cards/import", strToU8(JSON.stringify(card)), "Aria.json", { lang: "en" })
    ).json()) as {
      notebookId: string;
      notes: number;
      lore: number;
    };
    expect(r).toMatchObject({ notes: 2, lore: 2 });
    const nb = await s.json<Notebook>(`/notebooks/${r.notebookId}`);
    expect(nb).toMatchObject({ title: "Aria", icon: "🎭", aiInstructions: "Play Aria." });
    const notes = await s.json<Note[]>(`/notebooks/${r.notebookId}/notes`);
    expect(notes.map((n) => n.title).sort()).toEqual(["Aria · Character", "Aria · Greetings and examples"]);
    const entries = (await s.json<{ entries: LoreEntry[] }>(`/notebooks/${r.notebookId}/lorebook`)).entries;
    expect(entries.find((e) => e.constant)?.content).toContain("Aria is a ship AI.");
    expect(entries.find((e) => e.keys.includes("reactor"))?.order).toBe(5);
  });

  it("世界书导入进已有 Notebook 只加条目", async () => {
    const nb = await newNotebook("世界书目标");
    const wi = {
      entries: { "0": { uid: 0, key: ["Trantor"], content: "Capital world.", comment: "Trantor" } },
    };
    const r = (await (
      await upload("/cards/import", strToU8(JSON.stringify(wi)), "galaxy.json", { notebookId: nb.id })
    ).json()) as {
      notebookId: string;
      notes: number;
      lore: number;
    };
    expect(r).toMatchObject({ notebookId: nb.id, notes: 0, lore: 1 });
  });
});

describe("备份包里的知识书与资源", () => {
  it(".quirenote.zip 导出再导入，条目和资源都在", async () => {
    const nb = await newNotebook("备份");
    const a = (await (await upload(`/notebooks/${nb.id}/assets`, PNG, "p.png")).json()) as Asset;
    await s.json(`/notebooks/${nb.id}/notes`, {
      method: "POST",
      json: { title: "图", markdown: `![](asset://${a.id})` },
    });
    await s.json(`/notebooks/${nb.id}/lorebook/entries`, {
      method: "POST",
      json: { name: "条目", keys: ["k"], content: "c" },
    });
    const zip = new Uint8Array(await (await s.request(`/notebooks/${nb.id}/export`)).arrayBuffer());
    const form = new FormData();
    form.append("file", new File([zip], "nb.zip"));
    const copy = await s.json<Notebook>("/import", { method: "POST", body: form });
    const entries = (await s.json<{ entries: LoreEntry[] }>(`/notebooks/${copy.id}/lorebook`)).entries;
    expect(entries.map((e) => e.name)).toEqual(["条目"]);
    expect(entries[0]!.notebookId).toBe(copy.id);
    const md = (await s.json<Note[]>(`/notebooks/${copy.id}/notes`))[0]!.markdown;
    const id = /asset:\/\/([\w.-]+)/.exec(md)![1]!;
    expect(id).not.toBe(a.id);
    expect(new Uint8Array(await (await s.request(`/assets/${id}`)).arrayBuffer())).toEqual(PNG);
  });

  it("删除 Notebook 时一并删掉条目和资源", async () => {
    const nb = await newNotebook("将删除");
    const a = (await (await upload(`/notebooks/${nb.id}/assets`, PNG, "p.png")).json()) as Asset;
    await s.json(`/notebooks/${nb.id}/lorebook/entries`, { method: "POST", json: { name: "x" } });
    await s.json(`/notebooks/${nb.id}`, { method: "DELETE" });
    expect((await s.request(`/assets/${a.id}`)).status).toBe(404);
    expect(await s.ctx.store.lore.list({ notebookId: nb.id })).toEqual([]);
  });
});
