import type { Context } from "hono";
import type { z } from "zod";
import { ApiError, badRequest } from "../errors";

/** Uint8Array → Response body（TS 的 BodyInit 要求 ArrayBuffer 支撑的视图）。 */
const body = (d: Uint8Array) => d as Uint8Array<ArrayBuffer>;

/** 解析并校验 JSON 请求体，错误统一为 400 validation_error。 */
export async function readJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    const text = await c.req.text();
    raw = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw badRequest("请求体不是合法 JSON", "invalid_json");
  }
  const r = schema.safeParse(raw);
  if (!r.success) {
    const msg = r.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "(body)"}: ${i.message}`)
      .join("; ");
    throw new ApiError(400, "validation_error", msg);
  }
  return r.data;
}

export function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new ApiError(404, "not_found", `${what}不存在`);
  return value;
}

/** 下载文件名：去掉文件系统不允许的字符，最长 80 字。 */
export function safeFilename(name: string, ext: string): string {
  const base =
    name
      .replace(/[\\/:*?"<>|\r\n]+/g, " ")
      .trim()
      .slice(0, 80) || "card";
  return `${base}${ext}`;
}

/** 下载响应（zip / 原始文件）。 */
export function download(data: Uint8Array, filename: string, mime: string, inline = false): Response {
  return new Response(body(data), {
    headers: {
      "content-type": mime,
      "content-length": String(data.byteLength),
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      // 原始文件（例如抓取的网页 HTML）在 API 源下直接打开时禁止执行脚本。
      "content-security-policy":
        "sandbox; default-src 'none'; img-src * data:; style-src * 'unsafe-inline'; media-src *",
    },
  });
}

/** 支持 Range 的文件响应（音视频可拖动进度）。 */
export function fileResponse(c: Context, data: Uint8Array, mime: string): Response {
  const range = c.req.header("range");
  const size = data.byteLength;
  const base: Record<string, string> = {
    "content-type": mime,
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=3600",
    // 生成的 SVG 已清洗过；直接打开时再禁掉脚本与外链，作为第二道保险。
    ...(mime.startsWith("image/svg")
      ? { "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" }
      : {}),
  };
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { ...base, "content-range": `bytes */${size}` } });
    }
    return new Response(body(data.subarray(start, end + 1)), {
      status: 206,
      headers: {
        ...base,
        "content-range": `bytes ${start}-${end}/${size}`,
        "content-length": String(end - start + 1),
      },
    });
  }
  return new Response(body(data), { headers: { ...base, "content-length": String(size) } });
}

/** 从 multipart 中取出上传文件。 */
export async function readUpload(
  c: Context,
  field = "file",
): Promise<{ file: File; form: Record<string, unknown> }> {
  let form: Record<string, unknown>;
  try {
    form = (await c.req.parseBody({ all: true })) as Record<string, unknown>;
  } catch {
    throw badRequest("无法解析 multipart 表单");
  }
  const v = form[field];
  const file = Array.isArray(v) ? v.find((x) => x instanceof File) : v;
  if (!(file instanceof File)) throw badRequest(`缺少上传文件字段 ${field}`);
  return { file: file as File, form };
}
