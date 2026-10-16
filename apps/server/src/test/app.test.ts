import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AgentProposal,
  Artifact,
  Chunk,
  Element,
  Job,
  ModelAssignment,
  Note,
  Notebook,
  ProviderConfig,
  ReviewCard,
  Source,
  SourceContent,
} from "@quirenote/core";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isAllowedOrigin } from "../app";
import { makeDocx, makePdf, makeServer, parseSse, readSse, type TestServer } from "./helpers";

let s: TestServer;
let demo: Notebook;

beforeAll(async () => {
  s = await makeServer({ seed: true });
  demo = (await s.json<Notebook[]>("/notebooks"))[0]!;
});

afterAll(async () => {
  await s.dispose();
});

async function waitJob(job: Job): Promise<Job> {
  return s.ctx.jobs.waitFor(job.id);
}

async function waitSource(id: string): Promise<Source> {
  await s.ctx.jobs.idle();
  return s.json<Source>(`/sources/${id}`);
}

describe("system", () => {
  it("health", async () => {
    expect(await s.json("/health")).toEqual({ ok: true, version: expect.any(String) });
  });

  it("unknown routes return the unified error shape", async () => {
    const res = await s.request("/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "not_found", message: expect.any(String) } });
  });

  it("CORS allows only localhost origins and Capacitor", async () => {
    expect(isAllowedOrigin("http://localhost:5173")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:8080")).toBe(true);
    expect(isAllowedOrigin("http://localhost")).toBe(true);
    expect(isAllowedOrigin("capacitor://localhost")).toBe(true);
    expect(isAllowedOrigin("https://evil.example")).toBe(false);
    expect(isAllowedOrigin("http://localhost.evil.example")).toBe(false);
    const ok = await s.request("/health", { headers: { origin: "http://localhost:5199" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:5199");
    const bad = await s.request("/health", { headers: { origin: "https://evil.example" } });
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
    const pre = await s.request("/notebooks", {
      method: "OPTIONS",
      headers: { origin: "capacitor://localhost", "access-control-request-method": "POST" },
    });
    expect(pre.headers.get("access-control-allow-origin")).toBe("capacitor://localhost");
  });

  it("settings round-trip arbitrary JSON", async () => {
    expect(await s.json("/settings/theme")).toBeNull();
    await s.json("/settings/theme", { method: "PUT", json: { mode: "dark", accent: "violet" } });
    expect(await s.json("/settings/theme")).toEqual({ mode: "dark", accent: "violet" });
  });
});

describe("seeded demo notebook", () => {
  it("has stats and ready, chunked, embedded sources", async () => {
    expect(demo.title).toBe("人工智能简史");
    expect(demo.stats).toEqual({ sources: 3, notes: 2, artifacts: 0, elements: 0 });
    const sources = await s.json<Source[]>(`/notebooks/${demo.id}/sources`);
    expect(sources.every((x) => x.status === "ready")).toBe(true);
    const pdf = sources.find((x) => x.kind === "pdf")!;
    expect(pdf.pageCount).toBe(3);
    const content = await s.json<SourceContent>(`/sources/${pdf.id}/content`);
    expect(content.pageOffsets).toHaveLength(3);
    const chunks = await s.json<Chunk[]>(`/sources/${pdf.id}/chunks`);
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) expect(content.text.slice(c.start, c.end)).toBe(c.text);
    expect(new Set(chunks.map((c) => c.page))).toEqual(new Set([1, 2, 3]));
    const stats = await s.json<{ chunks: number; embedded: number; embeddingModel: string }>("/admin/stats");
    expect(stats.embedded).toBe(stats.chunks);
    expect(stats.embeddingModel).toMatch(/^prov_\w+:fake-embed$/);
  });

  it("hybrid retrieval returns ranked chunks with both ranks", async () => {
    const r = await s.json<{
      results: {
        chunk: Chunk;
        sourceTitle: string;
        score: number;
        vectorRank: number | null;
        keywordRank: number | null;
      }[];
    }>(`/notebooks/${demo.id}/retrieve`, { method: "POST", json: { query: "反向传播算法", k: 3 } });
    expect(r.results).toHaveLength(3);
    expect(r.results[0]!.chunk.text).toContain("反向传播");
    expect(r.results[0]!.vectorRank).not.toBeNull();
    expect(r.results[0]!.keywordRank).not.toBeNull();
    expect(r.results[0]!.score).toBeGreaterThanOrEqual(r.results[1]!.score);
    // 两字短词走子串匹配
    const short = await s.json<{ results: { chunk: Chunk }[] }>(`/notebooks/${demo.id}/retrieve`, {
      method: "POST",
      json: { query: "XOR", k: 2 },
    });
    expect(short.results[0]!.chunk.text).toContain("XOR");
  });
});

describe("notebooks, sources and notes", () => {
  let nb: Notebook;

  it("creates, patches and lists notebooks", async () => {
    nb = await s.json<Notebook>("/notebooks", { method: "POST", json: { title: "测试本" } });
    expect(nb).toMatchObject({
      title: "测试本",
      icon: "📓",
      color: "indigo",
      pinned: false,
      ownerId: "local",
    });
    const patched = await s.json<Notebook>(`/notebooks/${nb.id}`, {
      method: "PATCH",
      json: { pinned: true, description: "d" },
    });
    expect(patched).toMatchObject({ pinned: true, description: "d" });
    const bad = await s.request("/notebooks", { method: "POST", json: { title: "" } });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("validation_error");
  });

  it("imports text, markdown, PDF and DOCX sources through the job queue", async () => {
    const text = await s.json<Source>(`/notebooks/${nb.id}/sources`, {
      method: "POST",
      json: {
        kind: "markdown",
        title: "Transformer",
        text: "# Transformer\n\n2017 年提出的 Transformer 完全基于自注意力机制。",
      },
    });
    expect(text.status).toBe("pending");
    const form = new FormData();
    form.append(
      "file",
      new File([makePdf(["Attention is all you need.", "Scaling laws appeared around 2020."])], "paper.pdf", {
        type: "application/pdf",
      }),
    );
    const pdf = await s.json<Source>(`/notebooks/${nb.id}/sources`, { method: "POST", body: form });
    const form2 = new FormData();
    form2.append("file", new File([makeDocx(["Word 文档第一段。", "第二段。"])], "notes.docx"));
    const docx = await s.json<Source>(`/notebooks/${nb.id}/sources`, { method: "POST", body: form2 });
    expect(docx.kind).toBe("docx");

    const t = await waitSource(text.id);
    expect(t).toMatchObject({ status: "ready", hasFile: true });
    expect(t.summary.length).toBeGreaterThan(0);
    const p = await waitSource(pdf.id);
    expect(p).toMatchObject({ status: "ready", kind: "pdf", pageCount: 2, hasFile: true });
    const pChunks = await s.json<Chunk[]>(`/sources/${pdf.id}/chunks`);
    expect(pChunks.map((c) => c.page)).toEqual([1, 2]);
    const raw = await s.request(`/sources/${pdf.id}/file`);
    expect(raw.headers.get("content-type")).toBe("application/pdf");
    expect(new Uint8Array(await raw.arrayBuffer()).slice(0, 5)).toEqual(new TextEncoder().encode("%PDF-"));
    expect((await waitSource(docx.id)).status).toBe("ready");

    const jobs = await s.json<Job[]>(`/jobs?notebookId=${nb.id}`);
    expect(jobs.filter((j) => j.type === "ingest").every((j) => j.status === "done")).toBe(true);
  });

  it("imports URLs with an injected fetch and reports failures", async () => {
    s.ctx.fetch = (async (url: string) =>
      url.includes("ok")
        ? new Response(
            "<html><head><title>OK Page</title></head><body><article><p>" +
              "Readable paragraph about neural networks. ".repeat(10) +
              "</p></article></body></html>",
            {
              headers: { "content-type": "text/html" },
            },
          )
        : new Response("gone", { status: 500 })) as unknown as typeof fetch;
    const ok = await s.json<Source>(`/notebooks/${nb.id}/sources`, {
      method: "POST",
      json: { kind: "url", url: "https://ok.example/a" },
    });
    const bad = await s.json<Source>(`/notebooks/${nb.id}/sources`, {
      method: "POST",
      json: { kind: "url", url: "https://bad.example/a" },
    });
    const okDone = await waitSource(ok.id);
    expect(okDone.status).toBe("ready");
    expect(okDone.title).toBe("OK Page");
    const badDone = await waitSource(bad.id);
    expect(badDone.status).toBe("error");
    expect(badDone.error).toMatch(/500/);
    const yt = await s.json<Source>(`/notebooks/${nb.id}/sources`, {
      method: "POST",
      json: { kind: "url", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    });
    expect(yt.kind).toBe("youtube");
    expect((await waitSource(yt.id)).error).toMatch(/YouTube|字幕/);
    const img = new FormData();
    img.append("file", new File([new Uint8Array([137, 80, 78, 71])], "scan.png", { type: "image/png" }));
    const image = await s.json<Source>(`/notebooks/${nb.id}/sources`, { method: "POST", body: img });
    // 图片走对话模型的视觉能力做 OCR（测试里是假模型）。
    expect((await waitSource(image.id)).status).toBe("ready");
    const audio = new FormData();
    audio.append("file", new File([new Uint8Array([1, 2, 3])], "talk.mp3", { type: "audio/mpeg" }));
    const au = await s.json<Source>(`/notebooks/${nb.id}/sources`, { method: "POST", body: audio });
    expect((await waitSource(au.id)).error).toMatch(/转写|STT|语音/);
    const unsupported = new FormData();
    unsupported.append("file", new File([new Uint8Array([1])], "x.exe"));
    expect(
      (await s.request(`/notebooks/${nb.id}/sources`, { method: "POST", body: unsupported })).status,
    ).toBe(400);
  });

  it("patches sources, manages highlights and auto-highlight", async () => {
    const sources = await s.json<Source[]>(`/notebooks/${nb.id}/sources`);
    const src = sources.find((x) => x.kind === "markdown")!;
    const updated = await s.json<Source>(`/sources/${src.id}`, {
      method: "PATCH",
      json: { selected: false, title: "改名" },
    });
    expect(updated).toMatchObject({ selected: false, title: "改名" });
    const h = await s.json<{ id: string; by: string }>(`/sources/${src.id}/highlights`, {
      method: "POST",
      json: { start: 0, end: 5, color: "green", note: "n" },
    });
    expect(h.by).toBe("user");
    const job = await s.json<Job>(`/sources/${src.id}/auto-highlight`, { method: "POST" });
    expect((await waitJob(job)).status).toBe("done");
    const content = await s.json<SourceContent>(`/sources/${src.id}/content`);
    expect(content.highlights.some((x) => x.by === "ai")).toBe(true);
    expect(content.highlights.some((x) => x.id === h.id)).toBe(true);
    await s.json(`/sources/${src.id}/highlights/${h.id}`, { method: "DELETE" });
    expect(
      (await s.json<SourceContent>(`/sources/${src.id}/content`)).highlights.some((x) => x.id === h.id),
    ).toBe(false);
  });

  it("CRUDs notes", async () => {
    const note = await s.json<Note>(`/notebooks/${nb.id}/notes`, {
      method: "POST",
      json: {
        title: "卡片",
        markdown: "内容",
        kind: "card",
        origin: { type: "chat", refId: "msg_x", sourceId: null },
      },
    });
    expect(note).toMatchObject({ kind: "card", tags: [], origin: { type: "chat", refId: "msg_x" } });
    const patched = await s.json<Note>(`/notes/${note.id}`, {
      method: "PATCH",
      json: { tags: ["a"], markdown: "新" },
    });
    expect(patched).toMatchObject({ tags: ["a"], markdown: "新", title: "卡片" });
    expect((await s.json<Note[]>(`/notebooks/${nb.id}/notes`)).map((n) => n.id)).toContain(note.id);
    await s.json(`/notes/${note.id}`, { method: "DELETE" });
    expect((await s.request(`/notes/${note.id}`)).status).toBe(404);
  });

  it("deletes a notebook with everything in it", async () => {
    const sources = await s.json<Source[]>(`/notebooks/${nb.id}/sources`);
    await s.json(`/notebooks/${nb.id}`, { method: "DELETE" });
    expect((await s.request(`/notebooks/${nb.id}`)).status).toBe(404);
    expect((await s.request(`/sources/${sources[0]!.id}`)).status).toBe(404);
    expect(existsSync(join(s.dir, "files", "sources", sources[0]!.id))).toBe(false);
  });
});

describe("studio, review and elements", () => {
  let flash: Artifact;

  it("generates every text and structured artifact kind with the local model", async () => {
    const kinds = [
      "report",
      "briefing",
      "study_guide",
      "faq",
      "timeline",
      "mindmap",
      "flashcards",
      "quiz",
      "table",
      "infographic",
      "slides",
    ] as const;
    const created = await Promise.all(
      kinds.map((kind) =>
        s.json<Artifact>(`/notebooks/${demo.id}/artifacts`, { method: "POST", json: { kind } }),
      ),
    );
    expect(created.every((a) => a.status === "generating")).toBe(true);
    await s.ctx.jobs.idle();
    for (const a of created) {
      const done = await s.json<Artifact>(`/artifacts/${a.id}`);
      expect(done.status, `${a.kind}: ${done.error}`).toBe("ready");
      expect(done.data).not.toBeNull();
      expect(done.title).not.toBe("");
    }
    flash = (await s.json<Artifact[]>(`/notebooks/${demo.id}/artifacts`)).find(
      (a) => a.kind === "flashcards",
    )!;
  });

  it("audio overview keeps an editable script when no TTS is configured", async () => {
    const a = await s.json<Artifact>(`/notebooks/${demo.id}/artifacts`, {
      method: "POST",
      json: { kind: "audio" },
    });
    await s.ctx.jobs.idle();
    const done = await s.json<Artifact>(`/artifacts/${a.id}`);
    expect(done.status).toBe("ready");
    expect(done.error).toMatch(/TTS/);
    expect(done.data?.kind === "audio" && done.data.script.length).toBeGreaterThan(3);
  });

  it("video overview fails clearly without ffmpeg, image without a model", async () => {
    s.ctx.ffmpeg = null;
    const v = await s.json<Artifact>(`/notebooks/${demo.id}/artifacts`, {
      method: "POST",
      json: { kind: "video" },
    });
    const img = await s.json<Artifact>(`/notebooks/${demo.id}/artifacts`, {
      method: "POST",
      json: { kind: "image" },
    });
    await s.ctx.jobs.idle();
    const vd = await s.json<Artifact>(`/artifacts/${v.id}`);
    expect(vd.status).toBe("error");
    expect(vd.error).toMatch(/ffmpeg/);
    expect(vd.data?.kind === "video" && vd.data.slides.length).toBeGreaterThan(0);
    const jobs = await s.json<Job[]>(`/jobs?notebookId=${demo.id}`);
    expect(jobs.find((j) => j.refId === v.id)?.message).toMatch(/ffmpeg/);
    expect((await s.json<Artifact>(`/artifacts/${img.id}`)).error).toMatch(/图像/);
  });

  it("refines and manually edits artifacts", async () => {
    const report = (await s.json<Artifact[]>(`/notebooks/${demo.id}/artifacts`)).find(
      (a) => a.kind === "report",
    )!;
    const refined = await s.json<Artifact>(`/artifacts/${report.id}/refine`, {
      method: "POST",
      json: { instruction: "补充 Transformer 的内容" },
    });
    expect(refined.data?.kind).toBe("markdown");
    const edited = await s.json<Artifact>(`/artifacts/${report.id}`, {
      method: "PATCH",
      json: { title: "我的报告", data: { kind: "markdown", markdown: "# 手写" } },
    });
    expect(edited).toMatchObject({ title: "我的报告", data: { kind: "markdown", markdown: "# 手写" } });
    const wrong = await s.request(`/artifacts/${report.id}`, {
      method: "PATCH",
      json: { data: { kind: "quiz", questions: [] } },
    });
    expect(wrong.status).toBe(400);
  });

  it("creates review cards from flashcards and schedules them with FSRS", async () => {
    if (flash.data?.kind !== "flashcards") throw new Error("no flashcards");
    const cards = await s.json<ReviewCard[]>(`/notebooks/${demo.id}/review/cards`, {
      method: "POST",
      json: {
        cards: flash.data.cards
          .slice(0, 3)
          .map((c) => ({ front: c.front, back: c.back, artifactId: flash.id })),
      },
    });
    expect(cards).toHaveLength(3);
    expect(cards[0]).toMatchObject({ state: 0, reps: 0, artifactId: flash.id });
    expect((await s.json<ReviewCard[]>(`/notebooks/${demo.id}/review/due`)).length).toBeGreaterThanOrEqual(3);
    const reviewed = await s.json<ReviewCard>(`/review/${cards[0]!.id}`, {
      method: "POST",
      json: { rating: 3 },
    });
    expect(reviewed.reps).toBe(1);
    expect(reviewed.lastReview).not.toBeNull();
    expect(new Date(reviewed.due).getTime()).toBeGreaterThan(Date.now());
    const easy = await s.json<ReviewCard>(`/review/${cards[1]!.id}`, { method: "POST", json: { rating: 4 } });
    expect(easy.state).toBe(2);
    const stats = await s.json<{ total: number; due: number; learned: number; retention: number }>(
      `/notebooks/${demo.id}/review/stats`,
    );
    expect(stats.total).toBe(3);
    expect(stats.learned).toBeGreaterThanOrEqual(1);
    expect(stats.retention).toBe(1);
    expect((await s.request(`/review/${cards[0]!.id}`, { method: "POST", json: { rating: 5 } })).status).toBe(
      400,
    );
  });

  it("extracts, merges, enriches elements and turns them into cards with mastery", async () => {
    const job = await s.json<Job>(`/notebooks/${demo.id}/elements/extract`, { method: "POST", json: {} });
    expect((await waitJob(job)).status).toBe("done");
    const els = await s.json<Element[]>(`/notebooks/${demo.id}/elements`);
    expect(els.length).toBeGreaterThan(5);
    expect(els.every((e) => e.refs.length > 0 && e.refs[0]!.sourceId)).toBe(true);
    const turing = els.find((e) => e.name.includes("图灵"))!;
    const manual = await s.json<Element>(`/notebooks/${demo.id}/elements`, {
      method: "POST",
      json: { type: "person", name: "Alan Turing", definition: "" },
    });
    const merged = await s.json<Element>(`/notebooks/${demo.id}/elements/merge`, {
      method: "POST",
      json: { ids: [manual.id, turing.id], intoId: turing.id },
    });
    expect(merged.aliases).toContain("Alan Turing");
    expect((await s.request(`/elements/${manual.id}`, { method: "PATCH", json: { name: "x" } })).status).toBe(
      404,
    );
    const enriched = await s.json<Element>(`/elements/${turing.id}/enrich`, { method: "POST" });
    expect(enriched.definition.length).toBeGreaterThan(5);
    const cards = await s.json<ReviewCard[]>(`/notebooks/${demo.id}/elements/cards`, {
      method: "POST",
      json: { ids: [turing.id] },
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]!.elementId).toBe(turing.id);
    await s.json(`/review/${cards[0]!.id}`, { method: "POST", json: { rating: 4 } });
    const after = (await s.json<Element[]>(`/notebooks/${demo.id}/elements`)).find(
      (e) => e.id === turing.id,
    )!;
    expect(after.mastery).toBeGreaterThan(0);
    // 再次出卡不会重复
    expect(
      await s.json<ReviewCard[]>(`/notebooks/${demo.id}/elements/cards`, {
        method: "POST",
        json: { ids: [turing.id] },
      }),
    ).toHaveLength(0);
  });

  it("CRUDs database views and properties", async () => {
    const prop = await s.json<{ id: string; options: unknown[] }>(`/notebooks/${demo.id}/properties`, {
      method: "POST",
      json: { entity: "note", name: "状态", type: "select", options: [{ value: "todo", color: "gray" }] },
    });
    expect(prop.options).toHaveLength(1);
    const view = await s.json<{ id: string; filters: unknown[]; groupBy: string | null }>(
      `/notebooks/${demo.id}/views`,
      {
        method: "POST",
        json: { entity: "note", name: "看板", layout: "board", groupBy: prop.id },
      },
    );
    expect(view).toMatchObject({ filters: [], groupBy: prop.id });
    const pv = await s.json<{ name: string }>(`/views/${view.id}`, {
      method: "PATCH",
      json: { name: "新看板" },
    });
    expect(pv.name).toBe("新看板");
    await s.json(`/views/${view.id}`, { method: "DELETE" });
    await s.json(`/properties/${prop.id}`, { method: "DELETE" });
    expect(await s.json<unknown[]>(`/notebooks/${demo.id}/views`)).toHaveLength(0);
  });
});

describe("in-place AI", () => {
  it("transform streams delta / citations / done", async () => {
    const res = await s.request("/ai/transform", {
      method: "POST",
      json: { notebookId: demo.id, action: "find_source", text: "单层感知机无法解决异或问题" },
    });
    const events = await readSse(res);
    expect(events.filter((e) => e.event === "delta").length).toBeGreaterThan(0);
    const cites = events.find((e) => e.event === "citations")!.data as { quote: string }[];
    expect(cites.length).toBeGreaterThan(0);
    expect((events.at(-1)!.data as { text: string }).text).toContain("[");
    const sum = await readSse(
      await s.request("/ai/transform", {
        method: "POST",
        json: { notebookId: demo.id, action: "summarize", text: "第一句。第二句很长很长。第三句。" },
      }),
    );
    expect(sum.at(-1)!.event).toBe("done");
  });

  it("command → proposal → apply → undo", async () => {
    const notes = await s.json<Note[]>(`/notebooks/${demo.id}/notes`);
    const proposal = await s.json<AgentProposal>("/ai/command", {
      method: "POST",
      json: {
        notebookId: demo.id,
        instruction: "把这两条笔记合并成一份对比表",
        noteIds: notes.map((n) => n.id),
      },
    });
    // 假模型总是提出 create_note（枚举第一项），足以走通 apply / undo。
    expect(proposal.ops[0]!.op).toBe("create_note");
    const applied = await s.json<{ applied: { op: string; id: string }[]; undoToken: string }>("/ai/apply", {
      method: "POST",
      json: { notebookId: demo.id, proposal },
    });
    const noteId = applied.applied[0]!.id;
    expect((await s.request(`/notes/${noteId}`)).status).toBe(200);
    expect(await s.json("/ai/undo", { method: "POST", json: { undoToken: applied.undoToken } })).toEqual({
      ok: true,
    });
    expect((await s.request(`/notes/${noteId}`)).status).toBe(404);

    const target = notes[0]!;
    const manual: AgentProposal = {
      id: "prop_manual",
      summary: "改写并新建",
      ops: [
        { op: "update_note", noteId: target.id, markdown: "改过的内容" },
        { op: "create_note", title: "新笔记", markdown: "x" },
        { op: "create_element", type: "term", name: "临时术语", definition: "d" },
      ],
    };
    const r2 = await s.json<{ applied: { id: string }[]; undoToken: string }>("/ai/apply", {
      method: "POST",
      json: { notebookId: demo.id, proposal: manual },
    });
    expect((await s.json<Note>(`/notes/${target.id}`)).markdown).toBe("改过的内容");
    await s.json("/ai/undo", { method: "POST", json: { undoToken: r2.undoToken } });
    expect((await s.json<Note>(`/notes/${target.id}`)).markdown).toBe(target.markdown);
    expect((await s.request(`/notes/${r2.applied[1]!.id}`)).status).toBe(404);
    const bad = await s.request("/ai/apply", {
      method: "POST",
      json: {
        notebookId: demo.id,
        proposal: { id: "p", summary: "", ops: [{ op: "delete_note", noteId: "note_missing" }] },
      },
    });
    expect(bad.status).toBe(400);
  });
});

describe("providers and models", () => {
  let prov: ProviderConfig;

  it("lists the catalog without a built-in local provider", async () => {
    const cat =
      await s.json<{ kind: string; notes: string; models: Record<string, string[]> }[]>("/providers/catalog");
    expect(cat.find((c) => c.kind === "local")).toBeUndefined();
    expect(cat.find((c) => c.kind === "anthropic-compatible")).toBeTruthy();
    const anthropic = cat.find((c) => c.kind === "anthropic")!;
    expect(anthropic.notes).toMatch(/没有 Embedding/);
    expect(anthropic.models.chat).toEqual(["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"]);
  });

  it("never returns the plaintext key, only hasKey and keyHint", async () => {
    prov = await s.json<ProviderConfig>("/providers", {
      method: "POST",
      json: { kind: "openai", name: "OpenAI", apiKey: "sk-test-SECRET-9876" },
    });
    expect(prov).toMatchObject({ hasKey: true, keyHint: "…9876", enabled: true, headerNames: [] });
    // 新建时预置目录里的示例模型。
    expect(prov.models.find((m) => m.id === "text-embedding-3-small")?.capabilities).toEqual(["embedding"]);
    const listText = await (await s.request("/providers")).text();
    expect(listText).not.toContain("SECRET");
    expect(listText).not.toContain("keyEnc");
    const patched = await s.json<ProviderConfig>(`/providers/${prov.id}`, {
      method: "PATCH",
      json: { apiKey: "sk-other-1111" },
    });
    expect(patched.keyHint).toBe("…1111");
    // 数据库里是密文
    const rec = await s.ctx.store.providers.get(prov.id);
    expect(rec?.keyEnc).toMatch(/^v1:/);
    expect(rec?.keyEnc).not.toContain("sk-other");
    expect(s.ctx.cipher.decrypt(rec!.keyEnc!)).toBe("sk-other-1111");
    const cleared = await s.json<ProviderConfig>(`/providers/${prov.id}`, {
      method: "PATCH",
      json: { apiKey: null },
    });
    expect(cleared).toMatchObject({ hasKey: false, keyHint: null });
    await s.json(`/providers/${prov.id}`, { method: "PATCH", json: { apiKey: "sk-test-SECRET-9876" } });
  });

  it("manages the provider's model list", async () => {
    const updated = await s.json<ProviderConfig>(`/providers/${prov.id}`, {
      method: "PATCH",
      json: {
        models: [
          { id: "gpt-custom", label: "我的模型", capabilities: ["chat"] },
          { id: "gpt-custom", capabilities: ["tts"] },
          { id: "tts-x", capabilities: ["tts", "search"] },
        ],
      },
    });
    // 同 ID 合并能力；该类型不支持的能力（OpenAI 不做搜索）被去掉。
    expect(updated.models).toEqual([
      { id: "gpt-custom", label: "我的模型", capabilities: ["chat", "tts"] },
      { id: "tts-x", label: null, capabilities: ["tts"] },
    ]);
    const bad = await s.request(`/providers/${prov.id}`, {
      method: "PATCH",
      json: { models: [{ id: "web", capabilities: ["search"] }] },
    });
    expect(bad.status).toBe(400);
    // 早期记录没有 models 字段：按目录示例模型返回。
    await s.ctx.store.providers.update(prov.id, { models: undefined });
    const listed = (await s.json<ProviderConfig[]>("/providers")).find((p) => p.id === prov.id)!;
    expect(listed.models.some((m) => m.id === "gpt-6.1-sol")).toBe(true);
  });

  it("stores custom headers encrypted and only returns their names", async () => {
    const withHeaders = await s.json<ProviderConfig>(`/providers/${prov.id}`, {
      method: "PATCH",
      json: { headers: { "X-Proxy-Token": "secret-header-value" } },
    });
    expect(withHeaders.headerNames).toEqual(["X-Proxy-Token"]);
    expect(await (await s.request("/providers")).text()).not.toContain("secret-header-value");
    const rec = await s.ctx.store.providers.get(prov.id);
    expect(rec?.headersEnc).toMatch(/^v1:/);
    expect((await s.ctx.models.runtime(prov.id)).headers).toEqual({ "X-Proxy-Token": "secret-header-value" });
    const invalid = await s.request(`/providers/${prov.id}`, {
      method: "PATCH",
      json: { headers: { "bad header": "x" } },
    });
    expect(invalid.status).toBe(400);
    // 合并：新增一项、保留未提到的旧值；null 删除单项（名称不分大小写）。
    const merged = await s.json<ProviderConfig>(`/providers/${prov.id}`, {
      method: "PATCH",
      json: { headers: { "X-Extra": "1" } },
    });
    expect(merged.headerNames).toEqual(["X-Proxy-Token", "X-Extra"]);
    expect((await s.ctx.models.runtime(prov.id)).headers).toEqual({
      "X-Proxy-Token": "secret-header-value",
      "X-Extra": "1",
    });
    const removed = await s.json<ProviderConfig>(`/providers/${prov.id}`, {
      method: "PATCH",
      json: { headers: { "x-proxy-token": null } },
    });
    expect(removed.headerNames).toEqual(["X-Extra"]);
    const cleared = await s.json<ProviderConfig>(`/providers/${prov.id}`, {
      method: "PATCH",
      json: { headers: null },
    });
    expect(cleared.headerNames).toEqual([]);
    expect((await s.ctx.models.runtime(prov.id)).headers).toBeNull();
  });

  it("requires a base url for the compatible protocols", async () => {
    for (const kind of ["openai-compatible", "anthropic-compatible"]) {
      const res = await s.request("/providers", { method: "POST", json: { kind, name: kind } });
      expect(res.status).toBe(400);
    }
    const ok = await s.json<ProviderConfig>("/providers", {
      method: "POST",
      json: { kind: "anthropic-compatible", name: "中转", baseUrl: "https://relay.example.com/v1" },
    });
    expect(ok.models.map((m) => m.id)).toEqual(["claude-sonnet-5-5"]);
    await s.json(`/providers/${ok.id}`, { method: "DELETE" });
  });

  it("tests connections without leaking keys", async () => {
    const fake = (await s.json<ProviderConfig[]>("/providers")).find((p) => p.kind === "openai-compatible")!;
    const t = await s.json<{ ok: boolean }>(`/providers/${fake.id}/test`, { method: "POST" });
    expect(t.ok).toBe(true);
    const remote = await s.json<{ id: string; capabilities: string[] }[]>(`/providers/${fake.id}/models`);
    expect(remote).toContainEqual({ id: "fake-chat", label: null, capabilities: ["chat"] });
    expect(remote).toContainEqual({ id: "fake-embed", label: null, capabilities: ["embedding"] });
    const edge = await s.json<ProviderConfig>("/providers", {
      method: "POST",
      json: { kind: "edge-tts", name: "Edge" },
    });
    const r = await s.json<{ ok: boolean; error: string }>(`/providers/${edge.id}/test`, { method: "POST" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/暂不支持/);
  });

  it("manages model assignments with capability validation", async () => {
    const initial = await s.json<ModelAssignment[]>("/models/assignments");
    expect(initial.map((a) => [a.capability, a.model])).toEqual([
      ["chat", "fake-chat"],
      ["embedding", "fake-embed"],
    ]);
    const bad = await s.request("/models/assignments", {
      method: "PUT",
      json: { capability: "search", providerId: prov.id, model: "x" },
    });
    expect(bad.status).toBe(400);
    const list = await s.json<ModelAssignment[]>("/models/assignments", {
      method: "PUT",
      json: { capability: "tts", providerId: prov.id, model: "gpt-4o-mini-tts" },
    });
    expect(list.find((a) => a.capability === "tts")?.providerId).toBe(prov.id);
    await s.json(`/providers/${prov.id}`, { method: "DELETE" });
    expect((await s.json<ModelAssignment[]>("/models/assignments")).some((a) => a.capability === "tts")).toBe(
      false,
    );
  });

  it("web search without a provider gives a clear error", async () => {
    const res = await s.request("/search/web", { method: "POST", json: { query: "x" } });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/联网搜索/);
    expect(
      (await s.request(`/notebooks/${demo.id}/research`, { method: "POST", json: { question: "q" } })).status,
    ).toBe(400);
  });

  it("bootstraps providers from env (and *_FILE) without logging keys", async () => {
    const keyFile = join(s.dir, "fake-anthropic.key");
    writeFileSync(keyFile, "  sk-ant-fake-key-ABCD \n");
    const logs: string[] = [];
    const s2 = await makeServer({
      fakeAi: false,
      env: { ANTHROPIC_API_KEY_FILE: keyFile, TAVILY_API_KEY: "tvly-fake-WXYZ" },
    });
    try {
      const { bootstrapProvidersFromEnv } = await import("../services/providers");
      // 再跑一次：已存在同类 provider 时不重复创建。
      expect(
        await bootstrapProvidersFromEnv(s2.ctx, { ANTHROPIC_API_KEY: "sk-ant-other" }, (m) => logs.push(m)),
      ).toEqual([]);
      const provs = await s2.json<ProviderConfig[]>("/providers");
      expect(provs.map((p) => p.kind).sort()).toEqual(["anthropic", "tavily"]);
      expect(provs.find((p) => p.kind === "anthropic")?.keyHint).toBe("…ABCD");
      const a = await s2.json<ModelAssignment[]>("/models/assignments");
      expect(a.find((x) => x.capability === "chat")).toMatchObject({ model: "claude-sonnet-5-5" });
      expect(a.find((x) => x.capability === "search")?.model).toBe("basic");
      const rec = await s2.ctx.store.providers.list();
      expect(s2.ctx.cipher.decrypt(rec.find((p) => p.kind === "anthropic")!.keyEnc!)).toBe(
        "sk-ant-fake-key-ABCD",
      );
      expect(logs.join("\n")).not.toContain("sk-ant");
      // Anthropic 没有 Embedding：不分配，检索只用关键词。
      expect(a.find((x) => x.capability === "embedding")).toBeUndefined();
    } finally {
      await s2.dispose();
    }
  });

  it("bootstraps an OpenAI-compatible endpoint with explicit models", async () => {
    const s2 = await makeServer({
      env: { OPENAI_COMPATIBLE_API_KEY: "sk-compat-KEY1", OPENAI_COMPATIBLE_CHAT_MODEL: "qwen3" },
    });
    try {
      const fake = (await s2.json<ProviderConfig[]>("/providers")).find(
        (p) => p.kind === "openai-compatible",
      )!;
      expect(fake).toMatchObject({ baseUrl: "http://fake-llm.test/v1", keyHint: "…KEY1" });
      expect(fake.models.map((m) => [m.id, m.capabilities])).toEqual([
        ["qwen3", ["chat"]],
        ["fake-embed", ["embedding"]],
      ]);
      const a = await s2.json<ModelAssignment[]>("/models/assignments");
      expect(a.map((x) => [x.capability, x.model])).toEqual([
        ["chat", "qwen3"],
        ["embedding", "fake-embed"],
      ]);
    } finally {
      await s2.dispose();
    }
  });

  it("drops assignments left over from the removed local provider", async () => {
    const s2 = await makeServer({ fakeAi: false });
    try {
      await s2.ctx.store.assignments.set({ capability: "chat", providerId: "local", model: "extractive" });
      await s2.ctx.store.assignments.set({ capability: "embedding", providerId: "local", model: "hash-384" });
      expect(await s2.json<ModelAssignment[]>("/models/assignments")).toEqual([]);
      // local 生成的旧向量（未分配时它是默认值，可能只有向量、没有分配记录）。
      const nb0 = await s2.json<Notebook>("/notebooks", { method: "POST", json: { title: "legacy" } });
      const src = await s2.json<Source>(`/notebooks/${nb0.id}/sources`, {
        method: "POST",
        json: { kind: "text", text: "旧向量测试。" },
      });
      await s2.ctx.jobs.idle();
      const chunks = await s2.json<Chunk[]>(`/sources/${src.id}/chunks`);
      await s2.ctx.store.chunks.upsertEmbeddings(
        "local:hash-384",
        chunks.map((c) => ({ chunkId: c.id, notebookId: nb0.id, vector: new Array(384).fill(0.05) })),
      );
      expect(await s2.ctx.store.chunks.embeddedCount({ model: "local:hash-384" })).toBe(chunks.length);
      const { removeLegacyLocal } = await import("../services/providers");
      expect(await removeLegacyLocal(s2.ctx)).toBe(true);
      expect(await s2.ctx.store.assignments.list()).toEqual([]);
      expect(await s2.ctx.store.chunks.embeddedCount({ model: "local:hash-384" })).toBe(0);
      expect(await removeLegacyLocal(s2.ctx)).toBe(false);
      const nb = await s2.json<Notebook>("/notebooks", { method: "POST", json: { title: "x" } });
      const res = await s2.request("/ai/transform", {
        method: "POST",
        json: { notebookId: nb.id, action: "rewrite", text: "x" },
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("model_not_configured");
    } finally {
      await s2.dispose();
    }
  });
});

describe("events, admin and portability", () => {
  it("pushes job / source events over SSE", async () => {
    const ctrl = new AbortController();
    const res = await s.request("/events", { signal: ctrl.signal });
    const reader = res.body!.getReader();
    const nb = await s.json<Notebook>("/notebooks", { method: "POST", json: { title: "events" } });
    await s.json(`/notebooks/${nb.id}/sources`, {
      method: "POST",
      json: { kind: "text", text: "事件测试文本。" },
    });
    let text = "";
    const dec = new TextDecoder();
    while (!/event: source[\s\S]*"status":"ready"/.test(text)) {
      const { value, done } = await reader.read();
      if (done) break;
      text += dec.decode(value);
    }
    ctrl.abort();
    await reader.cancel().catch(() => {});
    const events = parseSse(text);
    expect(events[0]!.event).toBe("ready");
    expect(events.some((e) => e.event === "job")).toBe(true);
    expect(events.some((e) => e.event === "source" && (e.data as Source).status === "ready")).toBe(true);
    await s.json(`/notebooks/${nb.id}`, { method: "DELETE" });
  });

  it("reindexes embeddings", async () => {
    const job = await s.json<Job>("/admin/reindex", { method: "POST", json: { notebookId: demo.id } });
    expect((await waitJob(job)).status).toBe("done");
    const stats = await s.json<{ chunks: number; embedded: number; pendingJobs: number; dbBytes: number }>(
      "/admin/stats",
    );
    expect(stats.embedded).toBe(stats.chunks);
    expect(stats.dbBytes).toBeGreaterThan(0);
  });

  it("exports and re-imports a notebook as zip", async () => {
    const res = await s.request(`/notebooks/${demo.id}/export`);
    expect(res.headers.get("content-type")).toBe("application/zip");
    const zip = new Uint8Array(await res.arrayBuffer());
    const files = unzipSync(zip);
    expect(Object.keys(files)).toContain("notebook.json");
    expect(Object.keys(files).some((f) => f.startsWith("markdown/notes/"))).toBe(true);
    const form = new FormData();
    form.append("file", new File([zip], "nb.zip"));
    const imported = await s.json<Notebook>("/import", { method: "POST", body: form });
    expect(imported.id).not.toBe(demo.id);
    expect(imported.title).toBe(demo.title);
    expect(imported.stats?.sources).toBe(3);
    await s.ctx.jobs.idle();
    const r = await s.json<{ results: { chunk: Chunk }[] }>(`/notebooks/${imported.id}/retrieve`, {
      method: "POST",
      json: { query: "图灵测试" },
    });
    expect(r.results.length).toBeGreaterThan(0);
    expect(r.results.every((x) => x.chunk.notebookId === imported.id)).toBe(true);
    const els = await s.json<Element[]>(`/notebooks/${imported.id}/elements`);
    const srcIds = new Set((await s.json<Source[]>(`/notebooks/${imported.id}/sources`)).map((x) => x.id));
    expect(els.every((e) => e.refs.every((ref) => !ref.sourceId || srcIds.has(ref.sourceId)))).toBe(true);
  });

  it("backs up and restores everything", async () => {
    const res = await s.request("/admin/backup");
    const zip = new Uint8Array(await res.arrayBuffer());
    const before = await s.json<Notebook[]>("/notebooks");
    const extra = await s.json<Notebook>("/notebooks", { method: "POST", json: { title: "备份后新建" } });
    const form = new FormData();
    form.append("file", new File([zip], "backup.zip"));
    expect(await s.json("/admin/restore", { method: "POST", body: form })).toMatchObject({ ok: true });
    const after = await s.json<Notebook[]>("/notebooks");
    expect(after.map((n) => n.id).sort()).toEqual(before.map((n) => n.id).sort());
    expect(after.some((n) => n.id === extra.id)).toBe(false);
    // 恢复后检索仍可用（向量表随库恢复）
    const r = await s.json<{ results: unknown[] }>(`/notebooks/${demo.id}/retrieve`, {
      method: "POST",
      json: { query: "图灵" },
    });
    expect(r.results.length).toBeGreaterThan(0);
  });

  it("serves generated media with range support", async () => {
    await s.ctx.files.put("media/test.mp3", new Uint8Array([1, 2, 3, 4, 5]));
    const full = await s.request("/files/test.mp3");
    expect(full.headers.get("content-type")).toBe("audio/mpeg");
    const part = await s.request("/files/test.mp3", { headers: { range: "bytes=1-2" } });
    expect(part.status).toBe(206);
    expect([...new Uint8Array(await part.arrayBuffer())]).toEqual([2, 3]);
    expect((await s.request("/files/..%2Fsecret.key")).status).toBe(404);
  });
});
