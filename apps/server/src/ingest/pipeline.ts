/** 资料处理流水线：解析 → 保存全文 → 分块 → Embedding → 摘要。 */
import {
  describeImage,
  embeddingKey,
  embedTexts,
  extractiveSummary,
  summarizeText,
  transcribeAudio,
} from "@quirenote/ai";
import { type Chunk, newId, nowIso, type Source } from "@quirenote/core";
import { chunkText } from "../chunking";
import type { AppContext } from "../context";
import { ApiError, errorMessageOf } from "../errors";
import { originalTextPath, remapHighlights } from "../services/source-edit";
import {
  decodeUtf8,
  fetchUrl,
  fetchYoutubeTranscript,
  type ParsedDoc,
  parseDocx,
  parseEpub,
  parsePdf,
  parsePlain,
} from "./parsers";

export async function emitSource(ctx: AppContext, id: string): Promise<Source | null> {
  const s = await ctx.store.sources.get(id);
  if (s) ctx.events.emit("source", s);
  return s;
}

/** 原始文件在文件存储中的目录。 */
export const sourceFileDir = (sourceId: string) => `sources/${sourceId}`;

export async function sourceFile(
  ctx: AppContext,
  sourceId: string,
): Promise<{ path: string; data: Uint8Array } | null> {
  const [path] = await ctx.files.list(sourceFileDir(sourceId));
  if (!path) return null;
  const data = await ctx.files.get(path);
  return data ? { path, data } : null;
}

function formatSeconds(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** 按资料类型解析出全文。 */
async function parseSource(ctx: AppContext, src: Source): Promise<ParsedDoc> {
  switch (src.kind) {
    case "url": {
      if (!src.url) throw new ApiError(400, "bad_url", "缺少 URL");
      const { doc, bytes, mime } = await fetchUrl(src.url, ctx.fetch);
      const ext = mime === "application/pdf" ? "pdf" : mime.startsWith("text/plain") ? "txt" : "html";
      await ctx.files.put(`${sourceFileDir(src.id)}/page.${ext}`, bytes);
      return { ...doc, mime };
    }
    case "youtube": {
      if (!src.url) throw new ApiError(400, "bad_url", "缺少 YouTube 链接");
      return fetchYoutubeTranscript(src.url, ctx.fetch);
    }
    default:
      break;
  }
  const file = await sourceFile(ctx, src.id);
  if (!file) {
    // 文本类资料（text / markdown / search）在创建时已写入 contents。
    const content = await ctx.store.contents.get(src.id);
    if (content) return { text: content.text, pageOffsets: content.pageOffsets, pageCount: src.pageCount };
    throw new ApiError(400, "missing_file", "找不到资料的原始文件");
  }
  const bytes = file.data;
  switch (src.kind) {
    case "pdf":
      return parsePdf(bytes);
    case "docx":
      return parseDocx(bytes);
    case "epub":
      return parseEpub(bytes);
    case "text":
    case "markdown":
    case "search":
      return parsePlain(decodeUtf8(bytes));
    case "image": {
      const chat = await ctx.models.chat();
      const text = await describeImage(chat, {
        image: bytes,
        mediaType: src.mime ?? "image/png",
        prompt:
          "提取图片中的全部文字（OCR），保持原有段落与标题层级，用 Markdown 输出。如果图片中没有文字，请详细描述图片内容。只输出结果，不要解释。",
      });
      return parsePlain(text);
    }
    case "audio":
    case "video": {
      const stt = await ctx.models.require("stt", "音视频转写");
      const res = await transcribeAudio(stt, bytes);
      let text = res.text;
      if (res.segments.length) {
        // 约每 30 秒一段，段首带时间戳，便于回看。
        const paras: string[] = [];
        let cur: string[] = [];
        let start = res.segments[0]!.start;
        for (const s of res.segments) {
          if (!cur.length) start = s.start;
          cur.push(s.text.trim());
          if (s.end - start >= 30) {
            paras.push(`[${formatSeconds(start)}] ${cur.join(" ")}`);
            cur = [];
          }
        }
        if (cur.length) paras.push(`[${formatSeconds(start)}] ${cur.join(" ")}`);
        text = paras.join("\n\n");
      }
      return parsePlain(text);
    }
    default:
      throw new ApiError(400, "unsupported", `不支持的资料类型：${src.kind}`);
  }
}

/** 为缺少当前模型向量的分块补 Embedding。返回处理的分块数。 */
export async function embedMissing(
  ctx: AppContext,
  filter: { notebookId?: string; sourceId?: string },
  onProgress?: (done: number, total: number) => Promise<void> | void,
): Promise<number> {
  const ref = await ctx.models.embedding();
  // 未配置 Embedding：不生成向量，检索只用关键词。
  if (!ref) return 0;
  const key = embeddingKey(ref);
  const missing = await ctx.store.chunks.missingEmbeddings(key, filter);
  const batch = 32;
  for (let i = 0; i < missing.length; i += batch) {
    const part = missing.slice(i, i + batch);
    const vectors = await embedTexts(
      ref,
      part.map((c) => embedInput(c)),
    );
    await ctx.store.chunks.upsertEmbeddings(
      key,
      part.map((c, j) => ({ chunkId: c.id, notebookId: c.notebookId, vector: vectors[j]! })),
    );
    await onProgress?.(Math.min(missing.length, i + batch), missing.length);
  }
  return missing.length;
}

/** 送去 Embedding 的文本：带上所属标题，提升检索效果。 */
export function embedInput(c: Chunk): string {
  return c.heading && !c.text.startsWith("#") ? `${c.heading}\n${c.text}` : c.text;
}

export interface ProcessOptions {
  /** 跳过解析，直接用已保存的全文重新分块（导入 / 重建时）。 */
  reuseContent?: boolean;
  progress?: (p: number, message: string) => Promise<void>;
  /** 不调用对话模型，直接用抽取式摘要（种子数据）。 */
  extractiveSummary?: boolean;
}

export async function processSource(
  ctx: AppContext,
  sourceId: string,
  opts: ProcessOptions = {},
): Promise<Source> {
  const { store } = ctx;
  const progress = opts.progress ?? (async () => {});
  const src = await store.sources.get(sourceId);
  if (!src) throw new ApiError(404, "not_found", "资料不存在");
  await store.sources.update(sourceId, { status: "processing", error: null });
  await emitSource(ctx, sourceId);
  try {
    await progress(0.05, "解析中");
    let doc: ParsedDoc;
    const previous = await store.contents.get(sourceId);
    const existing = opts.reuseContent ? previous : null;
    if (existing) doc = { text: existing.text, pageOffsets: existing.pageOffsets, pageCount: src.pageCount };
    else doc = await parseSource(ctx, src);
    if (!doc.text.trim()) throw new ApiError(400, "empty_text", "未能从资料中提取到文本");
    if (!existing && previous) {
      // 重新解析：高亮跟着文本走；手动编辑过的内容被解析结果取代，不再保留编辑前的原文。
      await remapHighlights(ctx, sourceId, previous.text, doc.text);
      await ctx.files.delete(originalTextPath(sourceId));
      if (src.props.edited) {
        const props = { ...src.props };
        delete props.edited;
        await store.sources.update(sourceId, { props });
      }
    }

    await store.contents.put({
      sourceId,
      notebookId: src.notebookId,
      text: doc.text,
      pageOffsets: doc.pageOffsets,
    });
    await progress(0.3, "分块中");
    await store.chunks.deleteBySource(sourceId);
    const paged = doc.pageOffsets.length > 1 || src.kind === "pdf";
    const drafts = chunkText(doc.text, doc.pageOffsets, { paged });
    const chunks: Chunk[] = drafts.map((d) => ({
      id: newId("ch"),
      sourceId,
      notebookId: src.notebookId,
      index: d.index,
      text: d.text,
      start: d.start,
      end: d.end,
      page: d.page,
      heading: d.heading,
    }));
    await store.chunks.insertMany(chunks);

    await progress(0.4, `Embedding 0/${chunks.length}`);
    await embedMissing(ctx, { sourceId }, (done, total) =>
      progress(0.4 + 0.45 * (done / Math.max(1, total)), `Embedding ${done}/${total}`),
    );

    await progress(0.9, "生成摘要");
    let summary = "";
    try {
      summary = opts.extractiveSummary
        ? extractiveSummary(doc.text, 2)
        : (await summarizeText(await ctx.models.chat(), doc.text, src.title)).trim();
    } catch {
      // 未配置对话模型或调用失败时退回抽取式摘要。
      summary = extractiveSummary(doc.text, 2);
    }
    const titleIsPlaceholder = !src.title.trim() || src.title === src.url || src.props?.autoTitle === true;
    const patch: Partial<Source> = {
      status: "ready",
      error: null,
      charCount: doc.text.length,
      pageCount: doc.pageCount ?? (doc.pageOffsets.length > 1 ? doc.pageOffsets.length : null),
      summary,
      hasFile: !!(await sourceFile(ctx, sourceId)),
      updatedAt: nowIso(),
      ...(doc.mime ? { mime: doc.mime } : {}),
    };
    if (titleIsPlaceholder && doc.title) {
      patch.title = doc.title.slice(0, 200);
      const { autoTitle: _a, ...rest } = src.props ?? {};
      patch.props = rest;
    }
    await store.sources.update(sourceId, patch);
    return (await emitSource(ctx, sourceId))!;
  } catch (err) {
    await store.sources.update(sourceId, { status: "error", error: errorMessageOf(err).slice(0, 500) });
    await emitSource(ctx, sourceId);
    throw err;
  }
}

/** 删除资料及其分块、向量、全文、高亮与原始文件。 */
export async function deleteSourceCascade(ctx: AppContext, sourceId: string): Promise<void> {
  await ctx.store.chunks.deleteBySource(sourceId);
  await ctx.store.contents.delete(sourceId);
  await ctx.store.highlights.deleteWhere({ refId: sourceId });
  await ctx.files.deletePrefix(sourceFileDir(sourceId));
  await ctx.files.delete(originalTextPath(sourceId));
  await ctx.store.sources.delete(sourceId);
}
