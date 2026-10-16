import { ArtifactData, ArtifactKind, usedCitationNumbers } from "@quirenote/core";
import { DEMO_SOURCES } from "@quirenote/core/fixtures";
import { describe, expect, it } from "vitest";
import { catalogModels, guessCapabilities } from "./catalog";
import { embedTexts } from "./embedding";
import { extractiveSummary, topicOf } from "./extractive";
import { extractElements, generateArtifactData, proposeAgentOps, transformStream } from "./tasks";
import {
  createFakeOpenAI,
  FAKE_BASE_URL,
  FAKE_CHAT_MODEL,
  FAKE_EMBEDDING_DIM,
  FAKE_EMBEDDING_MODEL,
} from "./testing";
import type { ModelRef, Passage } from "./types";
import { cosine, TEXT_VECTOR_DIM, textVector } from "./vector";

const provider = {
  id: "prov_fake",
  kind: "openai-compatible" as const,
  baseUrl: FAKE_BASE_URL,
  fetch: createFakeOpenAI(),
};
const fake: ModelRef = { provider, model: FAKE_CHAT_MODEL };

const passages: Passage[] = DEMO_SOURCES.flatMap((s) =>
  s.text
    .split("\f")
    .map((t) => ({ n: 0, text: t.trim(), title: s.title }))
    .filter((p) => p.text),
).map((p, i) => ({ ...p, n: i + 1 }));

describe("text vectors", () => {
  it("are deterministic, normalized and fixed-size", () => {
    const a = textVector("图灵测试是一个思想实验");
    const b = textVector("图灵测试是一个思想实验");
    expect(a).toHaveLength(TEXT_VECTOR_DIM);
    expect(a).toEqual(b);
    const norm = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it("rank related Chinese text above unrelated text", () => {
    const q = textVector("图灵测试");
    const related = textVector("图灵提出的模仿游戏后来被称为图灵测试");
    const unrelated = textVector("AlexNet 依赖 GPU 并行计算和大规模标注数据");
    expect(cosine(q, related)).toBeGreaterThan(cosine(q, unrelated) + 0.1);
  });

  it("rank related English text above unrelated text, tolerating inflections", () => {
    const q = textVector("training neural networks");
    const related = textVector("Backpropagation trains multi-layer neural network models");
    const unrelated = textVector("The Dartmouth workshop was held in the summer");
    expect(cosine(q, related)).toBeGreaterThan(cosine(q, unrelated));
  });

  it("are zero for empty text", () => {
    expect(textVector("").every((x) => x === 0)).toBe(true);
  });
});

describe("extractive helpers", () => {
  it("summarizes with sentences taken from the text", () => {
    const text = DEMO_SOURCES[1]!.text;
    const summary = extractiveSummary(text, 2);
    expect(summary.length).toBeGreaterThan(10);
    expect(text.replace(/\s/g, "")).toContain(summary.replace(/\s/g, "").slice(0, 10));
  });

  it("names the topic after the sources", () => {
    expect(topicOf([{ n: 1, text: "x", title: "A" }])).toBe("A");
    expect(
      topicOf([
        { n: 1, text: "x", title: "A" },
        { n: 2, text: "y", title: "B" },
      ]),
    ).toBe("A 等 2 份资料");
    expect(topicOf([], "自定义")).toBe("自定义");
  });
});

describe("catalog models", () => {
  it("seeds providers with example models and merged capabilities", () => {
    const models = catalogModels("openai");
    expect(models.find((m) => m.id === "text-embedding-3-small")?.capabilities).toEqual(["embedding"]);
    expect(models.every((m) => m.capabilities.length > 0)).toBe(true);
    expect(catalogModels("anthropic-compatible").map((m) => m.id)).toEqual(["claude-sonnet-5-5"]);
  });

  it("guesses capabilities from model ids within what the kind supports", () => {
    expect(guessCapabilities("openai-compatible", "BAAI/bge-m3")).toEqual(["embedding"]);
    expect(guessCapabilities("openai-compatible", "FunAudioLLM/SenseVoiceSmall")).toEqual(["stt"]);
    expect(guessCapabilities("openai-compatible", "Qwen/Qwen3-32B")).toEqual(["chat"]);
    expect(guessCapabilities("openai", "tts-1-hd")).toEqual(["tts"]);
    // Anthropic 不支持 Embedding：即使名字像也归为对话。
    expect(guessCapabilities("anthropic", "claude-embed-x")).toEqual(["chat"]);
    expect(guessCapabilities("tavily", "advanced")).toEqual(["search"]);
  });
});

describe("fake OpenAI-compatible model", () => {
  it("embeds deterministically", async () => {
    const ref: ModelRef = { provider, model: FAKE_EMBEDDING_MODEL };
    const [a, b] = await embedTexts(ref, ["图灵测试", "图灵测试"]);
    expect(a).toHaveLength(FAKE_EMBEDDING_DIM);
    expect(a).toEqual(b);
  });

  for (const kind of ArtifactKind.options) {
    it(`drives schema-valid ${kind} artifacts`, async () => {
      const data = await generateArtifactData(fake, { kind, passages, title: "人工智能简史" });
      expect(() => ArtifactData.parse(data)).not.toThrow();
      if (data.kind === "mindmap") expect(data.nodes.filter((n) => n.parentId === null)).toHaveLength(1);
      if (data.kind === "quiz")
        for (const q of data.questions) expect(q.answer).toBeLessThan(q.options.length);
    });
  }

  it("extracts elements whose quotes come verbatim from the passages", async () => {
    const { elements } = await extractElements(fake, passages);
    expect(elements.length).toBeGreaterThan(0);
    const all = passages.map((p) => p.text).join("\n");
    for (const e of elements) expect(all).toContain(e.quote);
  });

  it("proposes agent ops that pass validation", async () => {
    const notes = [{ id: "note_a", title: "符号主义", markdown: "符号主义认为智能可以被精确描述。" }];
    const p = await proposeAgentOps(fake, { instruction: "整理笔记", notes, passages });
    expect(p.ops.length).toBeGreaterThan(0);
  });

  it("streams transforms citing a real passage", async () => {
    let out = "";
    for await (const d of transformStream(fake, { action: "find_source", text: "感知机", passages }))
      out += d;
    const valid = new Set(passages.map((p) => p.n));
    expect(usedCitationNumbers(out).length).toBeGreaterThan(0);
    for (const n of usedCitationNumbers(out)) expect(valid.has(n)).toBe(true);
  });
});
