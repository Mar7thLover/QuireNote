import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Chunk } from "@folio/core";
import { DEMO_SOURCES } from "@folio/core/fixtures";
import { describe, expect, it } from "vitest";
import { chunkText, joinPages, pageAt } from "../chunking";
import { stripInvalidMarkers, validateCitations } from "../citations";
import { REPO_ROOT, resetDataDir, resolveDataDir } from "../config";
import { createCipher, keyHint, loadOrCreateSecret } from "../crypto";
import { parsePlain } from "../ingest/parsers";
import { rrf } from "../retrieval";
import { buildKeywordQuery } from "../store/sqlite";
import { cleanupDir } from "./helpers";

describe("chunking", () => {
  const pdf = parsePlain(DEMO_SOURCES[0]!.text, { formFeedPages: true });

  it("joins pages and records page offsets", () => {
    const { text, pageOffsets } = joinPages(["Page one.", "Page two.", "Page three."]);
    expect(pageOffsets).toEqual([0, 11, 22]);
    expect(text.slice(pageOffsets[1]!, pageOffsets[1]! + 9)).toBe("Page two.");
    expect(pageAt(pageOffsets, 0)).toBe(1);
    expect(pageAt(pageOffsets, 12)).toBe(2);
    expect(pageAt(pageOffsets, 999)).toBe(3);
  });

  it("produces chunks whose text equals text.slice(start, end)", () => {
    const chunks = chunkText(pdf.text, pdf.pageOffsets, { target: 150, overlap: 40 });
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) {
      expect(c.text).toBe(pdf.text.slice(c.start, c.end));
      expect(c.text.trim()).toBe(c.text);
    }
    for (const [i, c] of chunks.entries()) expect(c.index).toBe(i);
  });

  it("assigns the correct page to every chunk", () => {
    const chunks = chunkText(pdf.text, pdf.pageOffsets, { target: 150 });
    expect(pdf.pageOffsets).toHaveLength(3);
    for (const c of chunks) {
      expect(c.page).toBe(pageAt(pdf.pageOffsets, c.start));
      // 不跨页：块的结尾也在同一页。
      expect(pageAt(pdf.pageOffsets, c.end - 1)).toBe(c.page);
    }
    expect(new Set(chunks.map((c) => c.page))).toEqual(new Set([1, 2, 3]));
    const objections = chunks.find((c) => c.text.includes("九种反对意见"))!;
    expect(objections.page).toBe(2);
    expect(objections.heading).toBe("图灵预见到的反对意见");
  });

  it("starts a new chunk at headings and records the heading", () => {
    const md = DEMO_SOURCES[2]!.text;
    const chunks = chunkText(md, [0], { target: 2000 });
    expect(chunks.every((c) => c.page === null)).toBe(true);
    const headings = chunks.map((c) => c.heading);
    expect(headings).toContain("2012：ImageNet 时刻");
    expect(headings).toContain("2017：注意力就是一切");
    const imagenet = chunks.find((c) => c.heading === "2012：ImageNet 时刻")!;
    expect(imagenet.text.startsWith("## 2012：ImageNet 时刻")).toBe(true);
  });

  it("overlaps adjacent chunks within a section and splits long paragraphs", () => {
    const sentences = Array.from(
      { length: 40 },
      (_, i) => `这是第${i + 1}句话，用来测试分块的重叠与切分逻辑。`,
    );
    const text = `# 标题\n\n${sentences.join("")}\n\n${sentences.slice(0, 10).join("")}`;
    const chunks = chunkText(text, [0], { target: 200, max: 300, overlap: 60 });
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) {
      expect(c.text).toBe(text.slice(c.start, c.end));
      expect(c.end - c.start).toBeLessThanOrEqual(300 + 60);
    }
    const overlapping = chunks.slice(1).filter((c, i) => c.start < chunks[i]!.end);
    expect(overlapping.length).toBeGreaterThan(0);
    // 全文被完整覆盖（除空白）。
    const covered = new Array(text.length).fill(false);
    for (const c of chunks) for (let i = c.start; i < c.end; i++) covered[i] = true;
    for (let i = 0; i < text.length; i++) if (!/\s/.test(text[i]!)) expect(covered[i]).toBe(true);
  });

  it("handles empty input", () => {
    expect(chunkText("", [0])).toEqual([]);
  });
});

describe("RRF fusion", () => {
  it("rewards items ranked well in both lists", () => {
    const fused = rrf([{ ids: ["a", "b", "c"] }, { ids: ["c", "a", "d"] }]);
    expect(fused.map((f) => f.id)).toEqual(["a", "c", "b", "d"]);
    const a = fused.find((f) => f.id === "a")!;
    expect(a.ranks).toEqual([1, 2]);
    expect(a.score).toBeCloseTo(1 / 61 + 1 / 62, 10);
    expect(fused.find((f) => f.id === "d")!.ranks).toEqual([null, 3]);
  });

  it("ignores duplicates within a list and supports weights", () => {
    const fused = rrf([{ ids: ["x", "x", "y"] }, { ids: ["y"], weight: 2 }]);
    expect(fused[0]!.id).toBe("y");
    expect(fused.find((f) => f.id === "x")!.score).toBeCloseTo(1 / 61, 10);
  });

  it("handles empty lists", () => {
    expect(rrf([{ ids: [] }, { ids: [] }])).toEqual([]);
  });
});

describe("keyword query builder", () => {
  it("splits CJK runs into trigrams and keeps short words for substring search", () => {
    const q = buildKeywordQuery("图灵测试 AI transformer");
    expect(q.fts).toContain('"图灵测"');
    expect(q.fts).toContain('"灵测试"');
    expect(q.fts).toContain('"transformer"');
    expect(q.short).toEqual(["ai"]);
    expect(buildKeywordQuery("图灵").fts).toBeNull();
    expect(buildKeywordQuery("图灵").short).toEqual(["图灵"]);
  });

  it("never passes FTS operators through: every term is a quoted phrase", () => {
    const q = buildKeywordQuery('NEAR(abc "def") OR ghi*');
    for (const part of q.fts!.split(" OR ")) expect(part).toMatch(/^"[^"]+"$/);
  });
});

describe("citation validation", () => {
  const text = "# 资料\n\n1956 年，达特茅斯会议召开。会议提出了人工智能一词。\n\n感知机由罗森布拉特提出。";
  const chunk = (id: string, start: number, end: number): Chunk => ({
    id,
    sourceId: "src_1",
    notebookId: "nb_1",
    index: 0,
    text: text.slice(start, end),
    start,
    end,
    page: 1,
    heading: "资料",
  });
  const c1 = chunk("ch_1", 0, text.indexOf("感知机") - 2);
  const c2 = chunk("ch_2", text.indexOf("感知机"), text.length);
  const passages = [
    { n: 1, chunk: c1, sourceTitle: "A" },
    { n: 2, chunk: c2, sourceTitle: "B" },
  ];

  it("removes unknown citation numbers", () => {
    expect(stripInvalidMarkers("结论 [1, 7]，另一个 [9]。", new Set([1]))).toBe("结论 [1]，另一个。");
    expect(stripInvalidMarkers("代码 `[9]` 保留", new Set([1]))).toBe("代码 `[9]` 保留");
  });

  it("returns citations only for real passages with quotes pointing into the source", () => {
    const { text: cleaned, citations } = validateCitations(
      "人工智能一词出自达特茅斯会议 [1]。感知机是罗森布拉特的 [2][5]。",
      passages,
    );
    expect(cleaned).not.toContain("[5]");
    expect(citations.map((c) => c.n)).toEqual([1, 2]);
    for (const c of citations) {
      expect(text.slice(c.start, c.end)).toBe(c.quote);
      expect(c.page).toBe(1);
    }
    expect(citations[0]!.quote).toBe("会议提出了人工智能一词。");
    expect(citations[1]!.quote).toContain("感知机");
  });

  it("attributes markers placed after the full stop to the preceding sentence", () => {
    const { citations } = validateCitations("1. 达特茅斯会议在 1956 年召开。 [1]", passages);
    expect(citations[0]!.quote).toBe("1956 年，达特茅斯会议召开。");
  });

  it("returns no citations when the answer has none", () => {
    expect(validateCitations("没有引用", passages).citations).toEqual([]);
  });
});

describe("key encryption", () => {
  it("round-trips with AES-256-GCM and uses a random IV", () => {
    const c = createCipher("secret-a");
    const t1 = c.encrypt("sk-test-123456");
    const t2 = c.encrypt("sk-test-123456");
    expect(t1).not.toBe(t2);
    expect(t1).not.toContain("sk-test");
    expect(c.decrypt(t1)).toBe("sk-test-123456");
  });

  it("fails with a different secret or tampered ciphertext", () => {
    const t = createCipher("secret-a").encrypt("hello");
    expect(() => createCipher("secret-b").decrypt(t)).toThrow();
    const parts = t.split(":");
    const ct = Buffer.from(parts[3]!, "base64");
    ct[0] = ct[0]! ^ 1;
    parts[3] = ct.toString("base64");
    expect(() => createCipher("secret-a").decrypt(parts.join(":"))).toThrow();
  });

  it("generates and reuses secret.key in the data dir", () => {
    const dir = mkdtempSync(join(tmpdir(), "folio-secret-"));
    try {
      const s1 = loadOrCreateSecret(dir, null);
      expect(s1).toMatch(/^[0-9a-f]{64}$/);
      expect(loadOrCreateSecret(dir, null)).toBe(s1);
      expect(loadOrCreateSecret(dir, "from-env")).toBe("from-env");
    } finally {
      cleanupDir(dir);
    }
  });

  it("keyHint exposes only the last four characters", () => {
    expect(keyHint("sk-abcdef1234")).toBe("…1234");
    expect(keyHint("abc")).toBe("…");
  });
});

describe("config", () => {
  it("resolves relative data dirs against the repo root", () => {
    expect(resolveDataDir("./data-e2e")).toBe(join(REPO_ROOT, "data-e2e"));
    expect(resolveDataDir(undefined)).toBe(join(REPO_ROOT, "data"));
  });

  it("refuses to reset the repo root or a filesystem root", () => {
    expect(() => resetDataDir(REPO_ROOT)).toThrow();
    expect(() => resetDataDir(join(REPO_ROOT, ".."))).toThrow();
  });
});
