/** Notebook 模板：内置模板新建（含稿件与默认预设）、把 Notebook 存成模板、卡片带上稿件结构。 */
import type { LorebookSettings, Note, Notebook, NotebookTemplateInfo, QuireCard } from "@quirenote/core";
import { strToU8 } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeServer, type TestServer } from "./helpers";

let s: TestServer;

beforeAll(async () => {
  s = await makeServer();
});

afterAll(async () => {
  await s.dispose();
});

describe("Notebook 模板", () => {
  it("内置模板跟随界面语言", async () => {
    const zh = await s.json<NotebookTemplateInfo[]>("/notebook-templates?lang=zh");
    expect(zh.map((t) => t.id)).toEqual(["builtin.research", "builtin.reading-club", "builtin.novel"]);
    expect(zh[2]!.name).toBe("小说项目");
    expect((await s.json<NotebookTemplateInfo[]>("/notebook-templates?lang=en"))[2]!.name).toBe(
      "Novel project",
    );
  });

  it("从「小说项目」新建：笔记、稿件、写作搭档预设、AI 说明都在，标题用填的", async () => {
    const nb = await s.json<Notebook>("/notebooks/from-template", {
      method: "POST",
      json: { templateId: "builtin.novel", title: "雾港", icon: "🌫️", lang: "zh" },
    });
    expect(nb).toMatchObject({ title: "雾港", icon: "🌫️", color: "rose", defaultPresetId: "builtin.writer" });
    expect(nb.aiInstructions).toContain("小说");
    const notes = await s.json<Note[]>(`/notebooks/${nb.id}/notes`);
    expect(notes.map((n) => n.title).sort()).toEqual(["主角", "世界观", "故事梗概", "第一章"].sort());
    const chapter = notes.find((n) => n.title === "第一章")!;
    expect(nb.manuscript?.volumes).toEqual([
      expect.objectContaining({
        title: "第一卷",
        chapters: [expect.objectContaining({ noteId: chapter.id })],
      }),
    ]);
    const book = await s.json<{ settings: LorebookSettings }>(`/notebooks/${nb.id}/lorebook`);
    expect(book.settings).toMatchObject({ name: "人物与设定", recursive: true });
  });

  it("占位符在新建时填上", async () => {
    const nb = await s.json<Notebook>("/notebooks/from-template", {
      method: "POST",
      json: { templateId: "builtin.research", lang: "zh" },
    });
    const log = (await s.json<Note[]>(`/notebooks/${nb.id}/notes`)).find((n) => n.title === "进展日志")!;
    expect(log.markdown).toMatch(/^## \d{4}-\d{2}-\d{2}/);
  });

  it("把 Notebook 存成模板，再从它新建；可以改名和删除", async () => {
    const src = await s.json<Notebook>("/notebooks", {
      method: "POST",
      json: { title: "我的格式", icon: "🧪" },
    });
    await s.json(`/notebooks/${src.id}/notes`, {
      method: "POST",
      json: { title: "实验记录", markdown: "## 步骤" },
    });
    await s.json(`/notebooks/${src.id}/lorebook/entries`, {
      method: "POST",
      json: { name: "术语", keys: ["k"], content: "c" },
    });
    await s.json(`/notebooks/${src.id}`, { method: "PATCH", json: { defaultPresetId: "builtin.quiz" } });
    const tpl = await s.json<NotebookTemplateInfo>(`/notebooks/${src.id}/save-template`, {
      method: "POST",
      json: {},
    });
    expect(tpl).toMatchObject({ name: "我的格式", icon: "🧪", builtin: false });
    const list = await s.json<NotebookTemplateInfo[]>("/notebook-templates");
    expect(list.at(-1)!.id).toBe(tpl.id);

    const copy = await s.json<Notebook>("/notebooks/from-template", {
      method: "POST",
      json: { templateId: tpl.id, title: "第二次实验" },
    });
    expect(copy).toMatchObject({ title: "第二次实验", defaultPresetId: "builtin.quiz" });
    expect((await s.json<Note[]>(`/notebooks/${copy.id}/notes`)).map((n) => n.title)).toEqual(["实验记录"]);
    expect((await s.json<{ entries: unknown[] }>(`/notebooks/${copy.id}/lorebook`)).entries).toHaveLength(1);

    await s.json(`/notebook-templates/${tpl.id}`, { method: "PATCH", json: { name: "实验模板" } });
    expect((await s.json<NotebookTemplateInfo[]>("/notebook-templates")).at(-1)!.name).toBe("实验模板");
    await s.json(`/notebook-templates/${tpl.id}`, { method: "DELETE" });
    expect((await s.json<NotebookTemplateInfo[]>("/notebook-templates")).some((t) => t.id === tpl.id)).toBe(
      false,
    );
    expect((await s.request("/notebook-templates/builtin.novel", { method: "DELETE" })).status).toBe(400);
  });

  it("分享卡片带上稿件结构和默认预设，导入后还原", async () => {
    const nb = await s.json<Notebook>("/notebooks/from-template", {
      method: "POST",
      json: { templateId: "builtin.novel", title: "带稿件的卡" },
    });
    const card = (await (await s.request(`/notebooks/${nb.id}/card?format=json`)).json()) as QuireCard;
    expect(card.data.notebook?.default_preset_id).toBe("builtin.writer");
    expect(card.data.notebook!.manuscript!.volumes[0]!.chapters).toHaveLength(1);
    const form = new FormData();
    form.append("file", new File([strToU8(JSON.stringify(card)) as BlobPart], "a.quire.json"));
    const r = (await (await s.request("/cards/import", { method: "POST", body: form })).json()) as {
      notebookId: string;
    };
    const copy = await s.json<Notebook>(`/notebooks/${r.notebookId}`);
    const chapterId = copy.manuscript!.volumes[0]!.chapters[0]!.noteId;
    expect((await s.json<Note>(`/notes/${chapterId}`)).notebookId).toBe(copy.id);
    expect(copy.defaultPresetId).toBe("builtin.writer");
  });
});
