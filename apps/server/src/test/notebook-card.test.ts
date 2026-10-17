/** 整本 Notebook 卡：资料（原文件、分页、高亮）、生成物、元素、复习卡的导出与还原；笔记也算资料。 */
import {
  type Artifact,
  type Citation,
  type Element,
  type Message,
  type Note,
  type Notebook,
  newId,
  nowIso,
  type QuireCard,
  type ReviewCard,
  type Source,
} from "@quirenote/core";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCards } from "../services/review";
import { MEDIA_DIR } from "../services/studio";
import { makePdf, makeServer, readSse, type TestServer } from "./helpers";

const MP3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, ...new Array(64).fill(0)]);

let s: TestServer;

beforeAll(async () => {
  s = await makeServer();
});

afterAll(async () => {
  await s.dispose();
});

const newNotebook = (title: string) => s.json<Notebook>("/notebooks", { method: "POST", json: { title } });
const upload = (path: string, bytes: Uint8Array, name: string, extra: Record<string, string> = {}) => {
  const form = new FormData();
  form.append("file", new File([bytes as BlobPart], name));
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return s.request(path, { method: "POST", body: form });
};
const bytesOf = async (path: string) => new Uint8Array(await (await s.request(path)).arrayBuffer());

describe("整本 Notebook 卡", () => {
  const pdfBytes = makePdf([
    "Attention is all you need. The Transformer removes recurrence entirely.",
    "Scaling laws appeared around 2020 and guided larger models.",
  ]);
  let nb: Notebook;
  let pdf: Source;
  let note: Note;
  let element: Element;
  let text: string;

  beforeAll(async () => {
    nb = await newNotebook("精华笔记本");
    const form = new FormData();
    form.append("file", new File([pdfBytes], "paper.pdf", { type: "application/pdf" }));
    pdf = await s.json<Source>(`/notebooks/${nb.id}/sources`, { method: "POST", body: form });
    await s.ctx.jobs.idle();
    text = (await s.json<{ text: string }>(`/sources/${pdf.id}/content`)).text;
    const at = text.indexOf("Transformer");
    await s.json(`/sources/${pdf.id}/highlights`, {
      method: "POST",
      json: { start: at, end: at + "Transformer".length, color: "green", note: "关键概念" },
    });
    note = await s.json<Note>(`/notebooks/${nb.id}/notes`, {
      method: "POST",
      json: { title: "读书笔记", markdown: "Transformer 去掉了循环结构。" },
    });
    const ts = nowIso();
    const base = {
      ownerId: s.ctx.store.ownerId,
      notebookId: nb.id,
      error: null,
      props: {},
      createdAt: ts,
      updatedAt: ts,
    };
    await s.ctx.store.artifacts.insert({
      ...base,
      id: newId("art"),
      kind: "report",
      title: "报告",
      status: "ready",
      sourceIds: [pdf.id],
      data: { kind: "markdown", markdown: "# 报告\n\nTransformer 改变了序列建模。" },
    } as Artifact);
    await s.ctx.files.put(`${MEDIA_DIR}/overview.mp3`, MP3);
    await s.ctx.store.artifacts.insert({
      ...base,
      id: newId("art"),
      kind: "audio",
      title: "音频概览",
      status: "ready",
      sourceIds: [pdf.id],
      data: { kind: "audio", script: [{ speaker: "A", text: "你好" }], audioUrl: "/api/files/overview.mp3" },
    } as Artifact);
    element = {
      ...base,
      id: newId("el"),
      type: "concept",
      name: "Transformer",
      definition: "完全基于注意力的序列模型。",
      aliases: ["变换器"],
      refs: [{ sourceId: pdf.id, chunkId: null, noteId: note.id, messageId: null, quote: "Transformer" }],
      relations: [],
      mastery: 0,
    } as Element;
    await s.ctx.store.elements.insert(element);
    await createCards(s.ctx, nb.id, [
      { front: "什么去掉了循环结构？", back: "Transformer", elementId: element.id },
    ]);
  });

  it(".quire 带上资料原文件、分页、高亮，以及生成物媒体、元素和复习卡", async () => {
    const files = unzipSync(await bytesOf(`/notebooks/${nb.id}/card?format=quire`));
    const card = JSON.parse(new TextDecoder().decode(files["card.json"])) as QuireCard;
    expect(card.spec_version).toBe("1.1");
    const src = card.data.sources[0]!;
    expect(src).toMatchObject({ title: pdf.title, kind: "pdf", text, selected: true });
    expect(src.page_offsets).toHaveLength(2);
    expect(src.highlights).toEqual([
      {
        start: text.indexOf("Transformer"),
        end: text.indexOf("Transformer") + 11,
        color: "green",
        note: "关键概念",
      },
    ]);
    const fileAsset = card.data.assets.find((a) => a.id === src.file)!;
    expect(fileAsset.type).toBe("source");
    expect(files[fileAsset.uri.replace("embedded://", "")]).toEqual(pdfBytes);

    expect(card.data.artifacts.map((a) => a.kind).sort()).toEqual(["audio", "report"]);
    const audio = card.data.artifacts.find((a) => a.kind === "audio")!;
    const ref = (audio.data as { audioUrl: string }).audioUrl;
    expect(ref).toMatch(/^asset:\/\//);
    const media = card.data.assets.find((a) => a.id === ref.slice(8))!;
    expect(files[media.uri.replace("embedded://", "")]).toEqual(MP3);

    expect(card.data.elements).toEqual([
      expect.objectContaining({
        name: "Transformer",
        aliases: ["变换器"],
        refs: [{ source_id: pdf.id, note_id: note.id, quote: "Transformer" }],
      }),
    ]);
    expect(card.data.review_cards).toEqual([
      { front: "什么去掉了循环结构？", back: "Transformer", element_id: element.id, artifact_id: null },
    ]);
  });

  it("导入后直接能读：原文件、全文、分页、高亮、分块都在，生成物、元素、复习卡都还原", async () => {
    const zip = await bytesOf(`/notebooks/${nb.id}/card?format=quire`);
    const preview = await (await upload("/cards/preview", zip, "精华笔记本.quire")).json();
    expect(preview).toMatchObject({
      sources: 1,
      sourceFiles: 1,
      sourcesTextOnly: 0,
      sourceTitles: [pdf.title],
      artifacts: 2,
      elements: 1,
      reviewCards: 1,
      assets: 1,
    });
    const res = await upload("/cards/import", zip, "精华笔记本.quire");
    expect(res.status).toBe(201);
    const r = (await res.json()) as {
      notebookId: string;
      sources: number;
      artifacts: number;
      elements: number;
      reviewCards: number;
      warnings: string[];
    };
    expect(r).toMatchObject({ sources: 1, artifacts: 2, elements: 1, reviewCards: 1, warnings: [] });

    const [src] = await s.json<Source[]>(`/notebooks/${r.notebookId}/sources`);
    expect(src).toMatchObject({
      status: "ready",
      hasFile: true,
      kind: "pdf",
      pageCount: 2,
      title: pdf.title,
    });
    expect(await bytesOf(`/sources/${src!.id}/file`)).toEqual(pdfBytes);
    const content = await s.json<{
      text: string;
      pageOffsets: number[];
      highlights: { color: string; note: string; start: number }[];
    }>(`/sources/${src!.id}/content`);
    expect(content.text).toBe(text);
    expect(content.pageOffsets).toHaveLength(2);
    expect(content.highlights).toEqual([
      expect.objectContaining({ color: "green", note: "关键概念", start: text.indexOf("Transformer") }),
    ]);
    expect((await s.json<unknown[]>(`/sources/${src!.id}/chunks`)).length).toBeGreaterThan(0);

    const arts = await s.json<Artifact[]>(`/notebooks/${r.notebookId}/artifacts`);
    const audio = arts.find((a) => a.kind === "audio")!;
    const url = (audio.data as { audioUrl: string }).audioUrl;
    expect(url).toMatch(/^\/api\/assets\/ast_\w+\.mp3$/);
    expect(await bytesOf(url.slice(4))).toEqual(MP3);
    expect(audio.sourceIds).toEqual([src!.id]);
    expect(arts.find((a) => a.kind === "report")?.data).toEqual({
      kind: "markdown",
      markdown: "# 报告\n\nTransformer 改变了序列建模。",
    });

    const [el] = await s.ctx.store.elements.list({ notebookId: r.notebookId });
    const [copied] = await s.json<Note[]>(`/notebooks/${r.notebookId}/notes`);
    expect(el!.refs[0]).toMatchObject({ sourceId: src!.id, noteId: copied!.id, chunkId: null });
    const cards = await s.json<ReviewCard[]>(`/notebooks/${r.notebookId}/review/cards`);
    expect(cards).toEqual([expect.objectContaining({ front: "什么去掉了循环结构？", elementId: el!.id })]);
    await s.ctx.jobs.idle();
  });

  it("JSON 卡只带资料文字和高亮，不带原文件；小的媒体内联", async () => {
    const bytes = await bytesOf(`/notebooks/${nb.id}/card?format=json`);
    const card = JSON.parse(new TextDecoder().decode(bytes)) as QuireCard;
    expect(card.data.sources[0]!.file).toBeNull();
    expect(card.data.assets.some((a) => a.type === "source")).toBe(false);
    const ref = (card.data.artifacts.find((a) => a.kind === "audio")!.data as { audioUrl: string }).audioUrl;
    expect(card.data.assets.find((a) => a.id === ref.slice(8))!.uri).toMatch(/^data:audio\/mpeg;base64,/);
    const preview = await (await upload("/cards/preview", bytes, "x.quire.json")).json();
    expect(preview).toMatchObject({ sourceFiles: 0, sourcesTextOnly: 1 });

    const r = (await (await upload("/cards/import", bytes, "x.quire.json")).json()) as { notebookId: string };
    const [src] = await s.json<Source[]>(`/notebooks/${r.notebookId}/sources`);
    expect(src).toMatchObject({ hasFile: false, kind: "pdf", status: "ready" });
    expect((await s.json<{ highlights: unknown[] }>(`/sources/${src!.id}/content`)).highlights).toHaveLength(
      1,
    );
    await s.ctx.jobs.idle();
  });

  it("资料、生成物、元素都可以不带", async () => {
    const bytes = await bytesOf(`/notebooks/${nb.id}/card?format=json&sources=0&artifacts=0&elements=0`);
    const d = (JSON.parse(new TextDecoder().decode(bytes)) as QuireCard).data;
    expect([d.sources, d.artifacts, d.elements, d.review_cards]).toEqual([[], [], [], []]);
  });

  it("合并进已有 Notebook 时，同名同类型的元素沿用已有的", async () => {
    const bytes = await bytesOf(`/notebooks/${nb.id}/card?format=json&sources=0&artifacts=0`);
    const r = (await (await upload("/cards/import", bytes, "x.json", { notebookId: nb.id })).json()) as {
      elements: number;
      reviewCards: number;
    };
    expect(r).toMatchObject({ elements: 0, reviewCards: 1 });
    expect(await s.ctx.store.elements.list({ notebookId: nb.id })).toHaveLength(1);
  });

  it("旧卡（没有新字段）照样能导入", async () => {
    const old = {
      spec: "quire_card_v1",
      spec_version: "1.0",
      data: {
        kind: "notebook",
        name: "旧卡",
        notes: [],
        sources: [{ id: "s1", title: "旧资料", kind: "markdown", url: null, text: "第一段。\n\n第二段。" }],
        assets: [],
        extensions: {},
      },
    };
    const r = (await (
      await upload("/cards/import", new TextEncoder().encode(JSON.stringify(old)), "old.json")
    ).json()) as {
      notebookId: string;
      sources: number;
    };
    expect(r.sources).toBe(1);
    const [src] = await s.json<Source[]>(`/notebooks/${r.notebookId}/sources`);
    expect(src).toMatchObject({ status: "ready", kind: "markdown", charCount: 10 });
    await s.ctx.jobs.idle();
  });
});

describe("笔记也算资料", () => {
  let nb: Notebook;
  let note: Note;

  beforeAll(async () => {
    nb = await newNotebook("只有笔记");
    note = await s.json<Note>(`/notebooks/${nb.id}/notes`, {
      method: "POST",
      json: { title: "量子退火", markdown: "D-Wave 在 2011 年推出了第一台商用量子退火机。" },
    });
    await s.json(`/notebooks/${nb.id}/notes`, {
      method: "POST",
      json: { title: "无关", markdown: "今天的午饭是面条。" },
    });
  });

  it("没有勾选资料时依据笔记作答，引用指向笔记", async () => {
    const conv = await s.json<{ id: string }>(`/notebooks/${nb.id}/conversations`, {
      method: "POST",
      json: {},
    });
    const events = await readSse(
      await s.request(`/conversations/${conv.id}/messages`, {
        method: "POST",
        json: { content: "D-Wave 什么时候推出商用量子退火机？", parentId: null },
      }),
    );
    const done = events.at(-1)!.data as Message;
    expect(done.status).toBe("done");
    const c = done.citations[0] as Citation;
    expect(c).toMatchObject({ noteId: note.id, sourceTitle: "量子退火", sourceId: note.id });
    expect(c.quote).toContain("2011");
  });

  it("只有笔记时 Studio 也能生成", async () => {
    const art = await s.json<Artifact>(`/notebooks/${nb.id}/artifacts`, {
      method: "POST",
      json: { kind: "briefing" },
    });
    await s.ctx.jobs.idle();
    expect((await s.json<Artifact>(`/artifacts/${art.id}`)).status).toBe("ready");
  });

  it("既没有资料也没有笔记时 Studio 仍然要求先准备资料", async () => {
    const empty = await newNotebook("空");
    const res = await s.request(`/notebooks/${empty.id}/artifacts`, {
      method: "POST",
      json: { kind: "briefing" },
    });
    expect(res.status).toBe(400);
  });
});
