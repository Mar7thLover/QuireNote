/** 为生成任务挑选资料片段：覆盖全文、控制总长度。 */
import type { Passage } from "@quirenote/ai";
import type { Chunk, Source } from "@quirenote/core";
import type { CitablePassage } from "../citations";
import type { AppContext } from "../context";
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
