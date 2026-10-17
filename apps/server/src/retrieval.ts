/**
 * 混合检索：sqlite-vec 向量 + FTS5 关键词，RRF 融合。
 * 没有 Embedding 模型时，由对话模型把提问扩展成多组检索词，代替向量召回同义、跨语言的说法。
 */
import { embeddingKey, embedTexts, expandQuery, type ModelRef, type Passage } from "@quirenote/ai";
import type { Chunk } from "@quirenote/core";
import type { Store } from "./store/types";

export interface RankedList {
  /** 按相关度从高到低的 id。 */
  ids: string[];
  weight?: number;
}

export interface FusedItem {
  id: string;
  score: number;
  /** 各列表中的名次（1 起），未出现为 null。 */
  ranks: (number | null)[];
}

/** Reciprocal Rank Fusion：score = Σ w / (k + rank)。 */
export function rrf(lists: RankedList[], k = 60): FusedItem[] {
  const map = new Map<string, FusedItem>();
  lists.forEach((list, li) => {
    const seen = new Set<string>();
    list.ids.forEach((id, i) => {
      if (seen.has(id)) return;
      seen.add(id);
      let item = map.get(id);
      if (!item) {
        item = { id, score: 0, ranks: lists.map(() => null) };
        map.set(id, item);
      }
      item.ranks[li] = i + 1;
      item.score += (list.weight ?? 1) / (k + i + 1);
    });
  });
  return [...map.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

export interface RetrieveResult {
  chunk: Chunk;
  sourceTitle: string;
  score: number;
  vectorRank: number | null;
  keywordRank: number | null;
}

export interface RetrieveOptions {
  /** 限定资料范围；undefined = 笔记本内全部就绪资料。 */
  sourceIds?: string[];
  k?: number;
  /** 当前的 embedding 模型；为 null 时只做关键词检索。 */
  embedding: ModelRef | null;
  /** 没有 embedding 时用来扩展检索词的对话模型；为 null 时只用原始提问检索。 */
  expand?: ModelRef | null;
}

/** 扩展结果缓存：同一提问（重新生成、追问）不重复调用模型。 */
const expansions = new Map<string, string[]>();

async function expandedQueries(ref: ModelRef, query: string, titles: string[]): Promise<string[]> {
  const key = `${ref.provider.id}:${ref.model}:${query}`;
  const hit = expansions.get(key);
  if (hit) return hit;
  const out = await expandQuery(ref, query, titles);
  expansions.set(key, out);
  if (expansions.size > 200) expansions.delete(expansions.keys().next().value!);
  return out;
}

export async function retrieve(
  store: Store,
  notebookId: string,
  query: string,
  opts: RetrieveOptions,
): Promise<{ results: RetrieveResult[]; warning?: string }> {
  const k = Math.max(1, Math.min(50, opts.k ?? 8));
  const candidates = Math.max(40, k * 5);
  const sources = await store.sources.list({ notebookId });
  const allowed = new Set(
    sources
      .filter((s) => s.status === "ready" && (!opts.sourceIds || opts.sourceIds.includes(s.id)))
      .map((s) => s.id),
  );
  const titles = new Map(sources.map((s) => [s.id, s.title]));
  if (!allowed.size || !query.trim()) return { results: [] };

  let warning: string | undefined;
  let vectorIds: string[] = [];
  if (opts.embedding) {
    try {
      const [vec] = await embedTexts(opts.embedding, [query]);
      if (vec) {
        const hits = await store.chunks.vectorSearch(
          notebookId,
          embeddingKey(opts.embedding),
          vec,
          candidates * 2,
        );
        vectorIds = hits.map((h) => h.chunkId);
      }
    } catch (err) {
      warning = `向量检索失败，已退回关键词检索：${err instanceof Error ? err.message : String(err)}`;
    }
  }
  const keywordIds = (await store.chunks.keywordSearch(notebookId, query, candidates * 2)).map(
    (h) => h.chunkId,
  );
  // 扩展检索词各自做一次关键词检索，结果作为「语义」列表，权重略低于原始提问。
  let expandedIds: string[][] = [];
  if (!opts.embedding && opts.expand) {
    try {
      const terms = await expandedQueries(
        opts.expand,
        query,
        sources.filter((s) => allowed.has(s.id)).map((s) => s.title),
      );
      expandedIds = await Promise.all(
        terms.map(async (t) =>
          (await store.chunks.keywordSearch(notebookId, t, candidates)).map((h) => h.chunkId),
        ),
      );
    } catch (err) {
      warning = `扩展检索词失败，已只用原始提问检索：${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // 先按资料范围过滤，再融合（名次以过滤后的列表计）。
  const chunkMap = new Map(
    (await store.chunks.get([...new Set([...vectorIds, ...keywordIds, ...expandedIds.flat()])])).map((c) => [
      c.id,
      c,
    ]),
  );
  const keep = (ids: string[]) =>
    ids.filter((id) => allowed.has(chunkMap.get(id)?.sourceId ?? "")).slice(0, candidates);
  const fused = rrf([
    { ids: keep(vectorIds) },
    { ids: keep(keywordIds) },
    ...expandedIds.map((ids) => ({ ids: keep(ids), weight: 0.6 })),
  ]).slice(0, k);
  const results = fused.map((f) => {
    const chunk = chunkMap.get(f.id)!;
    return {
      chunk,
      sourceTitle: titles.get(chunk.sourceId) ?? "",
      score: Number(f.score.toFixed(6)),
      vectorRank: f.ranks[0] ?? null,
      keywordRank: f.ranks[1] ?? null,
    };
  });
  return warning ? { results, warning } : { results };
}

/** 检索结果 → 编号片段（n 从 1 开始）。 */
export function toPassages(results: RetrieveResult[]): Passage[] {
  return results.map((r, i) => ({
    n: i + 1,
    text: r.chunk.text,
    title: r.sourceTitle,
    sourceId: r.chunk.sourceId,
    chunkId: r.chunk.id,
    heading: r.chunk.heading,
  }));
}
