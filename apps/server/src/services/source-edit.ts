/**
 * 编辑资料全文：按文本差异重新定位高亮与分页，保存第一次编辑前的原文以便恢复，然后排队重建索引
 * （分块、Embedding、摘要）。原始文件（PDF 等）不受影响。
 */
import type { Job, Source } from "@quirenote/core";
import type { AppContext } from "../context";
import { ApiError, badRequest, notFound } from "../errors";
import { offsetMap, relocateRange, remapPageOffsets } from "../textmap";

/** 编辑前的原文（解析结果）存放位置；不放在 sources/<id>/ 下，那里是原始文件。 */
export const originalTextPath = (sourceId: string) => `source-edits/${sourceId}.json`;

interface SavedOriginal {
  text: string;
  pageOffsets: number[];
}

export interface TextEditResult {
  source: Source;
  job: Job | null;
  highlights: { kept: number; removed: number };
}

/** 文本从 oldText 变为 newText 后，把该资料的高亮移到新位置；原文被删改的高亮删除。 */
export async function remapHighlights(
  ctx: AppContext,
  sourceId: string,
  oldText: string,
  newText: string,
): Promise<{ kept: number; removed: number }> {
  const list = await ctx.store.highlights.list({ refId: sourceId });
  if (!list.length || oldText === newText) return { kept: list.length, removed: 0 };
  const map = offsetMap(oldText, newText);
  let kept = 0;
  let removed = 0;
  for (const h of list) {
    const r = relocateRange(map, oldText, newText, h.start, h.end);
    if (!r) {
      await ctx.store.highlights.delete(h.id);
      removed++;
    } else {
      if (r.start !== h.start || r.end !== h.end) await ctx.store.highlights.update(h.id, r);
      kept++;
    }
  }
  return { kept, removed };
}

async function readOriginal(ctx: AppContext, sourceId: string): Promise<SavedOriginal | null> {
  const raw = await ctx.files.get(originalTextPath(sourceId));
  return raw ? (JSON.parse(new TextDecoder().decode(raw)) as SavedOriginal) : null;
}

async function replaceText(
  ctx: AppContext,
  src: Source,
  current: SavedOriginal,
  next: SavedOriginal,
  edited: boolean,
): Promise<TextEditResult> {
  const highlights = await remapHighlights(ctx, src.id, current.text, next.text);
  await ctx.store.contents.put({
    sourceId: src.id,
    notebookId: src.notebookId,
    text: next.text,
    pageOffsets: next.pageOffsets,
  });
  const props = { ...src.props };
  if (edited) props.edited = true;
  else delete props.edited;
  const source = (await ctx.store.sources.update(src.id, { props, charCount: next.text.length }))!;
  ctx.events.emit("source", source);
  const job = await ctx.jobs.enqueue(
    "ingest",
    { sourceId: src.id, reuseContent: true },
    { notebookId: src.notebookId, refId: src.id, message: `重建索引「${src.title}」` },
  );
  return { source, job, highlights };
}

async function loadEditable(ctx: AppContext, sourceId: string) {
  const src = await ctx.store.sources.get(sourceId);
  if (!src) throw notFound("资料");
  if (src.status !== "ready") throw new ApiError(409, "busy", "资料还在处理中，完成后再编辑");
  const content = await ctx.store.contents.get(sourceId);
  if (!content) throw badRequest("这份资料没有可编辑的文本");
  return { src, content };
}

export async function editSourceText(
  ctx: AppContext,
  sourceId: string,
  text: string,
): Promise<TextEditResult> {
  const { src, content } = await loadEditable(ctx, sourceId);
  const next = text.replace(/\r\n?/g, "\n");
  if (!next.trim()) throw badRequest("资料内容不能为空");
  if (next === content.text) {
    const all = await ctx.store.highlights.list({ refId: sourceId });
    return { source: src, job: null, highlights: { kept: all.length, removed: 0 } };
  }
  // 只保存第一次编辑前的版本：多次编辑后仍能恢复到最初的解析结果。
  if (!(await ctx.files.exists(originalTextPath(sourceId)))) {
    const saved: SavedOriginal = { text: content.text, pageOffsets: content.pageOffsets };
    await ctx.files.put(originalTextPath(sourceId), new TextEncoder().encode(JSON.stringify(saved)));
  }
  const pageOffsets = remapPageOffsets(offsetMap(content.text, next), content.pageOffsets);
  return replaceText(ctx, src, content, { text: next, pageOffsets }, true);
}

/** 恢复到第一次编辑前的原文（不重新解析原始文件，不调用模型）。 */
export async function revertSourceText(ctx: AppContext, sourceId: string): Promise<TextEditResult> {
  const { src, content } = await loadEditable(ctx, sourceId);
  const original = await readOriginal(ctx, sourceId);
  if (!original) throw badRequest("这份资料没有编辑过");
  const result = await replaceText(ctx, src, content, original, false);
  await ctx.files.delete(originalTextPath(sourceId));
  return result;
}
