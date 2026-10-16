import { ArtifactData, ArtifactKind, usedCitationNumbers } from "@quirenote/core";
import { DEMO_SOURCES } from "@quirenote/core/fixtures";
import { describe, expect, it } from "vitest";
import { generateArtifactData, proposeAgentOps, refineArtifactData, transformStream } from "../tasks";
import type { ModelRef, Passage } from "../types";
import { localAnswer, localAnswerSegments, streamSegments } from "./chat";
import { cosine, LOCAL_EMBED_DIM, localEmbed } from "./embedding";
import { localElements, localHighlights, localTimeline } from "./structured";

const local: ModelRef = { provider: { id: "local", kind: "local" }, model: "extractive" };

const passages: Passage[] = DEMO_SOURCES.flatMap((s, si) =>
  s.text
    .split("\f")
    .map((t, pi) => ({ n: si * 3 + pi + 1, text: t.trim(), title: s.title }))
    .filter((p) => p.text),
).map((p, i) => ({ ...p, n: i + 1 }));

describe("local embedding", () => {
  it("is deterministic, normalized and fixed-size", () => {
    const a = localEmbed("图灵测试是一个思想实验");
    const b = localEmbed("图灵测试是一个思想实验");
    expect(a).toHaveLength(LOCAL_EMBED_DIM);
    expect(a).toEqual(b);
    const norm = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it("ranks related Chinese text above unrelated text", () => {
    const q = localEmbed("图灵测试");
    const related = localEmbed("图灵提出的模仿游戏后来被称为图灵测试");
    const unrelated = localEmbed("AlexNet 依赖 GPU 并行计算和大规模标注数据");
    expect(cosine(q, related)).toBeGreaterThan(cosine(q, unrelated) + 0.1);
  });

  it("ranks related English text above unrelated text, tolerating inflections", () => {
    const q = localEmbed("training neural networks");
    const related = localEmbed("Backpropagation trains multi-layer neural network models");
    const unrelated = localEmbed("The Dartmouth workshop was held in the summer");
    expect(cosine(q, related)).toBeGreaterThan(cosine(q, unrelated));
  });

  it("returns a zero vector for empty text", () => {
    expect(localEmbed("").every((x) => x === 0)).toBe(true);
  });
});

describe("local chat", () => {
  it("answers with [n] citations that exist in the passages", () => {
    const answer = localAnswer("图灵测试是什么？", passages);
    const nums = usedCitationNumbers(answer);
    expect(nums.length).toBeGreaterThan(0);
    const valid = new Set(passages.map((p) => p.n));
    for (const n of nums) expect(valid.has(n)).toBe(true);
    expect(answer).toContain("图灵");
  });

  it("cites the most relevant passage first-ranked", () => {
    const answer = localAnswer("AlexNet 在 ImageNet 上的错误率是多少？", passages);
    const alex = passages.find((p) => p.text.includes("AlexNet"))!;
    expect(usedCitationNumbers(answer)).toContain(alex.n);
  });

  it("explains when there are no passages", () => {
    const answer = localAnswer("什么是图灵测试？", []);
    expect(usedCitationNumbers(answer)).toHaveLength(0);
    expect(answer).toMatch(/没有找到/);
  });

  it("streams the same text in several deltas", async () => {
    const segments = localAnswerSegments("达特茅斯会议", passages);
    const parts: string[] = [];
    for await (const d of streamSegments(segments)) parts.push(d);
    expect(parts.length).toBeGreaterThan(3);
    expect(parts.join("")).toBe(segments.join(""));
  });
});

describe("local structured generation", () => {
  const kinds = ArtifactKind.options;
  for (const kind of kinds) {
    it(`generates non-empty, schema-valid ${kind}`, async () => {
      const data = await generateArtifactData(local, { kind, passages, title: "人工智能简史" });
      expect(() => ArtifactData.parse(data)).not.toThrow();
      switch (data.kind) {
        case "markdown":
          expect(data.markdown.length).toBeGreaterThan(50);
          break;
        case "mindmap":
          expect(data.nodes.filter((n) => n.parentId === null)).toHaveLength(1);
          expect(data.nodes.length).toBeGreaterThan(3);
          break;
        case "flashcards":
          expect(data.cards.length).toBeGreaterThan(2);
          break;
        case "quiz":
          expect(data.questions.length).toBeGreaterThan(1);
          for (const q of data.questions) expect(q.answer).toBeLessThan(q.options.length);
          break;
        case "timeline":
          expect(data.events.length).toBeGreaterThan(3);
          break;
        case "table":
          expect(data.table.rows.length).toBeGreaterThan(0);
          break;
        case "slides":
        case "video":
          expect(data.slides.length).toBeGreaterThan(2);
          break;
        case "audio":
          expect(data.script.length).toBeGreaterThan(4);
          expect(new Set(data.script.map((l) => l.speaker))).toEqual(new Set(["A", "B"]));
          break;
        case "image":
          expect(data.prompt.length).toBeGreaterThan(10);
          break;
      }
    });
  }

  it("orders timeline events chronologically", () => {
    const years = localTimeline(passages).events.map((e) => Number(e.date));
    expect(years).toEqual([...years].sort((a, b) => a - b));
    expect(years).toContain(1956);
  });

  it("extracts elements with quotes that exist in the passages", () => {
    const { elements } = localElements(passages);
    expect(elements.length).toBeGreaterThan(5);
    for (const e of elements) {
      const p = passages.find((x) => x.n === e.passage)!;
      expect(p.text).toContain(e.quote);
    }
    expect(elements.some((e) => e.type === "person")).toBe(true);
    expect(elements.some((e) => e.type === "date")).toBe(true);
  });

  it("never returns empty elements, even for tiny input", () => {
    expect(localElements([{ n: 1, text: "短" }]).elements.length).toBeGreaterThan(0);
  });

  it("produces highlights that map back to sentences", () => {
    const text = DEMO_SOURCES[1]!.text;
    const hs = localHighlights(text);
    expect(hs.length).toBeGreaterThan(0);
    for (const h of hs) expect(text.slice(h.start, h.end).length).toBeGreaterThan(5);
  });

  it("refines markdown and mindmap without losing content", async () => {
    const md = await generateArtifactData(local, { kind: "report", passages });
    const refined = await refineArtifactData(local, {
      kind: "report",
      data: md,
      instruction: "补充感知机的内容",
      passages,
    });
    expect(refined.kind).toBe("markdown");
    if (refined.kind === "markdown" && md.kind === "markdown") {
      expect(refined.markdown.startsWith(md.markdown.slice(0, 20))).toBe(true);
      expect(refined.markdown.length).toBeGreaterThan(md.markdown.length);
    }
    const mm = await generateArtifactData(local, { kind: "mindmap", passages });
    const mm2 = await refineArtifactData(local, {
      kind: "mindmap",
      data: mm,
      instruction: "展开反向传播",
      passages,
    });
    if (mm.kind === "mindmap" && mm2.kind === "mindmap")
      expect(mm2.nodes.length).toBeGreaterThanOrEqual(mm.nodes.length);
  });

  it("proposes agent ops for a comparison table", async () => {
    const notes = [
      {
        id: "note_a",
        title: "符号主义",
        markdown: "符号主义认为智能可以被精确描述。1956 年达特茅斯会议提出人工智能。",
      },
      { id: "note_b", title: "连接主义", markdown: "连接主义用神经网络从数据中学习。1986 年反向传播复兴。" },
    ];
    const p = await proposeAgentOps(local, {
      instruction: "把这两条笔记合并成一份对比表",
      notes,
      passages: [],
    });
    expect(p.ops).toHaveLength(1);
    expect(p.ops[0]!.op).toBe("create_table");
    const del = await proposeAgentOps(local, { instruction: "删除这些笔记", notes, passages: [] });
    expect(del.ops.map((o) => o.op)).toEqual(["delete_note", "delete_note"]);
    const fallback = await proposeAgentOps(local, { instruction: "写点什么", notes: [], passages });
    expect(fallback.ops.length).toBeGreaterThan(0);
  });

  it("streams in-place transforms with valid citations", async () => {
    let out = "";
    for await (const d of transformStream(local, {
      action: "find_source",
      text: "感知机无法解决异或问题",
      passages,
    }))
      out += d;
    const valid = new Set(passages.map((p) => p.n));
    expect(usedCitationNumbers(out).length).toBeGreaterThan(0);
    for (const n of usedCitationNumbers(out)) expect(valid.has(n)).toBe(true);
  });
});
