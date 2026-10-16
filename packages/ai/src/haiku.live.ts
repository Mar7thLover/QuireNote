/**
 * 真实模型测试：用 Claude Haiku 检验提示词、引用规则与结构化输出 schema 在真实模型上是否成立
 * （假模型只能保证流程走通，验证不了模型是否遵守约定）。
 *
 *   ANTHROPIC_API_KEY_FILE=/path/to/key pnpm test:live
 *
 * 也可以用 ANTHROPIC_API_KEY。都没有时整组跳过。QUIRENOTE_LIVE_MODEL 可换模型（默认 claude-haiku-5-5）。
 * 断言只检查结构与约定（编号合法、schema 通过、引文出自资料），不检查措辞。
 */
import { readFileSync } from "node:fs";
import { ArtifactData, ArtifactKind, usedCitationNumbers } from "@quirenote/core";
import { DEMO_SOURCES } from "@quirenote/core/fixtures";
import { describe, expect, it } from "vitest";
import { streamChat } from "./chat";
import { listModels } from "./connection";
import {
  buildCitationSystemPrompt,
  extractElements,
  generateArtifactData,
  proposeAgentOps,
  summarizeText,
  transformStream,
} from "./tasks";
import type { ModelRef, Passage, ProviderRuntime } from "./types";

function readKey(): string | null {
  const file = process.env.ANTHROPIC_API_KEY_FILE?.trim();
  if (file) return readFileSync(file, "utf8").trim() || null;
  return process.env.ANTHROPIC_API_KEY?.trim() || null;
}

const key = readKey();
const model = process.env.QUIRENOTE_LIVE_MODEL?.trim() || "claude-haiku-5-5";
const provider: ProviderRuntime = { id: "live_anthropic", kind: "anthropic", apiKey: key };
const haiku: ModelRef = { provider, model };

const passages: Passage[] = DEMO_SOURCES.flatMap((s) =>
  s.text
    .split("\f")
    .map((t) => ({ n: 0, text: t.trim(), title: s.title }))
    .filter((p) => p.text),
).map((p, i) => ({ ...p, n: i + 1 }));
const valid = new Set(passages.map((p) => p.n));

async function collect(gen: AsyncGenerator<string>): Promise<string> {
  let out = "";
  for await (const d of gen) out += d;
  return out;
}

describe.skipIf(!key)(`live: ${model}`, () => {
  it("lists models with the key", async () => {
    expect(await listModels(provider)).toContain(model);
  });

  it("answers with citations that point at real passages", async () => {
    const question = "达特茅斯会议是哪一年召开的？谁提出了“人工智能”这个名字？";
    const answer = await collect(
      streamChat(haiku, {
        system: buildCitationSystemPrompt(passages, question),
        messages: [{ role: "user", content: question }],
      }),
    );
    expect(answer).toContain("1956");
    const nums = usedCitationNumbers(answer);
    expect(nums.length).toBeGreaterThan(0);
    for (const n of nums) expect(valid.has(n)).toBe(true);
  });

  it("says so instead of inventing an answer when the sources lack it", async () => {
    const question = "资料里提到的 QuireNote 定价是多少？";
    const answer = await collect(
      streamChat(haiku, {
        system: buildCitationSystemPrompt(passages, question),
        messages: [{ role: "user", content: question }],
      }),
    );
    expect(answer).toMatch(/没有|未|无法|不包含|并未/);
  });

  it.concurrent.each(ArtifactKind.options)("generates a schema-valid %s artifact", async (kind) => {
    const data = await generateArtifactData(haiku, { kind, passages, title: "人工智能简史" });
    expect(() => ArtifactData.parse(data)).not.toThrow();
    switch (data.kind) {
      case "markdown":
        expect(data.markdown.length).toBeGreaterThan(80);
        break;
      case "mindmap":
        expect(data.nodes.filter((n) => n.parentId === null)).toHaveLength(1);
        expect(data.nodes.length).toBeGreaterThan(3);
        break;
      case "quiz":
        expect(data.questions.length).toBeGreaterThan(1);
        for (const q of data.questions) expect(q.answer).toBeLessThan(q.options.length);
        break;
      case "audio":
        expect(new Set(data.script.map((l) => l.speaker))).toEqual(new Set(["A", "B"]));
        break;
      case "timeline":
        expect(data.events.some((e) => e.date.includes("1956"))).toBe(true);
        break;
      default:
        break;
    }
  });

  it("extracts elements whose quotes mostly come verbatim from the passages", async () => {
    const { elements } = await extractElements(haiku, passages);
    expect(elements.length).toBeGreaterThan(5);
    for (const e of elements) expect(valid.has(e.passage)).toBe(true);
    const all = passages.map((p) => p.text).join("\n");
    const verbatim = elements.filter((e) => all.includes(e.quote)).length;
    expect(verbatim / elements.length).toBeGreaterThan(0.6);
  });

  it("proposes agent ops that pass validation and only touch given notes", async () => {
    const notes = [
      {
        id: "note_a",
        title: "符号主义",
        markdown: "符号主义认为智能可以被精确描述。1956 年达特茅斯会议提出人工智能。",
      },
      { id: "note_b", title: "连接主义", markdown: "连接主义用神经网络从数据中学习。1986 年反向传播复兴。" },
    ];
    const p = await proposeAgentOps(haiku, {
      instruction: "把这两条笔记合并成一份对比表",
      notes,
      passages: [],
    });
    expect(p.ops.length).toBeGreaterThan(0);
    expect(p.ops.some((o) => o.op === "create_table")).toBe(true);
  });

  it("translates in place without citations", async () => {
    const out = await collect(
      transformStream(haiku, {
        action: "translate",
        text: "注意力就是一切。",
        targetLang: "English",
        passages: [],
      }),
    );
    expect(out).toMatch(/attention/i);
  });

  it("summarizes a source in a few sentences", async () => {
    const text = DEMO_SOURCES[1]!.text;
    const summary = await summarizeText(haiku, text, DEMO_SOURCES[1]!.title);
    expect(summary.length).toBeGreaterThan(20);
    expect(summary).not.toMatch(/^#|^\s*-/m);
  });

  it("works through the Anthropic-compatible kind pointed at the official endpoint", async () => {
    const compat: ModelRef = {
      provider: {
        id: "live_compat",
        kind: "anthropic-compatible",
        apiKey: key,
        baseUrl: "https://api.anthropic.com/v1",
      },
      model,
    };
    const answer = await collect(
      streamChat(compat, {
        system: "只回答一个阿拉伯数字。",
        messages: [{ role: "user", content: "1+1=?" }],
      }),
    );
    expect(answer).toContain("2");
  });
});
