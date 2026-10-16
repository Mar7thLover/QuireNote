/** 资料的创建（上传 / URL / 文本 / YouTube / 搜索结果）与删除。 */
import { newId, nowIso, type Source, type SourceKind } from "@quirenote/core";
import type { AppContext } from "../context";
import { badRequest } from "../errors";
import { mimeFromName, safeName } from "../files";
import { youtubeId } from "../ingest/parsers";
import { sourceFileDir } from "../ingest/pipeline";

const EXT_KIND: Record<string, SourceKind> = {
  pdf: "pdf",
  docx: "docx",
  md: "markdown",
  markdown: "markdown",
  txt: "text",
  text: "text",
  epub: "epub",
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  gif: "image",
  mp3: "audio",
  wav: "audio",
  m4a: "audio",
  ogg: "audio",
  flac: "audio",
  aac: "audio",
  mp4: "video",
  mov: "video",
  webm: "video",
  mkv: "video",
};

export function kindFromFile(name: string, mime: string): SourceKind | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (EXT_KIND[ext]) return EXT_KIND[ext]!;
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime === "text/markdown") return "markdown";
  if (mime.startsWith("text/plain")) return "text";
  if (mime === "application/epub+zip") return "epub";
  if (mime.includes("wordprocessingml")) return "docx";
  return null;
}

function baseSource(
  ctx: AppContext,
  notebookId: string,
  partial: Partial<Source> & Pick<Source, "kind" | "title">,
): Source {
  const ts = nowIso();
  return {
    id: newId("src"),
    ownerId: ctx.store.ownerId,
    notebookId,
    status: "pending",
    error: null,
    selected: true,
    url: null,
    mime: null,
    size: 0,
    pageCount: null,
    charCount: 0,
    summary: "",
    hasFile: false,
    props: {},
    createdAt: ts,
    updatedAt: ts,
    ...partial,
  };
}

async function enqueueIngest(ctx: AppContext, src: Source): Promise<Source> {
  await ctx.store.sources.insert(src);
  ctx.events.emit("source", src);
  await ctx.jobs.enqueue(
    "ingest",
    { sourceId: src.id },
    { notebookId: src.notebookId, refId: src.id, message: `解析「${src.title}」` },
  );
  return src;
}

export async function createFileSource(
  ctx: AppContext,
  notebookId: string,
  file: File,
  title?: string,
): Promise<Source> {
  const name = safeName(file.name || "upload");
  const mime = file.type || mimeFromName(name);
  const kind = kindFromFile(name, mime);
  if (!kind) throw badRequest(`不支持的文件类型：${name}`, "unsupported_type");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.length) throw badRequest("文件为空");
  const src = baseSource(ctx, notebookId, {
    kind,
    title: title?.trim() || name.replace(/\.[^.]+$/, "") || name,
    mime,
    size: bytes.length,
    hasFile: true,
  });
  await ctx.files.put(`${sourceFileDir(src.id)}/${name}`, bytes);
  return enqueueIngest(ctx, src);
}

export interface JsonSourceInput {
  kind: "url" | "text" | "markdown" | "youtube" | "search";
  url?: string;
  title?: string;
  text?: string;
}

export async function createJsonSource(
  ctx: AppContext,
  notebookId: string,
  body: JsonSourceInput,
): Promise<Source> {
  switch (body.kind) {
    case "url": {
      const url = body.url?.trim();
      if (!url || !/^https?:\/\//i.test(url)) throw badRequest("请提供 http(s) 链接");
      if (youtubeId(url) && /youtu/.test(url))
        return createJsonSource(ctx, notebookId, { ...body, kind: "youtube" });
      return enqueueIngest(
        ctx,
        baseSource(ctx, notebookId, {
          kind: "url",
          title: body.title?.trim() || url,
          url,
          props: body.title?.trim() ? {} : { autoTitle: true },
        }),
      );
    }
    case "youtube": {
      const url = body.url?.trim();
      if (!url || !youtubeId(url)) throw badRequest("不是有效的 YouTube 链接");
      return enqueueIngest(
        ctx,
        baseSource(ctx, notebookId, {
          kind: "youtube",
          title: body.title?.trim() || url,
          url,
          mime: "text/plain",
          props: body.title?.trim() ? {} : { autoTitle: true },
        }),
      );
    }
    case "text":
    case "markdown":
    case "search": {
      const text = body.text ?? "";
      if (!text.trim()) throw badRequest("text 不能为空");
      const ext = body.kind === "text" ? "txt" : "md";
      const bytes = new TextEncoder().encode(text);
      const src = baseSource(ctx, notebookId, {
        kind: body.kind,
        title:
          body.title?.trim() ||
          text
            .trim()
            .split("\n")[0]!
            .replace(/^#+\s*/, "")
            .slice(0, 60) ||
          "未命名",
        url: body.url?.trim() || null,
        mime: ext === "txt" ? "text/plain" : "text/markdown",
        size: bytes.length,
        hasFile: true,
      });
      await ctx.files.put(`${sourceFileDir(src.id)}/content.${ext}`, bytes);
      return enqueueIngest(ctx, src);
    }
    default:
      throw badRequest("kind 必须是 url / text / markdown / youtube / search");
  }
}
