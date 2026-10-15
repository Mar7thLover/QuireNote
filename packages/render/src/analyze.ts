/**
 * 静态 ReDoS 风险检测，供规则编辑器给出提示。
 *
 * 这是启发式检测，不是证明：它会识别最常见的灾难性回溯形态——
 * 嵌套量词（`(a+)+`）、量词下的重叠交替（`(a|ab)*`）、相邻的重叠无界量词（`\d+\d+`）。
 * 真正的防线是 worker 超时（见 `createRuleRunner`）。
 */

export type PatternIssueCode =
  | "invalid"
  | "nested-quantifier"
  | "overlapping-alternation"
  | "adjacent-quantifiers"
  | "large-repeat";

export interface PatternIssue {
  code: PatternIssueCode;
  severity: "warning" | "danger";
  message: string;
  /** 问题片段在 pattern 中的位置（无法编译时缺省）。 */
  start?: number;
  end?: number;
  snippet?: string;
}

export interface PatternAnalysis {
  valid: boolean;
  error?: string;
  /** 所有问题中最高的严重级别。 */
  risk: "none" | "warning" | "danger";
  issues: PatternIssue[];
}

// ───────────── 简化 AST ─────────────

type ClassCode = "d" | "D" | "w" | "W" | "s" | "S";

interface CharSet {
  any: boolean;
  negated: boolean;
  ranges: [number, number][];
  classes: ClassCode[];
}

type Node =
  | { t: "chars"; set: CharSet }
  | { t: "group"; alts: Term[][]; look: boolean }
  | { t: "assert" }
  | { t: "backref" };

interface Term {
  node: Node;
  min: number;
  max: number;
  start: number;
  end: number;
}

const ANY: CharSet = { any: true, negated: false, ranges: [], classes: [] };
const single = (cp: number): CharSet => ({ any: false, negated: false, ranges: [[cp, cp]], classes: [] });
const cls = (c: ClassCode): CharSet => ({ any: false, negated: false, ranges: [], classes: [c] });

const LARGE_REPEAT = 1000;
/** 量词上限超过这个值就按"无界"对待。 */
const MANY = 10;

class Parser {
  i = 0;
  constructor(
    readonly src: string,
    readonly vMode: boolean,
  ) {}

  parse(): Term[][] {
    const alts = this.alternation();
    if (this.i < this.src.length) throw new Error(`意外的字符 ${this.src[this.i]}`);
    return alts;
  }

  private peek(offset = 0): string {
    return this.src[this.i + offset] ?? "";
  }

  private alternation(): Term[][] {
    const alts: Term[][] = [this.sequence()];
    while (this.peek() === "|") {
      this.i++;
      alts.push(this.sequence());
    }
    return alts;
  }

  private sequence(): Term[] {
    const terms: Term[] = [];
    while (this.i < this.src.length && this.peek() !== "|" && this.peek() !== ")") {
      const start = this.i;
      const node = this.atom();
      const [min, max] = this.quantifier(node);
      terms.push({ node, min, max, start, end: this.i });
    }
    return terms;
  }

  private quantifier(node: Node): [number, number] {
    const ch = this.peek();
    let q: [number, number] | null = null;
    if (ch === "*") q = [0, Number.POSITIVE_INFINITY];
    else if (ch === "+") q = [1, Number.POSITIVE_INFINITY];
    else if (ch === "?") q = [0, 1];
    if (q) {
      this.i++;
    } else if (ch === "{") {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(this.src.slice(this.i));
      if (m) {
        const min = Number(m[1]);
        const max = m[2] === undefined ? min : m[3] === "" ? Number.POSITIVE_INFINITY : Number(m[3]);
        q = [min, max];
        this.i += m[0].length;
      }
    }
    if (!q) return [1, 1];
    if (this.peek() === "?") this.i++; // 惰性量词：最坏情况的回溯规模相同
    if (node.t === "assert") return [1, 1];
    return q;
  }

  private atom(): Node {
    const ch = this.peek();
    if (ch === "(") return this.group();
    if (ch === "[") return { t: "chars", set: this.bracket() };
    if (ch === ".") {
      this.i++;
      return { t: "chars", set: ANY };
    }
    if (ch === "^" || ch === "$") {
      this.i++;
      return { t: "assert" };
    }
    if (ch === "\\") return this.escapeNode();
    const cp = this.src.codePointAt(this.i) ?? 0;
    this.i += cp > 0xffff ? 2 : 1;
    return { t: "chars", set: single(cp) };
  }

  private group(): Node {
    this.i++; // (
    let look = false;
    if (this.peek() === "?") {
      const m = /^\?(?::|=|!|<=|<!|<[^>]+>|[ims]*(?:-[ims]+)?:)/.exec(this.src.slice(this.i));
      if (!m) throw new Error("无法识别的分组");
      look = /^\?(=|!|<=|<!)/.test(m[0]);
      this.i += m[0].length;
    }
    const alts = this.alternation();
    if (this.peek() !== ")") throw new Error("缺少 )");
    this.i++;
    return { t: "group", alts, look };
  }

  private escapeNode(): Node {
    const ch = this.peek(1);
    if (ch === "b" || ch === "B") {
      this.i += 2;
      return { t: "assert" };
    }
    if (/[1-9]/.test(ch)) {
      this.i += 2;
      while (/[0-9]/.test(this.peek())) this.i++;
      return { t: "backref" };
    }
    if (ch === "k" && this.peek(2) === "<") {
      const end = this.src.indexOf(">", this.i);
      this.i = end === -1 ? this.src.length : end + 1;
      return { t: "backref" };
    }
    return { t: "chars", set: this.escapeSet(false) };
  }

  /** 解析一个表示字符（集）的反斜杠转义。 */
  private escapeSet(inClass: boolean): CharSet {
    this.i++; // \
    const ch = this.peek();
    this.i += ch.length > 0 ? 1 : 0;
    if (ch !== "" && "dDwWsS".includes(ch)) return cls(ch as ClassCode);
    if (ch === "p" || ch === "P") {
      if (this.peek() === "{") {
        const end = this.src.indexOf("}", this.i);
        this.i = end === -1 ? this.src.length : end + 1;
      }
      return ANY;
    }
    const simple: Record<string, number> = { n: 10, r: 13, t: 9, f: 12, v: 11, "0": 0 };
    const code = simple[ch];
    if (code !== undefined) return single(code);
    if (inClass && ch === "b") return single(8); // 字符类中的 \b 是退格
    if (ch === "x") {
      const m = /^[0-9a-fA-F]{2}/.exec(this.src.slice(this.i));
      if (m) {
        this.i += 2;
        return single(Number.parseInt(m[0], 16));
      }
    }
    if (ch === "u") {
      const m = /^(?:\{([0-9a-fA-F]+)\}|([0-9a-fA-F]{4}))/.exec(this.src.slice(this.i));
      if (m) {
        this.i += m[0].length;
        return single(Number.parseInt(m[1] ?? m[2] ?? "0", 16));
      }
    }
    if (ch === "c" && /[a-zA-Z]/.test(this.peek())) {
      const c = this.peek();
      this.i++;
      return single(c.charCodeAt(0) % 32);
    }
    return single(ch.codePointAt(0) ?? 0);
  }

  private bracket(): CharSet {
    this.i++; // [
    const set: CharSet = { any: false, negated: false, ranges: [], classes: [] };
    if (this.peek() === "^") {
      set.negated = true;
      this.i++;
    }
    const readOne = (): CharSet => {
      if (this.peek() === "\\") return this.escapeSet(true);
      if (this.vMode && this.peek() === "[") return this.bracket();
      const cp = this.src.codePointAt(this.i) ?? 0;
      this.i += cp > 0xffff ? 2 : 1;
      return single(cp);
    };
    let wide = false;
    while (this.i < this.src.length && this.peek() !== "]") {
      const a = readOne();
      if (a.negated || a.any) {
        // 嵌套的否定类 / \p{..}：保守地视为任意字符
        wide = true;
        continue;
      }
      const lo = a.ranges.length === 1 && a.classes.length === 0 ? a.ranges[0] : undefined;
      if (lo && this.peek() === "-" && this.peek(1) !== "]" && this.peek(1) !== "") {
        this.i++;
        const b = readOne();
        const hi = b.ranges.length === 1 && b.classes.length === 0 ? b.ranges[0] : undefined;
        if (hi) {
          set.ranges.push([lo[0], hi[0]]);
        } else {
          set.ranges.push(lo, [45, 45], ...b.ranges);
          set.classes.push(...b.classes);
        }
        continue;
      }
      set.ranges.push(...a.ranges);
      set.classes.push(...a.classes);
    }
    if (this.peek() !== "]") throw new Error("缺少 ]");
    this.i++;
    return wide ? { ...ANY } : set;
  }
}

// ───────────── 字符集重叠（用探针字符近似判断） ─────────────

const isDigit = (cp: number) => cp >= 48 && cp <= 57;
const isWord = (cp: number) => isDigit(cp) || (cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122) || cp === 95;
const isSpace = (cp: number) => /\s/.test(String.fromCodePoint(cp));

function classTest(c: ClassCode, cp: number): boolean {
  switch (c) {
    case "d":
      return isDigit(cp);
    case "D":
      return !isDigit(cp);
    case "w":
      return isWord(cp);
    case "W":
      return !isWord(cp);
    case "s":
      return isSpace(cp);
    case "S":
      return !isSpace(cp);
  }
}

function matchesRaw(set: CharSet, cp: number): boolean {
  if (set.any) return true;
  const hit =
    set.ranges.some(([lo, hi]) => cp >= lo && cp <= hi) || set.classes.some((c) => classTest(c, cp));
  return set.negated ? !hit : hit;
}

function matchesChar(set: CharSet, cp: number, ignoreCase: boolean): boolean {
  if (matchesRaw(set, cp)) return true;
  if (!ignoreCase) return false;
  const s = String.fromCodePoint(cp);
  return [s.toLowerCase(), s.toUpperCase()].some((v) => v !== s && matchesRaw(set, v.codePointAt(0) ?? cp));
}

const PROBES: number[] = (() => {
  const list = [9, 10, 13, 0xa0, 0x3000, 0x2028];
  for (let c = 32; c < 127; c++) list.push(c);
  for (const ch of "中文字，。、；：？！“”‘’（）【】｜—…éßΩ") list.push(ch.codePointAt(0) ?? 0);
  return list;
})();

function probesFor(sets: CharSet[]): number[] {
  const extra: number[] = [];
  for (const s of sets) {
    for (const [lo, hi] of s.ranges) {
      if (hi - lo <= 256) for (let c = lo; c <= hi; c++) extra.push(c);
      else extra.push(lo, hi, Math.floor((lo + hi) / 2));
    }
  }
  return extra.length > 0 ? PROBES.concat(extra) : PROBES;
}

function overlaps(a: CharSet[], b: CharSet[], ignoreCase: boolean): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const probes = probesFor([...a, ...b]);
  return a.some((x) =>
    b.some((y) => {
      if (x.any || y.any) return true;
      return probes.some((cp) => matchesChar(x, cp, ignoreCase) && matchesChar(y, cp, ignoreCase));
    }),
  );
}

// ───────────── 分析 ─────────────

function nodeNullable(node: Node): boolean {
  if (node.t === "chars") return false;
  if (node.t === "group") return node.look || node.alts.some(seqNullable);
  return true;
}
function termNullable(t: Term): boolean {
  return t.min === 0 || nodeNullable(t.node);
}
function seqNullable(seq: Term[]): boolean {
  return seq.every(termNullable);
}

function firstOfNode(node: Node): CharSet[] {
  if (node.t === "chars") return [node.set];
  if (node.t === "backref") return [ANY];
  if (node.t === "group" && !node.look) return node.alts.flatMap(firstOfSeq);
  return [];
}
function firstOfSeq(seq: Term[]): CharSet[] {
  const out: CharSet[] = [];
  for (const t of seq) {
    out.push(...firstOfNode(t.node));
    if (!termNullable(t)) break;
  }
  return out;
}

function lastOfNode(node: Node): CharSet[] {
  if (node.t === "chars") return [node.set];
  if (node.t === "backref") return [ANY];
  if (node.t === "group" && !node.look) return node.alts.flatMap(lastOfSeq);
  return [];
}
function lastOfSeq(seq: Term[]): CharSet[] {
  const out: CharSet[] = [];
  for (let i = seq.length - 1; i >= 0; i--) {
    const t = seq[i];
    if (!t) continue;
    out.push(...lastOfNode(t.node));
    if (!termNullable(t)) break;
  }
  return out;
}

/** 节点匹配中可能出现的所有字符（粗略并集）。 */
function charsOfNode(node: Node): CharSet[] {
  if (node.t === "chars") return [node.set];
  if (node.t === "backref") return [ANY];
  if (node.t === "group" && !node.look)
    return node.alts.flatMap((seq) => seq.flatMap((t) => charsOfNode(t.node)));
  return [];
}

const repeats = (t: Term) => t.max > MANY;

function collectRepeated(seq: Term[], out: Term[]): void {
  for (const t of seq) {
    if (t.node.t === "group" && t.node.look) continue;
    if (repeats(t)) out.push(t);
    if (t.node.t === "group") for (const alt of t.node.alts) collectRepeated(alt, out);
  }
}

function contains(outer: Term, inner: Term): boolean {
  if (outer === inner) return true;
  if (outer.node.t !== "group") return false;
  return outer.node.alts.some((seq) => seq.some((t) => contains(t, inner)));
}

/** 静态检查正则的 ReDoS 风险。`flags` 用于判断 i / v 模式。 */
export function analyzePattern(pattern: string, flags = ""): PatternAnalysis {
  try {
    new RegExp(pattern, flags.replace(/[gy]/g, ""));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      valid: false,
      error: message,
      risk: "danger",
      issues: [{ code: "invalid", severity: "danger", message: `正则无法编译：${message}` }],
    };
  }

  let tree: Term[][];
  try {
    tree = new Parser(pattern, flags.includes("v")).parse();
  } catch {
    // 能编译但超出简易解析器的能力：不给静态结论，由运行时超时兜底。
    return { valid: true, risk: "none", issues: [] };
  }

  const ignoreCase = flags.includes("i");
  const issues: PatternIssue[] = [];
  const seen = new Set<string>();
  const report = (issue: Omit<PatternIssue, "start" | "end" | "snippet">, t: Term) => {
    const key = `${issue.code}:${t.start}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({ ...issue, start: t.start, end: t.end, snippet: pattern.slice(t.start, t.end) });
  };

  const visitTerm = (t: Term): void => {
    if (Math.max(t.min, Number.isFinite(t.max) ? t.max : 0) > LARGE_REPEAT) {
      report(
        { code: "large-repeat", severity: "warning", message: `重复次数超过 ${LARGE_REPEAT}，可能很慢` },
        t,
      );
    }
    const node = t.node;
    if (node.t !== "group") return;
    if (repeats(t) && !node.look) {
      // 1) 嵌套量词：内部有无界重复，且没有一个与之不重叠的必需"分隔符"把每轮迭代切开
      for (const alt of node.alts) {
        const inner: Term[] = [];
        collectRepeated(alt, inner);
        for (const it of inner) {
          const innerChars = charsOfNode(it.node);
          const delimited = alt.some(
            (d) =>
              !contains(d, it) && !termNullable(d) && !overlaps(charsOfNode(d.node), innerChars, ignoreCase),
          );
          if (!delimited) {
            report(
              {
                code: "nested-quantifier",
                severity: "danger",
                message: "嵌套量词（如 (a+)+）在匹配失败时会指数级回溯",
              },
              t,
            );
          }
        }
      }
      // 2) 重复分组里的交替分支能从同一字符开始
      if (node.alts.length > 1) {
        const firsts = node.alts.map((alt) => (seqNullable(alt) ? [ANY] : firstOfSeq(alt)));
        outer: for (let a = 0; a < firsts.length; a++) {
          for (let b = a + 1; b < firsts.length; b++) {
            if (overlaps(firsts[a] ?? [], firsts[b] ?? [], ignoreCase)) {
              report(
                {
                  code: "overlapping-alternation",
                  severity: "warning",
                  message: "重复分组中的分支可以匹配相同的开头（如 (a|ab)*），可能导致大量回溯",
                },
                t,
              );
              break outer;
            }
          }
        }
      }
    }
    for (const alt of node.alts) visitSeq(alt);
  };

  const visitSeq = (seq: Term[]): void => {
    // 相邻（中间只隔着可空项）且字符重叠的无界量词：多项式级回溯
    for (let a = 0; a < seq.length; a++) {
      const ta = seq[a];
      if (!ta || Number.isFinite(ta.max)) continue;
      for (let b = a + 1; b < seq.length; b++) {
        const tb = seq[b];
        if (!tb) break;
        if (!Number.isFinite(tb.max) && overlaps(lastOfNode(ta.node), firstOfNode(tb.node), ignoreCase)) {
          report(
            {
              code: "adjacent-quantifiers",
              severity: "warning",
              message: "相邻的无界量词可以匹配相同的字符（如 \\d+\\d+ 或 .*.*），长文本上会出现多项式级回溯",
            },
            ta,
          );
          break;
        }
        if (!termNullable(tb)) break;
      }
    }
    for (const t of seq) visitTerm(t);
  };

  for (const alt of tree) visitSeq(alt);

  const risk = issues.some((i) => i.severity === "danger")
    ? "danger"
    : issues.length > 0
      ? "warning"
      : "none";
  return { valid: true, risk, issues };
}
