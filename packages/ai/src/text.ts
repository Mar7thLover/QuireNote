/** 文本工具：分句（带偏移）、分词、语言判断。local provider 与服务端分块共用。 */

export interface Sentence {
  text: string;
  /** 在原文中的起止偏移（不含首尾空白）。 */
  start: number;
  end: number;
}

const CJK = /[㐀-鿿豈-﫿]/;
const CJK_G = /[㐀-鿿豈-﫿]/g;

export function isCjkChar(ch: string): boolean {
  return CJK.test(ch);
}

/** 文本中 CJK 字符占比，用于判断用中文还是英文模板回答。 */
export function cjkRatio(text: string): number {
  const letters = text.replace(/[\s\d\p{P}\p{S}]/gu, "");
  if (!letters.length) return 0;
  return (letters.match(CJK_G)?.length ?? 0) / letters.length;
}

export function isChinese(text: string): boolean {
  return cjkRatio(text) > 0.3;
}

/**
 * 分句，返回每句的原文偏移。中文按 。！？；…，英文按 .!? 后接空白，换行也视为句界。
 * Markdown 标题行单独成句。
 */
export function splitSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  const re = /[^。！？!?；;\n]*?(?:[。！？!?；;]+[”’"』」）)]*|\.(?=\s|$)[”’"')]*|\n|$)/g;
  let m: RegExpExecArray | null = re.exec(text);
  while (m !== null) {
    if (m[0].length === 0) {
      if (m.index >= text.length) break;
      re.lastIndex = m.index + 1;
      m = re.exec(text);
      continue;
    }
    pushTrimmed(out, text, m.index, m.index + m[0].length);
    m = re.exec(text);
  }
  // 英文长句里的 ". " 已在上面处理；这里再把过长的英文句按 ". " 细分。
  return out.flatMap((s) => splitLongLatin(s, text));
}

function pushTrimmed(out: Sentence[], text: string, start: number, end: number): void {
  let s = start;
  let e = end;
  while (s < e && /\s/.test(text[s]!)) s++;
  while (e > s && /\s/.test(text[e - 1]!)) e--;
  if (e > s) out.push({ text: text.slice(s, e), start: s, end: e });
}

function splitLongLatin(s: Sentence, text: string): Sentence[] {
  if (s.text.length < 200 || isChinese(s.text)) return [s];
  const parts: Sentence[] = [];
  const re = /[^.!?]+[.!?]+(?=\s)|[^.!?]+$/g;
  for (const m of s.text.matchAll(re)) {
    pushTrimmed(parts, text, s.start + m.index, s.start + m.index + m[0].length);
  }
  return parts.length ? parts : [s];
}

const EN_STOP = new Set(
  "a an the and or but of to in on at for with by from as is are was were be been being this that these those it its into than then there their they them he she his her we our you your i not no do does did can could will would should may might must have has had about over under after before what which who whom whose when where why how also such only more most other some any each very just".split(
    " ",
  ),
);
const ZH_STOP = new Set("的了是在和与及或而也就都把被对从于以其之这那个们为着并一不有中上下".split(""));

/** 关键词切分：英文按词（去停用词），中文取二元组（去含停用字的）。用于关键词重合打分。 */
export function keywords(text: string): string[] {
  const out: string[] = [];
  const lower = text.toLowerCase().normalize("NFKC");
  for (const m of lower.matchAll(/[a-z0-9][a-z0-9\-']*/g)) {
    const w = m[0];
    if (w.length > 1 && !EN_STOP.has(w)) out.push(w);
  }
  for (const m of lower.matchAll(/[㐀-鿿豈-﫿]+/g)) {
    const run = m[0];
    if (run.length === 1) {
      if (!ZH_STOP.has(run)) out.push(run);
      continue;
    }
    for (let i = 0; i < run.length - 1; i++) {
      const bg = run.slice(i, i + 2);
      if (!ZH_STOP.has(bg[0]!) || !ZH_STOP.has(bg[1]!)) out.push(bg);
    }
  }
  return out;
}

/** 问题关键词在句子中的覆盖率（0–1）。 */
export function keywordOverlap(query: string, text: string): number {
  const q = [...new Set(keywords(query))];
  if (!q.length) return 0;
  const t = new Set(keywords(text));
  let hit = 0;
  for (const k of q) if (t.has(k)) hit++;
  return hit / q.length;
}

/** 去掉 Markdown 标记，便于把原句放进回答。 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

export function isHeadingLine(text: string): boolean {
  return /^#{1,6}\s/.test(text.trim());
}

export function truncate(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

/** 文本里出现的年份（1000–2099），按出现顺序去重。 */
export function findYears(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?<!\d)(1[0-9]{3}|20[0-9]{2})(?!\d)(?:\s*年)?/g)) out.add(m[1]!);
  return [...out];
}
