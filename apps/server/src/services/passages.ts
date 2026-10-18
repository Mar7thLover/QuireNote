/** 为生成任务挑选资料片段：覆盖全文、控制总长度。 */
import type { Passage } from "@quirenote/ai";
import type { Chunk, Note, Source } from "@quirenote/core";
import type { CitablePassage } from "../citations";
import type { AppContext } from "../context";
import { msg } from "../messages";
import { retrieve } from "../retrieval";

/** 参与生成的资料：指定的，否则为已勾选且就绪的。 */
export async function activeSources(
  ctx: AppContext,
  notebookId: string,
  sourceIds?: string[] | null,
): Promise<Source[]> {
  const all = await ctx.store.sources.list({ notebookId });
  const ready = all.filter((s) => s.status === "ready");
  if (sourceIds?.length) return ready.filter((s) => sourceIds.includes(s.id));
  return ready.filter((s) => s.selected);
}

/** 在一组分块中均匀抽样，保证覆盖开头、中间与结尾。 */
function spread<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(items[Math.floor((i * items.length) / n)]!);
  return out;
}

/** 笔记也算资料：单条最多交给模型这么多字。 */
const NOTE_MAX_CHARS = 8000;

/** 交给模型的笔记正文：去掉图片和资源引用（模型读不到），过长时截断。 */
function noteText(n: Note): string {
  const text = n.markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > NOTE_MAX_CHARS ? `${text.slice(0, NOTE_MAX_CHARS)}…` : text;
}

/** 提问里的检索词：拉丁字母按词，中文按相邻两字。 */
function queryTerms(text: string): string[] {
  const out = new Set<string>();
  for (const w of text.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []) out.add(w);
  for (const run of text.match(/\p{Script=Han}+/gu) ?? []) {
    if (run.length === 1) out.add(run);
    for (let i = 0; i + 1 < run.length; i++) out.add(run.slice(i, i + 2));
  }
  return [...out];
}

/**
 * 笔记片段（可引用）：全部放得下就按创建顺序全给；放不下时按与提问的词重合挑，再按创建顺序排列。
 * 编号从 startAt 开始，接在资料片段后面。
 */
export async function gatherNotes(
  ctx: AppContext,
  notebookId: string,
  opts: { query?: string; maxChars: number; startAt: number },
): Promise<GatheredPassages> {
  const items = (await ctx.store.notes.list({ notebookId }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((note) => ({ note, text: noteText(note) }))
    .filter((x) => x.text);
  let chosen = items;
  if (items.reduce((s, x) => s + x.text.length, 0) > opts.maxChars) {
    const terms = queryTerms(opts.query ?? "");
    const score = (x: (typeof items)[number]) => {
      const hay = `${x.note.title}\n${x.text}`.toLowerCase();
      return terms.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
    };
    const ranked = items
      .map((x, i) => ({ x, i, s: score(x) }))
      .sort((a, b) => b.s - a.s || b.x.note.updatedAt.localeCompare(a.x.note.updatedAt));
    const keep = new Set<number>();
    let budget = opts.maxChars;
    for (const r of ranked) {
      if (r.x.text.length > budget) continue;
      keep.add(r.i);
      budget -= r.x.text.length;
    }
    chosen = items.filter((_, i) => keep.has(i));
  }
  const passages: Passage[] = [];
  const citable: CitablePassage[] = [];
  chosen.forEach(({ note, text }, i) => {
    const n = opts.startAt + i;
    const title = note.title.trim() || msg().untitledNote;
    passages.push({ n, text, title: `笔记：${title}`, heading: null });
    citable.push({
      n,
      noteId: note.id,
      sourceTitle: title,
      chunk: {
        id: note.id,
        sourceId: note.id,
        notebookId,
        index: 0,
        text,
        start: 0,
        end: text.length,
        page: null,
        heading: null,
      },
    });
  });
  return { passages, citable };
}

export interface GatheredPassages {
  passages: Passage[];
  citable: CitablePassage[];
}

export async function gatherPassages(
  ctx: AppContext,
  notebookId: string,
  opts: {
    sourceIds?: string[] | null;
    maxChars?: number;
    query?: string;
    k?: number;
    fill?: boolean;
    /** relevance：检索命中按相关度排在前面，补足的片段按文中顺序跟在后面（对话用）；默认全部按文中顺序。 */
    order?: "document" | "relevance";
  } = {},
): Promise<GatheredPassages> {
  const maxChars = opts.maxChars ?? 16_000;
  const sources = await activeSources(ctx, notebookId, opts.sourceIds);
  const titles = new Map(sources.map((s) => [s.id, s.title]));
  let chosen: Chunk[] = [];
  if (opts.query?.trim()) {
    const { results } = await retrieve(ctx.store, notebookId, opts.query, {
      sourceIds: sources.map((s) => s.id),
      k: opts.k ?? 12,
      ...(await ctx.models.retrieval()),
    });
    chosen = results.map((r) => r.chunk);
  }
  const hits = chosen.length;
  const used = new Set(chosen.map((c) => c.id));
  let budget = maxChars - chosen.reduce((s, c) => s + c.text.length, 0);
  if (opts.fill !== false && budget > 0 && sources.length) {
    const rest = new Map<string, Chunk[]>();
    for (const s of sources)
      rest.set(
        s.id,
        (await ctx.store.chunks.listBySource(s.id)).filter((c) => !used.has(c.id)),
      );
    const restChars = [...rest.values()].flat().reduce((a, c) => a + c.text.length, 0);
    // 剩下的全部放得下：整份资料都给模型（长上下文模式），不再抽样。
    const per =
      restChars <= budget ? Number.POSITIVE_INFINITY : Math.max(1500, Math.floor(budget / sources.length));
    for (const s of sources) {
      const chunks = rest.get(s.id)!;
      const avg = chunks.length ? chunks.reduce((a, c) => a + c.text.length, 0) / chunks.length : 1;
      const n = Math.max(1, Math.floor(Math.min(per, budget) / Math.max(1, avg)));
      for (const c of spread(chunks, n)) {
        if (budget <= 0) break;
        chosen.push(c);
        used.add(c.id);
        budget -= c.text.length;
      }
    }
  }
  // 按资料顺序、文中顺序排列，便于模型理解。
  const order = new Map(sources.map((s, i) => [s.id, i]));
  const byDoc = (a: Chunk, b: Chunk) =>
    (order.get(a.sourceId) ?? 0) - (order.get(b.sourceId) ?? 0) || a.index - b.index;
  if (opts.order === "relevance") chosen = [...chosen.slice(0, hits), ...chosen.slice(hits).sort(byDoc)];
  else chosen.sort(byDoc);
  const passages: Passage[] = [];
  const citable: CitablePassage[] = [];
  chosen.forEach((c, i) => {
    const title = titles.get(c.sourceId) ?? "";
    passages.push({ n: i + 1, text: c.text, title, sourceId: c.sourceId, chunkId: c.id, heading: c.heading });
    citable.push({ n: i + 1, chunk: c, sourceTitle: title });
  });
  return { passages, citable };
}
