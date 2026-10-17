/** 首页数据：AI 用量与花费、写作字数、最近打开的笔记。 */
import { estimateCost, isCjkChar, stripMarkdown, truncate } from "@quirenote/ai";
import type { Note } from "@quirenote/core";
import type { AppContext } from "../context";
import { localDay } from "../models";
import type { UsageRow } from "../store/types";

// ───────────── 用量 ─────────────

export interface UsageTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  searches: number;
  /** 有价目的模型的估算花费（美元）。 */
  cost: number;
  /** 没有价目的模型产生的 Token（不计入 cost）。 */
  unpricedTokens: number;
}

export interface UsageSummary {
  today: string;
  /** 月度预算（美元）；未设置为 null。 */
  budget: number | null;
  month: UsageTotals;
  /** 最近 7 天（含今天）与之前 7 天。 */
  week: UsageTotals;
  prevWeek: UsageTotals;
  /** 最近 14 天逐日，旧 → 新。 */
  daily: { day: string; tokens: number; cost: number }[];
  /** 本月按模型。 */
  byModel: { providerId: string; model: string; tokens: number; cost: number | null; calls: number }[];
}

const empty = (): UsageTotals => ({
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  searches: 0,
  cost: 0,
  unpricedTokens: 0,
});

function addRow(t: UsageTotals, r: UsageRow): void {
  t.calls += r.calls;
  t.inputTokens += r.inputTokens;
  t.outputTokens += r.outputTokens;
  t.cacheReadTokens += r.cacheReadTokens;
  t.cacheWriteTokens += r.cacheWriteTokens;
  t.searches += r.searches;
  const cost = estimateCost(r.model, r);
  if (cost === null) t.unpricedTokens += r.inputTokens + r.outputTokens;
  else t.cost += cost;
}

const tokensOf = (r: Pick<UsageRow, "inputTokens" | "outputTokens">) => r.inputTokens + r.outputTokens;

function daysAgo(n: number, from = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() - n);
  return localDay(d);
}

export async function usageSummary(ctx: AppContext): Promise<UsageSummary> {
  const now = new Date();
  const today = localDay(now);
  const monthStart = `${today.slice(0, 7)}-01`;
  const since = [daysAgo(13, now), monthStart].sort()[0]!;
  const rows = await ctx.store.usage.list(since);
  const weekStart = daysAgo(6, now);
  const prevStart = daysAgo(13, now);

  const month = empty();
  const week = empty();
  const prevWeek = empty();
  const byDay = new Map<string, { tokens: number; cost: number }>();
  const byModel = new Map<string, UsageSummary["byModel"][number]>();
  for (const r of rows) {
    if (r.day >= monthStart) {
      addRow(month, r);
      const key = `${r.providerId}:${r.model}`;
      const m = byModel.get(key) ?? {
        providerId: r.providerId,
        model: r.model,
        tokens: 0,
        cost: 0,
        calls: 0,
      };
      m.tokens += tokensOf(r);
      m.calls += r.calls;
      const c = estimateCost(r.model, r);
      m.cost = c === null || m.cost === null ? null : m.cost + c;
      byModel.set(key, m);
    }
    if (r.day >= weekStart) addRow(week, r);
    else if (r.day >= prevStart) addRow(prevWeek, r);
    const d = byDay.get(r.day) ?? { tokens: 0, cost: 0 };
    d.tokens += tokensOf(r);
    d.cost += estimateCost(r.model, r) ?? 0;
    byDay.set(r.day, d);
  }
  const daily = Array.from({ length: 14 }, (_, i) => {
    const day = daysAgo(13 - i, now);
    return { day, ...(byDay.get(day) ?? { tokens: 0, cost: 0 }) };
  });
  const budget = (await ctx.store.settings.get<{ monthlyUsd?: number }>("aiBudget"))?.monthlyUsd ?? null;
  return {
    today,
    budget: budget && budget > 0 ? budget : null,
    month,
    week,
    prevWeek,
    daily,
    byModel: [...byModel.values()].sort((a, b) => b.tokens - a.tokens),
  };
}

// ───────────── 写作与最近打开 ─────────────

/** 字数：中日韩文字按字计，其他按词计。 */
export function countWords(markdown: string): number {
  const text = stripMarkdown(markdown);
  let n = 0;
  let inWord = false;
  for (const ch of text) {
    if (isCjkChar(ch)) {
      n++;
      inWord = false;
    } else if (/[\p{L}\p{N}]/u.test(ch)) {
      if (!inWord) n++;
      inWord = true;
    } else {
      inWord = false;
    }
  }
  return n;
}

const RECENT_KEY = "recentNotes";
const RECENT_MAX = 30;

export async function recordNoteOpened(ctx: AppContext, noteId: string): Promise<void> {
  const list = (await ctx.store.settings.get<{ id: string; at: string }[]>(RECENT_KEY)) ?? [];
  const next = [{ id: noteId, at: new Date().toISOString() }, ...list.filter((r) => r.id !== noteId)];
  await ctx.store.settings.set(RECENT_KEY, next.slice(0, RECENT_MAX));
}

export interface RecentNote {
  id: string;
  notebookId: string;
  notebookTitle: string;
  notebookColor: string;
  notebookIcon: string;
  title: string;
  excerpt: string;
  words: number;
  tags: string[];
  updatedAt: string;
  /** 最近一次打开；从未打开过（按修改时间补位）为 null。 */
  openedAt: string | null;
}

export interface Overview {
  writing: {
    words: number;
    notes: number;
    /** 最近 7 天修改过的笔记数。 */
    editedThisWeek: number;
    /** 最近 7 天新建笔记的字数。 */
    wordsThisWeek: number;
  };
  recent: RecentNote[];
}

export async function overview(ctx: AppContext): Promise<Overview> {
  const [notes, notebooks, opened] = await Promise.all([
    ctx.store.notes.list(),
    ctx.store.notebooks.list(),
    ctx.store.settings.get<{ id: string; at: string }[]>(RECENT_KEY),
  ]);
  const writable = notes.filter((n) => n.kind === "note");
  const words = new Map(writable.map((n) => [n.id, countWords(n.markdown)]));
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const nbs = new Map(notebooks.map((n) => [n.id, n]));
  const byId = new Map(writable.map((n) => [n.id, n]));

  const toRecent = (n: Note, openedAt: string | null): RecentNote | null => {
    const nb = nbs.get(n.notebookId);
    if (!nb) return null;
    const body = stripMarkdown(n.markdown).replace(/\s+/g, " ").trim();
    return {
      id: n.id,
      notebookId: n.notebookId,
      notebookTitle: nb.title,
      notebookColor: nb.color,
      notebookIcon: nb.icon,
      title: n.title,
      excerpt: truncate(body, 140),
      words: words.get(n.id) ?? 0,
      tags: n.tags,
      updatedAt: n.updatedAt,
      openedAt,
    };
  };
  const recent: RecentNote[] = [];
  for (const r of opened ?? []) {
    const n = byId.get(r.id);
    const item = n ? toRecent(n, r.at) : null;
    if (item) recent.push(item);
    if (recent.length >= 8) break;
  }
  // 打开记录不足时，用最近修改的笔记补位。
  if (recent.length < 8) {
    for (const n of [...writable].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
      if (recent.length >= 8) break;
      if (recent.some((r) => r.id === n.id)) continue;
      const item = toRecent(n, null);
      if (item) recent.push(item);
    }
  }
  return {
    writing: {
      words: [...words.values()].reduce((a, b) => a + b, 0),
      notes: writable.length,
      editedThisWeek: writable.filter((n) => n.updatedAt >= weekAgo).length,
      wordsThisWeek: writable
        .filter((n) => n.createdAt >= weekAgo)
        .reduce((a, n) => a + (words.get(n.id) ?? 0), 0),
    },
    recent,
  };
}
