import { isHeadingLine, keywordOverlap, type Sentence, splitSentences, stripMarkdown } from "./text";
import type { Passage } from "./types";
import { cosine, textVector } from "./vector";

export interface PassageSentence extends Sentence {
  /** 片段编号。 */
  n: number;
  passage: Passage;
  /** 去 Markdown 后的句子。 */
  clean: string;
  /** 所属标题（最近的 Markdown 标题）。 */
  heading: string | null;
  vec: number[];
  /** 在片段内的序号，越靠前越可能是主题句。 */
  order: number;
}

/** 把片段切成可引用的句子（跳过标题行与过短的句子）。 */
export function passageSentences(passages: Passage[]): PassageSentence[] {
  const out: PassageSentence[] = [];
  for (const p of passages) {
    let heading: string | null = p.heading ?? null;
    let order = 0;
    for (const s of splitSentences(p.text)) {
      if (isHeadingLine(s.text)) {
        heading = stripMarkdown(s.text);
        continue;
      }
      const clean = stripMarkdown(s.text);
      if (clean.replace(/\s/g, "").length < 8) continue;
      out.push({ ...s, n: p.n, passage: p, clean, heading, vec: textVector(clean), order: order++ });
    }
  }
  return out;
}

/**
 * 选出有代表性且互不重复的句子（MMR）：与全文质心相似度高、与已选句子相似度低。
 * 可选 query 用于偏向某个主题。
 */
export function pickRepresentative(items: PassageSentence[], k: number, query?: string): PassageSentence[] {
  if (!items.length || k <= 0) return [];
  const dim = items[0]!.vec.length;
  const centroid = new Array<number>(dim).fill(0);
  for (const it of items) for (let i = 0; i < dim; i++) centroid[i]! += it.vec[i]!;
  const qv = query ? textVector(query) : null;
  const base = items.map((it) => {
    let s = cosine(centroid, it.vec) + 0.08 / (1 + it.order);
    if (qv) s += cosine(qv, it.vec) + 0.5 * keywordOverlap(query!, it.clean);
    // 太短或太长的句子不适合作为要点。
    const len = it.clean.length;
    if (len < 15) s -= 0.1;
    if (len > 260) s -= 0.1;
    return s;
  });
  const chosen: number[] = [];
  while (chosen.length < Math.min(k, items.length)) {
    let best = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < items.length; i++) {
      if (chosen.includes(i)) continue;
      let redundancy = 0;
      for (const j of chosen) redundancy = Math.max(redundancy, cosine(items[i]!.vec, items[j]!.vec));
      const s = 0.7 * base[i]! - 0.3 * redundancy;
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    }
    if (best < 0) break;
    chosen.push(best);
  }
  return chosen.map((i) => items[i]!);
}

/** 按原文顺序（片段编号、句内偏移）排序。 */
export function inDocumentOrder<T extends { n: number; start: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.n - b.n || a.start - b.start);
}
