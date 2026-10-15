/** 引用校验：只保留真实存在的片段编号，并把每个编号定位到资料原文中的一句话。 */
import { cosine, isHeadingLine, keywordOverlap, localEmbed, splitSentences, stripMarkdown } from "@folio/ai";
import type { Chunk, Citation } from "@folio/core";

export interface CitablePassage {
  n: number;
  chunk: Chunk;
  sourceTitle: string;
}

const GROUP_RE = /\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g;
const FENCE_RE = /```[\s\S]*?```|`[^`\n]*`/g;

/** 剔除不存在的编号：`[1, 9]` → `[1]`，`[9]` → 删除。代码块内不处理。 */
export function stripInvalidMarkers(text: string, valid: Set<number>): string {
  const fences: [number, number][] = [];
  for (const m of text.matchAll(FENCE_RE)) fences.push([m.index, m.index + m[0].length]);
  const inFence = (i: number) => fences.some(([a, b]) => i >= a && i < b);
  return text.replace(
    /([ \t]*)\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g,
    (whole, space: string, nums: string, offset: number) => {
      if (inFence(offset)) return whole;
      const kept = nums
        .split(",")
        .map((s) => Number.parseInt(s.trim(), 10))
        .filter((n) => valid.has(n));
      // 整组都无效时连同前导空白一起删除。
      return kept.length ? `${space}[${[...new Set(kept)].join(", ")}]` : "";
    },
  );
}

/** 回答中每个编号所在的句子（去掉引用标记）。 */
function sentencesCiting(text: string): Map<number, string[]> {
  const out = new Map<number, string[]>();
  let prev = "";
  for (const s of splitSentences(text)) {
    // 句号后单独成句的标记（"……。[1]"）归属上一句。
    let clean = s.text
      .replace(GROUP_RE, "")
      .replace(/^\s*\d+[.、)]\s*/, "")
      .trim();
    if (!clean.replace(/[\s\p{P}]/gu, "")) clean = prev;
    else prev = clean;
    for (const m of s.text.matchAll(GROUP_RE)) {
      for (const part of m[1]!.split(",")) {
        const n = Number.parseInt(part.trim(), 10);
        out.set(n, [...(out.get(n) ?? []), clean]);
      }
    }
  }
  return out;
}

/** 在片段里找与回答句最相近的一句作为引文。 */
export function bestQuote(chunk: Chunk, claims: string[]): { quote: string; start: number; end: number } {
  const sents = splitSentences(chunk.text).filter(
    (s) => !isHeadingLine(s.text) && stripMarkdown(s.text).length >= 4,
  );
  if (!sents.length) return { quote: chunk.text.trim().slice(0, 300), start: chunk.start, end: chunk.end };
  const claimText = claims.join(" ");
  const cv = claimText ? localEmbed(claimText) : null;
  let best = sents[0]!;
  let bestScore = Number.NEGATIVE_INFINITY;
  if (cv) {
    for (const s of sents) {
      const score = cosine(cv, localEmbed(s.text)) + 0.5 * keywordOverlap(claimText, s.text);
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
  }
  return { quote: best.text, start: chunk.start + best.start, end: chunk.start + best.end };
}

export function validateCitations(
  text: string,
  passages: CitablePassage[],
): { text: string; citations: Citation[] } {
  const byN = new Map(passages.map((p) => [p.n, p]));
  const cleaned = stripInvalidMarkers(text, new Set(byN.keys()));
  const claims = sentencesCiting(cleaned);
  const citations: Citation[] = [];
  const seen = new Set<number>();
  for (const m of cleaned.matchAll(GROUP_RE)) {
    for (const part of m[1]!.split(",")) {
      const n = Number.parseInt(part.trim(), 10);
      const p = byN.get(n);
      if (!p || seen.has(n)) continue;
      seen.add(n);
      const q = bestQuote(p.chunk, claims.get(n) ?? []);
      citations.push({
        n,
        chunkId: p.chunk.id,
        sourceId: p.chunk.sourceId,
        sourceTitle: p.sourceTitle,
        quote: q.quote,
        start: q.start,
        end: q.end,
        page: p.chunk.page,
      });
    }
  }
  return { text: cleaned, citations };
}
