/**
 * 分块：按标题与段落边界切分，带重叠；每块的 text 恰好等于原文 text.slice(start, end)，
 * 并记录所在页码（1 起）与最近的标题，用于跳转高亮。
 */
import { splitSentences } from "@quirenote/ai";

export interface ChunkDraft {
  index: number;
  text: string;
  start: number;
  end: number;
  page: number | null;
  heading: string | null;
}

export interface ChunkOptions {
  /** 目标块长（字符）。 */
  target?: number;
  /** 单块上限。 */
  max?: number;
  /** 相邻块重叠（字符，按句子边界取整）。 */
  overlap?: number;
  /** 是否为分页资料（PDF 等）；否则 page 为 null。 */
  paged?: boolean;
}

interface Block {
  start: number;
  end: number;
  heading: string | null;
  isHeading: boolean;
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

/** 第 offset 个字符所在页（1 起）。 */
export function pageAt(pageOffsets: number[], offset: number): number {
  let lo = 0;
  let hi = pageOffsets.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pageOffsets[mid]! <= offset) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans + 1;
}

/** 把文本切成段落块（以空行或页边界分隔），识别 Markdown 标题。 */
function blocks(text: string, pageOffsets: number[]): Block[] {
  const out: Block[] = [];
  const pageStarts = new Set(pageOffsets.filter((o) => o > 0));
  let heading: string | null = null;
  const re = /\n[ \t]*\n+/g;
  let last = 0;
  const pushRange = (s: number, e: number) => {
    // 页边界也作为块边界。
    const cuts = [...pageStarts].filter((p) => p > s && p < e).sort((a, b) => a - b);
    let cur = s;
    for (const c of [...cuts, e]) {
      let a = cur;
      let b = c;
      while (a < b && /\s/.test(text[a]!)) a++;
      while (b > a && /\s/.test(text[b - 1]!)) b--;
      if (b > a) {
        const firstLine = text.slice(a, b).split("\n")[0]!;
        const m = HEADING_RE.exec(firstLine);
        if (m && !text.slice(a, b).includes("\n")) {
          heading = m[2]!.trim();
          out.push({ start: a, end: b, heading, isHeading: true });
        } else if (m) {
          // 标题行后紧跟正文：拆成标题块 + 正文块。
          heading = m[2]!.trim();
          const hEnd = a + firstLine.length;
          out.push({ start: a, end: hEnd, heading, isHeading: true });
          let bs = hEnd;
          while (bs < b && /\s/.test(text[bs]!)) bs++;
          if (bs < b) out.push({ start: bs, end: b, heading, isHeading: false });
        } else out.push({ start: a, end: b, heading, isHeading: false });
      }
      cur = c;
    }
  };
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    pushRange(last, m.index);
    last = m.index + m[0].length;
  }
  pushRange(last, text.length);
  return out;
}

/** 把超长块按句子（再不行按字符）切开。 */
function splitLong(text: string, b: Block, max: number): Block[] {
  if (b.end - b.start <= max) return [b];
  const slice = text.slice(b.start, b.end);
  const parts: Block[] = [];
  let curStart = -1;
  let curEnd = -1;
  for (const s of splitSentences(slice)) {
    const s0 = b.start + s.start;
    const s1 = b.start + s.end;
    if (curStart < 0) {
      curStart = s0;
      curEnd = s1;
    } else if (s1 - curStart <= max) curEnd = s1;
    else {
      parts.push({ ...b, start: curStart, end: curEnd });
      curStart = s0;
      curEnd = s1;
    }
  }
  if (curStart >= 0) parts.push({ ...b, start: curStart, end: curEnd });
  // 单句仍超长：硬切。
  return parts.flatMap((p) => {
    if (p.end - p.start <= max) return [p];
    const out: Block[] = [];
    for (let i = p.start; i < p.end; i += max) out.push({ ...p, start: i, end: Math.min(p.end, i + max) });
    return out;
  });
}

/** 在 [from, to) 内找重叠起点：尽量从句子开头开始，长度约为 overlap。 */
function overlapStart(text: string, from: number, to: number, overlap: number): number {
  if (overlap <= 0 || to - from <= overlap) return to;
  const windowStart = to - overlap;
  const sents = splitSentences(text.slice(from, to));
  for (const s of sents) {
    const abs = from + s.start;
    if (abs >= windowStart) return abs;
  }
  return to;
}

export function chunkText(text: string, pageOffsets: number[] = [0], opts: ChunkOptions = {}): ChunkDraft[] {
  const target = opts.target ?? 700;
  const max = Math.max(target, opts.max ?? 1100);
  const overlap = opts.overlap ?? 120;
  const paged = opts.paged ?? pageOffsets.length > 1;
  const bs = blocks(text, pageOffsets).flatMap((b) => (b.isHeading ? [b] : splitLong(text, b, max)));
  const out: ChunkDraft[] = [];
  let cur: { start: number; end: number; heading: string | null; hasBody: boolean } | null = null;

  const flush = () => {
    if (!cur?.hasBody) return;
    out.push({
      index: out.length,
      text: text.slice(cur.start, cur.end),
      start: cur.start,
      end: cur.end,
      page: paged ? pageAt(pageOffsets, cur.start) : null,
      heading: cur.heading,
    });
  };

  for (const b of bs) {
    if (b.isHeading) {
      // 标题开始新块：标题文字包含在新块开头（便于检索与显示）。
      if (cur?.hasBody) {
        flush();
        cur = null;
      }
      if (!cur) cur = { start: b.start, end: b.end, heading: b.heading, hasBody: false };
      else {
        cur.end = b.end;
        cur.heading = b.heading;
      }
      continue;
    }
    const pageChange: boolean =
      !!paged && !!cur?.hasBody && pageAt(pageOffsets, b.start) !== pageAt(pageOffsets, cur!.start);
    if (!cur) {
      cur = { start: b.start, end: b.end, heading: b.heading, hasBody: true };
    } else if (b.end - cur.start <= target && !pageChange) {
      cur.end = b.end;
      cur.hasBody = true;
    } else if (!cur.hasBody) {
      // 只有标题：与本段合并，即使超过 target。
      cur.end = b.end;
      cur.hasBody = true;
    } else {
      const prevStart = cur.start;
      const prevEnd = cur.end;
      flush();
      // 重叠：同一标题、同一页内才带上上一块末尾的句子。
      const ov: number =
        !pageChange && b.heading === cur.heading ? overlapStart(text, prevStart, prevEnd, overlap) : b.start;
      const start: number = ov < prevEnd ? ov : b.start;
      cur = { start, end: b.end, heading: b.heading, hasBody: true };
      if (cur.end - cur.start > max) cur.start = b.start;
    }
  }
  flush();
  return out;
}

/** 把多页文本拼成全文，返回页偏移。页与页之间用空行分隔。 */
export function joinPages(pages: string[]): { text: string; pageOffsets: number[] } {
  const offsets: number[] = [];
  let text = "";
  pages.forEach((p, i) => {
    if (i > 0) text += "\n\n";
    offsets.push(text.length);
    text += p.replace(/\r\n?/g, "\n").trim();
  });
  return { text, pageOffsets: offsets.length ? offsets : [0] };
}
