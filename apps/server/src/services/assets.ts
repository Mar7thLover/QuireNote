/**
 * 笔记里的资源（图片、视频、音频、字体）。文件存在 assets/<id>，id 带扩展名（ast_xxx.png），
 * 正文用 `asset://<id>` 引用。类型按文件头识别，不信任扩展名和上传方给的 MIME。
 */
import { createHash } from "node:crypto";
import { sanitizeSvg } from "@quirenote/ai";
import { type Asset, newId, nowIso } from "@quirenote/core";
import type { AppContext } from "../context";
import { badRequest } from "../errors";

export const ASSET_DIR = "assets";
export const ASSET_MAX_BYTES = 50 * 1024 * 1024;

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  woff2: "font/woff2",
};

export function assetMime(id: string): string {
  return MIME[id.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

const ascii = (b: Uint8Array, start: number, len: number) =>
  String.fromCharCode(...b.subarray(start, start + len));

/** 按文件头判断类型，返回扩展名；不认识的返回 null。 */
export function sniffAsset(b: Uint8Array, nameHint = ""): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG") return "png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (ascii(b, 0, 4) === "GIF8") return "gif";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "webp";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WAVE") return "wav";
  if (ascii(b, 4, 4) === "ftyp") {
    const brand = ascii(b, 8, 4);
    if (/^avi[fs]/.test(brand)) return "avif";
    if (/^(M4A |M4B )/.test(brand)) return "m4a";
    if (brand === "qt  ") return "mov";
    return /\.m4a$/i.test(nameHint) ? "m4a" : "mp4";
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "webm";
  if (ascii(b, 0, 3) === "ID3" || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0)) return "mp3";
  if (ascii(b, 0, 4) === "OggS") return "ogg";
  if (ascii(b, 0, 4) === "fLaC") return "flac";
  if (ascii(b, 0, 4) === "wOF2") return "woff2";
  const head = new TextDecoder().decode(b.subarray(0, 512)).trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "svg";
  return null;
}

/** 保存一个资源；同一 Notebook 里内容相同的文件只存一份。 */
export async function saveAsset(
  ctx: AppContext,
  notebookId: string,
  input: Uint8Array,
  name: string,
): Promise<Asset> {
  if (input.byteLength > ASSET_MAX_BYTES) throw badRequest("资源超过 50 MB");
  const ext = sniffAsset(input, name);
  if (!ext) throw badRequest("不支持的文件类型：只接受图片、mp4 / webm / mov 视频、常见音频和 woff2 字体");
  let data = input;
  if (ext === "svg") {
    const clean = sanitizeSvg(new TextDecoder().decode(input));
    if (!clean) throw badRequest("SVG 内容无效");
    data = new TextEncoder().encode(clean);
  }
  const sha256 = createHash("sha256").update(data).digest("hex");
  const existing = (await ctx.store.assets.list({ notebookId })).find((a) => a.sha256 === sha256);
  if (existing) return existing;
  const asset: Asset = {
    id: `${newId("ast")}.${ext}`,
    notebookId,
    name: (name || `asset.${ext}`).slice(0, 200),
    mime: MIME[ext]!,
    size: data.byteLength,
    sha256,
    createdAt: nowIso(),
  };
  await ctx.files.put(`${ASSET_DIR}/${asset.id}`, data);
  await ctx.store.assets.insert({ ...asset, updatedAt: asset.createdAt } as Asset);
  return asset;
}

export async function readAsset(
  ctx: AppContext,
  id: string,
): Promise<{ asset: Asset; data: Uint8Array } | null> {
  if (!/^[A-Za-z0-9_-]+\.[a-z0-9]+$/.test(id)) return null;
  const asset = await ctx.store.assets.get(id);
  if (!asset) return null;
  const data = await ctx.files.get(`${ASSET_DIR}/${id}`);
  return data ? { asset, data } : null;
}

export async function deleteNotebookAssets(ctx: AppContext, notebookId: string): Promise<void> {
  for (const a of await ctx.store.assets.list({ notebookId })) await ctx.files.delete(`${ASSET_DIR}/${a.id}`);
  await ctx.store.assets.deleteWhere({ notebookId });
}

/** 正文里引用到的资源 id。 */
export function assetIdsIn(markdown: string): string[] {
  return [...new Set([...markdown.matchAll(/asset:\/\/([A-Za-z0-9_.-]+)/g)].map((m) => m[1]!))];
}
