export type DiffLine = { type: "same" | "add" | "del"; text: string };

/**
 * 行级 diff（LCS）。用于 Agent 改动预览，笔记规模下 O(n·m) 足够快；
 * 超过 4000×4000 时退化为整段替换，避免卡顿。
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length * b.length > 16_000_000) {
    return [
      ...a.map((text) => ({ type: "del" as const, text })),
      ...b.map((text) => ({ type: "add" as const, text })),
    ];
  }
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ type: "del", text: a[i++]! });
    } else {
      out.push({ type: "add", text: b[j++]! });
    }
  }
  while (i < n) out.push({ type: "del", text: a[i++]! });
  while (j < m) out.push({ type: "add", text: b[j++]! });
  return out;
}

/** 折叠大段未改动的行，只保留改动附近的上下文。 */
export function collapseContext(
  lines: DiffLine[],
  context = 2,
): (DiffLine | { type: "gap"; count: number })[] {
  const keep = new Array(lines.length).fill(false);
  lines.forEach((l, i) => {
    if (l.type !== "same")
      for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++)
        keep[k] = true;
  });
  const out: (DiffLine | { type: "gap"; count: number })[] = [];
  let gap = 0;
  lines.forEach((l, i) => {
    if (keep[i]) {
      if (gap) out.push({ type: "gap", count: gap });
      gap = 0;
      out.push(l);
    } else gap++;
  });
  if (gap) out.push({ type: "gap", count: gap });
  return out;
}
