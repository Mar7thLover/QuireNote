/**
 * 知识书触发：扫描文本 → 常驻 / 关键词命中 → 概率、计时、同组二选一 → 递归 → 预算裁剪 → 按 order 排序分位置。
 * 纯函数，服务端对话与「测试触发」共用。规则见 docs/CARD_SPEC.md「知识书」。
 */
import type { CardLoreEntry, LorebookSettings } from "@quirenote/core";
import { analyzePattern } from "@quirenote/render";

export type LoreTrigger = "constant" | "direct" | "recursive" | "sticky";

export interface LoreScanInput {
  settings: LorebookSettings;
  entries: readonly CardLoreEntry[];
  /** 对话消息，旧 → 新；最后一条是本次提问。 */
  messages: readonly string[];
  /** 额外总是参与扫描的文本（Studio 的生成要求、资料标题）。 */
  extra?: string;
  /** 条目 id → 距今几轮前用过（0 = 上一条回答）。用于 sticky / cooldown。 */
  lastUsed?: ReadonlyMap<string, number>;
  /** 对话里已有的消息数（不含本次提问），用于 delay。 */
  turnCount?: number;
  /** 测试时注入，默认 Math.random。 */
  random?: () => number;
}

export interface ActivatedEntry {
  entry: CardLoreEntry;
  trigger: LoreTrigger;
  tokens: number;
}

export interface LoreActivation {
  /** 最终插入的条目，按 order 排好。 */
  entries: ActivatedEntry[];
  /** 因预算被裁掉的条目。 */
  trimmed: ActivatedEntry[];
  before: string;
  after: string;
  atDepth: { depth: number; role: CardLoreEntry["role"]; content: string }[];
  tokens: number;
}

/** 粗估 token：中日韩文字每字约 1 个，其他约 4 个字符 1 个。 */
export function estimateTokens(text: string): number {
  let cjk = 0;
  for (const ch of text) if (/[぀-ヿ㐀-鿿가-힯]/.test(ch)) cjk++;
  return cjk + Math.ceil((text.length - cjk) / 4);
}

const MAX_SCAN = 40_000;
const regexCache = new Map<string, RegExp | null>();

/** `/pattern/flags` 形式的键编译成正则；无效或有回溯风险的返回 null（视为不匹配）。 */
function keyRegex(key: string): RegExp | null | undefined {
  const m = /^\/([\s\S]+)\/([a-z]*)$/.exec(key);
  if (!m) return undefined;
  if (regexCache.has(key)) return regexCache.get(key)!;
  const flags = [...new Set(m[2]!.replace(/[gy]/g, "").split(""))].join("");
  let re: RegExp | null = null;
  const analysis = analyzePattern(m[1]!, flags);
  if (analysis.valid && analysis.risk !== "danger") {
    try {
      re = new RegExp(m[1]!, flags);
    } catch {
      re = null;
    }
  }
  if (regexCache.size > 2000) regexCache.clear();
  regexCache.set(key, re);
  return re;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 一个键是否出现在文本里。中文没有词边界，整词匹配只对拉丁字母生效。 */
export function keyMatches(key: string, text: string, caseSensitive: boolean, wholeWords: boolean): boolean {
  const k = key.trim();
  if (!k) return false;
  const re = keyRegex(k);
  if (re !== undefined) return re ? re.test(text) : false;
  if (wholeWords && /^[\p{Script=Latin}\d\s'-]+$/u.test(k)) {
    return new RegExp(`(?<![\\p{L}\\d])${escapeRe(k)}(?![\\p{L}\\d])`, caseSensitive ? "u" : "iu").test(text);
  }
  return caseSensitive ? text.includes(k) : text.toLowerCase().includes(k.toLowerCase());
}

function matchesEntry(e: CardLoreEntry, text: string, s: LorebookSettings): boolean {
  const cs = e.case_sensitive ?? s.case_sensitive;
  const ww = e.match_whole_words ?? s.match_whole_words;
  if (!e.keys.some((k) => keyMatches(k, text, cs, ww))) return false;
  if (!e.secondary_keys.length) return true;
  const hits = e.secondary_keys.map((k) => keyMatches(k, text, cs, ww));
  switch (e.logic) {
    case "and_any":
      return hits.some(Boolean);
    case "and_all":
      return hits.every(Boolean);
    case "not_any":
      return !hits.some(Boolean);
    case "not_all":
      return !hits.every(Boolean);
  }
}

/** 同组只留一条：按 group_weight 加权抽取。已入选的组不再收新条目。 */
function applyGroups(found: ActivatedEntry[], taken: Set<string>, random: () => number): ActivatedEntry[] {
  const out: ActivatedEntry[] = [];
  const byGroup = new Map<string, ActivatedEntry[]>();
  for (const a of found) {
    const groups = a.entry.group
      .split(",")
      .map((g) => g.trim())
      .filter(Boolean);
    if (!groups.length || a.trigger === "sticky") {
      out.push(a);
      continue;
    }
    if (groups.some((g) => taken.has(g))) continue;
    const g = groups[0]!;
    byGroup.set(g, [...(byGroup.get(g) ?? []), a]);
  }
  for (const [g, list] of byGroup) {
    const total = list.reduce((n, a) => n + Math.max(0, a.entry.group_weight), 0);
    let r = random() * (total || list.length);
    let pick = list[0]!;
    for (const a of list) {
      r -= total ? Math.max(0, a.entry.group_weight) : 1;
      if (r < 0) {
        pick = a;
        break;
      }
    }
    taken.add(g);
    out.push(pick);
  }
  return out;
}

export function activateLore(input: LoreScanInput): LoreActivation {
  const empty: LoreActivation = { entries: [], trimmed: [], before: "", after: "", atDepth: [], tokens: 0 };
  const s = input.settings;
  if (!s.enabled) return empty;
  const random = input.random ?? Math.random;
  const turns = input.turnCount ?? Math.max(0, input.messages.length - 1);
  const scanFor = (e: CardLoreEntry) => {
    const depth = e.scan_depth ?? s.scan_depth;
    const msgs = input.messages.slice(-(depth + 1));
    return `${input.extra ?? ""}\n${msgs.join("\n")}`.slice(-MAX_SCAN);
  };

  const chosen = new Map<string, ActivatedEntry>();
  const taken = new Set<string>();
  const candidates = input.entries.filter((e) => e.enabled && !(e.delay && turns < e.delay));
  const roll = (e: CardLoreEntry) => e.probability >= 100 || random() * 100 < e.probability;

  // 第一轮：常驻、sticky、对话直接命中
  const first: ActivatedEntry[] = [];
  for (const e of candidates) {
    const last = input.lastUsed?.get(e.id);
    if (e.sticky && last !== undefined && last < e.sticky) {
      first.push({ entry: e, trigger: "sticky", tokens: estimateTokens(e.content) });
      continue;
    }
    if (e.cooldown && last !== undefined && last < e.cooldown) continue;
    if (e.constant) {
      if (roll(e)) first.push({ entry: e, trigger: "constant", tokens: estimateTokens(e.content) });
      continue;
    }
    if (matchesEntry(e, scanFor(e), s) && roll(e))
      first.push({ entry: e, trigger: "direct", tokens: estimateTokens(e.content) });
  }
  for (const a of applyGroups(first, taken, random)) chosen.set(a.entry.id, a);

  // 递归：新入选条目的正文再扫一轮
  if (s.recursive) {
    let fresh = [...chosen.values()];
    for (let level = 0; level < s.max_recursion && fresh.length; level++) {
      const text = fresh
        .filter((a) => !a.entry.prevent_recursion)
        .map((a) => a.entry.content)
        .join("\n")
        .slice(0, MAX_SCAN);
      if (!text.trim()) break;
      const found: ActivatedEntry[] = [];
      for (const e of candidates) {
        if (chosen.has(e.id) || e.constant || e.exclude_recursion) continue;
        const last = input.lastUsed?.get(e.id);
        if (e.cooldown && last !== undefined && last < e.cooldown) continue;
        if (matchesEntry(e, text, s) && roll(e))
          found.push({ entry: e, trigger: "recursive", tokens: estimateTokens(e.content) });
      }
      fresh = applyGroups(found, taken, random);
      for (const a of fresh) chosen.set(a.entry.id, a);
    }
  }

  // 预算：常驻 > 对话直接触发（含 sticky）> 递归触发；同级按 priority 从高到低保留
  const tier = (a: ActivatedEntry) => (a.trigger === "constant" ? 0 : a.trigger === "recursive" ? 2 : 1);
  const ranked = [...chosen.values()].sort(
    (a, b) => tier(a) - tier(b) || b.entry.priority - a.entry.priority || a.entry.order - b.entry.order,
  );
  const kept: ActivatedEntry[] = [];
  const trimmed: ActivatedEntry[] = [];
  let used = 0;
  for (const a of ranked) {
    if (s.token_budget > 0 && used + a.tokens > s.token_budget) {
      trimmed.push(a);
      continue;
    }
    used += a.tokens;
    kept.push(a);
  }
  kept.sort((a, b) => a.entry.order - b.entry.order || a.entry.name.localeCompare(b.entry.name));

  const join = (list: ActivatedEntry[]) =>
    list
      .map((a) => a.entry.content.trim())
      .filter(Boolean)
      .join("\n\n");
  return {
    entries: kept,
    trimmed,
    before: join(kept.filter((a) => a.entry.position === "before_sources")),
    after: join(kept.filter((a) => a.entry.position === "after_sources")),
    atDepth: kept
      .filter((a) => a.entry.position === "at_depth" && a.entry.content.trim())
      .map((a) => ({ depth: a.entry.depth, role: a.entry.role, content: a.entry.content.trim() })),
    tokens: used,
  };
}

/** 导入时检查正则键：无效或有灾难性回溯风险的键返回说明。 */
export function riskyLoreKeys(entries: readonly CardLoreEntry[]): { id: string; key: string }[] {
  const out: { id: string; key: string }[] = [];
  for (const e of entries)
    for (const k of [...e.keys, ...e.secondary_keys])
      if (/^\/[\s\S]+\/[a-z]*$/.test(k.trim()) && keyRegex(k.trim()) === null) out.push({ id: e.id, key: k });
  return out;
}
