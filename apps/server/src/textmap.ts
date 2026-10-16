/**
 * 文本改动后的偏移映射：找出新旧文本中逐字相同的片段，把旧文本里的字符位置换算到新文本。
 * 先剥掉公共前后缀（常见的单处修改几乎零成本），中间部分做行级 LCS。
 */

/** 逐字相同的一段：old[a, a+len) === new[b, b+len)。 */
export interface EqualRun {
  a: number;
  b: number;
  len: number;
}

/** 行级 LCS 的上限（行数乘积）；超过时中间部分整体视为替换。 */
const MAX_LCS_CELLS = 4_000_000;

function splitLines(text: string): string[] {
  return text ? text.split(/(?<=\n)/) : [];
}

function lineRuns(oldText: string, newText: string): EqualRun[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const n = a.length;
  const m = b.length;
  if (!n || !m || n * m > MAX_LCS_CELLS) return [];
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const runs: EqualRun[] = [];
  let i = 0;
  let j = 0;
  let ai = 0;
  let bj = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      const last = runs.at(-1);
      if (last && last.a + last.len === ai && last.b + last.len === bj) last.len += a[i]!.length;
      else runs.push({ a: ai, b: bj, len: a[i]!.length });
      ai += a[i++]!.length;
      bj += b[j++]!.length;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) ai += a[i++]!.length;
    else bj += b[j++]!.length;
  }
  return runs;
}

export function equalRuns(oldText: string, newText: string): EqualRun[] {
  const max = Math.min(oldText.length, newText.length);
  let p = 0;
  while (p < max && oldText[p] === newText[p]) p++;
  let s = 0;
  while (s < max - p && oldText[oldText.length - 1 - s] === newText[newText.length - 1 - s]) s++;
  const runs: EqualRun[] = [];
  if (p) runs.push({ a: 0, b: 0, len: p });
  const mid = lineRuns(oldText.slice(p, oldText.length - s), newText.slice(p, newText.length - s));
  for (const r of mid) runs.push({ a: r.a + p, b: r.b + p, len: r.len });
  if (s) runs.push({ a: oldText.length - s, b: newText.length - s, len: s });
  return runs;
}

export interface OffsetMap {
  /** 旧位置所在字符原样保留时返回新位置，否则（被删改）返回 null。 */
  exact(pos: number): number | null;
  /** 总能给出新位置：落在被删改区域时取其后第一个保留字符的位置。 */
  nearest(pos: number): number;
}

export function offsetMap(oldText: string, newText: string): OffsetMap {
  const runs = equalRuns(oldText, newText);
  // 第一个 a + len > pos 的片段（片段按 a 递增）。
  const find = (pos: number): EqualRun | undefined => {
    let lo = 0;
    let hi = runs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (runs[mid]!.a + runs[mid]!.len > pos) hi = mid;
      else lo = mid + 1;
    }
    return runs[lo];
  };
  return {
    exact(pos) {
      const r = find(pos);
      return r && r.a <= pos ? r.b + (pos - r.a) : null;
    },
    nearest(pos) {
      const r = find(pos);
      if (!r) return newText.length;
      return r.a <= pos ? r.b + (pos - r.a) : r.b;
    },
  };
}

/** 把一段旧文本 [start, end) 定位到新文本；原文被改动、找不到原样文字时返回 null。 */
export function relocateRange(
  map: OffsetMap,
  oldText: string,
  newText: string,
  start: number,
  end: number,
): { start: number; end: number } | null {
  const quote = oldText.slice(start, end);
  if (!quote) return null;
  const s = map.exact(start);
  const e = map.exact(end - 1);
  if (s !== null && e !== null && newText.slice(s, e + 1) === quote) return { start: s, end: e + 1 };
  // 中间有改动：在新文本里找同样的文字，取离原位置最近的一处。
  const near = map.nearest(start);
  let best: number | null = null;
  for (let i = newText.indexOf(quote); i >= 0; i = newText.indexOf(quote, i + 1)) {
    if (best === null || Math.abs(i - near) < Math.abs(best - near)) best = i;
    if (i > near) break;
  }
  return best === null ? null : { start: best, end: best + quote.length };
}

/** 分页起点随文本移动；保持从 0 开始、单调不减。 */
export function remapPageOffsets(map: OffsetMap, pageOffsets: number[]): number[] {
  const out: number[] = [];
  for (const p of pageOffsets) {
    const q = p === 0 ? 0 : map.nearest(p);
    out.push(Math.max(q, out.at(-1) ?? 0));
  }
  return out.length ? out : [0];
}
