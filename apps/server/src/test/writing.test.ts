/** 小说写作：续写带前文提要与大纲、按大纲起草、一致性检查、章节摘要、稿件导出。 */
import type { Note, Notebook } from "@quirenote/core";
import { strFromU8, unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookToMarkdown, markdownToXhtml } from "../services/writing";
import { makeServer, readSse, type TestServer } from "./helpers";

let s: TestServer;
let nb: Notebook;
let ch1: Note;
let ch2: Note;
const bodies: { messages: { role: string; content: unknown }[] }[] = [];

beforeAll(async () => {
  s = await makeServer({
    aiSpy: (url, body) => {
      if (url.endsWith("/chat/completions")) bodies.push(body as (typeof bodies)[number]);
    },
  });
  nb = await s.json<Notebook>("/notebooks/from-template", {
    method: "POST",
    json: { templateId: "builtin.novel", title: "雾港", lang: "zh" },
  });
  const notes = await s.json<Note[]>(`/notebooks/${nb.id}/notes`);
  ch1 = notes.find((n) => n.title === "第一章")!;
  ch1 = await s.json<Note>(`/notes/${ch1.id}`, {
    method: "PATCH",
    json: { markdown: "林岚在雾港的码头上岸。她的左手戴着一只旧手套。\n\n灯塔的光每隔七秒扫过海面。" },
  });
  ch2 = await s.json<Note>(`/notebooks/${nb.id}/notes`, {
    method: "POST",
    json: { title: "第二章", markdown: "林岚推开旅馆的门。" },
  });
  await s.json(`/notebooks/${nb.id}/lorebook/entries`, {
    method: "POST",
    json: { name: "林岚", keys: ["林岚"], content: "LORE-LINLAN 林岚，二十六岁，左手有烧伤，从不摘手套。" },
  });
  nb = await s.json<Notebook>(`/notebooks/${nb.id}`, {
    method: "PATCH",
    json: {
      manuscript: {
        volumes: [
          {
            id: nb.manuscript!.volumes[0]!.id,
            title: "第一卷",
            chapters: [
              { noteId: ch1.id, synopsis: "林岚抵达雾港。", beats: [] },
              {
                noteId: ch2.id,
                synopsis: "OUTLINE-MARK 她在旅馆遇见老船长。",
                beats: ["老船长认出了她的手套", "她假装不认识"],
              },
            ],
          },
        ],
      },
    },
  });
});

afterAll(async () => {
  await s.dispose();
});

const sysText = (b: (typeof bodies)[number]) =>
  b.messages
    .filter((m) => m.role === "system")
    .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
    .join("\n");

describe("续写", () => {
  it("编辑器的「AI 续写」能用了；章节里续写带上前文提要、本章大纲、触发的设定和写作搭档风格", async () => {
    bodies.length = 0;
    const res = await s.request("/ai/transform", {
      method: "POST",
      json: { notebookId: nb.id, noteId: ch2.id, action: "continue", text: "林岚推开旅馆的门。" },
    });
    expect(res.status).toBe(200);
    const events = await readSse(res);
    expect(events.at(-1)!.event).toBe("done");
    const system = sysText(bodies.at(-1)!);
    expect(system).toContain("接着下面这段文字往下写");
    expect(system).toContain("# 前文提要");
    expect(system).toContain("第一章");
    expect(system).toContain("OUTLINE-MARK");
    expect(system).toContain("老船长认出了她的手套");
    expect(system).toContain("LORE-LINLAN");
    expect(system).toContain("写作搭档");
  });

  it("不在稿件里的笔记续写也能用，只是没有前文提要", async () => {
    const free = await s.json<Note>(`/notebooks/${nb.id}/notes`, {
      method: "POST",
      json: { title: "随笔", markdown: "x" },
    });
    bodies.length = 0;
    const res = await s.request("/ai/transform", {
      method: "POST",
      json: { notebookId: nb.id, noteId: free.id, action: "continue", text: "林岚走进雨里。" },
    });
    expect(res.status).toBe(200);
    await readSse(res);
    expect(sysText(bodies.at(-1)!)).not.toContain("# 前文提要");
  });

  it("「AI 大纲」也能用", async () => {
    const res = await s.request("/ai/transform", {
      method: "POST",
      json: { notebookId: nb.id, action: "outline", text: "第一部分……第二部分……" },
    });
    expect(res.status).toBe(200);
  });
});

describe("写作工具", () => {
  it("按大纲起草：没有大纲时提示先写大纲", async () => {
    const empty = await s.json<Note>(`/notebooks/${nb.id}/notes`, {
      method: "POST",
      json: { title: "第三章", markdown: "" },
    });
    const cur = await s.json<Notebook>(`/notebooks/${nb.id}`);
    const ms = structuredClone(cur.manuscript!);
    ms.volumes[0]!.chapters.push({ noteId: empty.id, synopsis: "", beats: [], target: null });
    await s.json(`/notebooks/${nb.id}`, { method: "PATCH", json: { manuscript: ms } });
    const bad = await s.request(`/notebooks/${nb.id}/writing/draft`, {
      method: "POST",
      json: { noteId: empty.id },
    });
    expect(bad.status).toBe(400);
    bodies.length = 0;
    const res = await s.request(`/notebooks/${nb.id}/writing/draft`, {
      method: "POST",
      json: { noteId: ch2.id },
    });
    const events = await readSse(res);
    expect(events.at(-1)!.event).toBe("done");
    const b = bodies.at(-1)!;
    expect(sysText(b)).toContain("LORE-LINLAN");
    expect(JSON.stringify(b.messages.at(-1))).toContain("OUTLINE-MARK");
  });

  it("一致性检查只返回出自正文的句子", async () => {
    const r = await s.json<{ issues: { quote: string }[] }>(`/notebooks/${nb.id}/writing/check`, {
      method: "POST",
      json: { noteId: ch1.id },
    });
    for (const i of r.issues) expect(ch1.markdown).toContain(i.quote);
  });

  it("章节摘要按正文版本缓存，正文改了重新生成", async () => {
    bodies.length = 0;
    const a = await s.json<{ summary: string }>(`/notes/${ch1.id}/summary`, { method: "POST" });
    expect(a.summary.length).toBeGreaterThan(0);
    const calls = bodies.length;
    await s.json(`/notes/${ch1.id}/summary`, { method: "POST" });
    expect(bodies.length).toBe(calls);
    await s.json(`/notes/${ch1.id}`, {
      method: "PATCH",
      json: { markdown: `${ch1.markdown}\n\n新的一段。` },
    });
    await s.json(`/notes/${ch1.id}/summary`, { method: "POST" });
    expect(bodies.length).toBeGreaterThan(calls);
  });
});

describe("稿件导出", () => {
  it("Markdown / Word / EPUB", async () => {
    const md = await (await s.request(`/notebooks/${nb.id}/manuscript/export?format=md`)).text();
    expect(md.startsWith("# 雾港")).toBe(true);
    expect(md.indexOf("## 第一章")).toBeLessThan(md.indexOf("## 第二章"));

    const docx = unzipSync(
      new Uint8Array(
        await (await s.request(`/notebooks/${nb.id}/manuscript/export?format=docx`)).arrayBuffer(),
      ),
    );
    const doc = strFromU8(docx["word/document.xml"]!);
    expect(doc).toContain("林岚在雾港的码头上岸");
    expect(doc).toContain('w:val="Heading1"');

    const res = await s.request(`/notebooks/${nb.id}/manuscript/export?format=epub`);
    expect(res.headers.get("content-type")).toBe("application/epub+zip");
    const bytes = new Uint8Array(await res.arrayBuffer());
    // mimetype 必须是第一个、不压缩的文件
    expect(strFromU8(bytes.subarray(30, 38))).toBe("mimetype");
    const epub = unzipSync(bytes);
    expect(strFromU8(epub.mimetype!)).toBe("application/epub+zip");
    expect(Object.keys(epub).filter((k) => k.endsWith(".xhtml"))).toHaveLength(4);
    expect(strFromU8(epub["OEBPS/chapter-0001.xhtml"]!)).toContain(
      "<p>林岚在雾港的码头上岸。她的左手戴着一只旧手套。</p>",
    );
  });

  it("Markdown 转 XHTML：段落、标题、列表、引用、强调，转义特殊字符", () => {
    expect(markdownToXhtml("# 标题\n\n第一行\n第二行\n\n- a\n- b\n\n> 引文\n\n**粗** & <x>")).toBe(
      "<h2>标题</h2>\n<p>第一行 第二行</p>\n<ul><li>a</li><li>b</li></ul>\n<blockquote><p>引文</p></blockquote>\n<p><strong>粗</strong> &amp; &lt;x&gt;</p>",
    );
    expect(bookToMarkdown({ title: "T", author: "", volumes: [] })).toBe("# T\n");
  });
});
