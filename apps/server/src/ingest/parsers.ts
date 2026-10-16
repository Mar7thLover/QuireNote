/** 各类资料的解析：输出纯文本（Markdown 风格的标题）+ 页偏移。 */
import { Readability } from "@mozilla/readability";
import { strFromU8, unzipSync } from "fflate";
import { parseHTML } from "linkedom";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { joinPages } from "../chunking";
import { ApiError } from "../errors";

export interface ParsedDoc {
  text: string;
  pageOffsets: number[];
  pageCount: number | null;
  title?: string;
  /** 实际的 MIME（URL 导入时由响应决定）。 */
  mime?: string;
}

export function normalizeText(text: string): string {
  return text
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/^﻿/, "");
}

/** 纯文本 / Markdown。fixture 中的 \f 视为分页。 */
export function parsePlain(text: string, opts: { formFeedPages?: boolean } = {}): ParsedDoc {
  const t = text.replace(/\r\n?/g, "\n");
  if (opts.formFeedPages && t.includes("\f")) {
    const pages = t.split("\f").map((p) => normalizeText(p));
    const joined = joinPages(pages);
    return { ...joined, pageCount: pages.length };
  }
  return { text: normalizeText(t), pageOffsets: [0], pageCount: null };
}

export async function parsePdf(bytes: Uint8Array): Promise<ParsedDoc> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes));
  } catch (err) {
    throw new ApiError(
      400,
      "parse_failed",
      `无法解析 PDF：${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  let title: string | undefined;
  try {
    const meta = await pdf.getMetadata();
    const t = (meta.info as { Title?: string } | undefined)?.Title;
    if (t?.trim()) title = t.trim();
  } catch {
    /* 无元数据 */
  }
  const pages = text.map((p) => normalizeText(p));
  const joined = joinPages(pages);
  if (!joined.text.trim()) {
    throw new ApiError(
      400,
      "empty_text",
      "PDF 中没有可提取的文本（可能是扫描件，请先 OCR 或以图片形式导入）",
    );
  }
  return { ...joined, pageCount: totalPages, ...(title ? { title } : {}) };
}

export async function parseDocx(bytes: Uint8Array): Promise<ParsedDoc> {
  try {
    const res = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return { text: normalizeText(res.value), pageOffsets: [0], pageCount: null };
  } catch (err) {
    throw new ApiError(
      400,
      "parse_failed",
      `无法解析 DOCX：${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

const ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  middot: "·",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code =
        e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** HTML → 带段落与 Markdown 标题的纯文本（不依赖 DOM）。 */
export function htmlToText(html: string): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|head|noscript|svg|nav|footer)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, lvl: string, inner: string) => {
      const text = inner
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();
      return text ? `\n\n${"#".repeat(Math.min(3, Number(lvl)))} ${text}\n\n` : "";
    })
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|blockquote|ul|ol|table|tr|pre|figure|header|aside)>/gi, "\n\n")
    .replace(/<\/(td|th)>/gi, "\t")
    .replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  return normalizeText(
    s
      .split("\n")
      .map((l) => l.replace(/[ \t]+/g, " ").trim())
      .join("\n"),
  );
}

/** 网页正文提取：linkedom + Readability，失败时退回整页文本。 */
export function parseHtmlArticle(html: string, url?: string): ParsedDoc {
  let title: string | undefined;
  let text = "";
  try {
    const { document } = parseHTML(html);
    if (url) {
      try {
        const base = document.createElement("base");
        base.setAttribute("href", url);
        document.head?.appendChild(base);
      } catch {
        /* 忽略 */
      }
    }
    title = document.querySelector("title")?.textContent?.trim() || undefined;
    const article = new Readability(document as unknown as Document, { charThreshold: 100 }).parse();
    if (article) {
      title = article.title?.trim() || title;
      text = article.content ? htmlToText(article.content) : normalizeText(article.textContent ?? "");
    }
  } catch {
    /* Readability 失败：下面退回整页 */
  }
  if (text.replace(/\s/g, "").length < 50) {
    const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    title = title ?? (m ? decodeEntities(m[1]!.trim()) : undefined);
    const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
    text = htmlToText(body);
  }
  return { text, pageOffsets: [0], pageCount: null, ...(title ? { title } : {}) };
}

/** EPUB：解包 → container.xml → OPF → 按 spine 顺序提取章节文本。 */
export function parseEpub(bytes: Uint8Array): ParsedDoc {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new ApiError(400, "parse_failed", "无法解压 EPUB 文件");
  }
  const read = (p: string) => (files[p] ? strFromU8(files[p]!) : null);
  const container = read("META-INF/container.xml");
  const opfPath = container
    ? /full-path="([^"]+)"/.exec(container)?.[1]
    : Object.keys(files).find((f) => f.endsWith(".opf"));
  if (!opfPath) throw new ApiError(400, "parse_failed", "EPUB 中找不到 OPF 清单");
  const opf = read(opfPath);
  if (!opf) throw new ApiError(400, "parse_failed", "EPUB 的 OPF 清单为空");
  const dir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
  const manifest = new Map<string, string>();
  for (const m of opf.matchAll(/<item\b[^>]*>/g)) {
    const id = /\bid="([^"]+)"/.exec(m[0])?.[1];
    const href = /\bhref="([^"]+)"/.exec(m[0])?.[1];
    if (id && href) manifest.set(id, decodeURIComponent(href));
  }
  const spine = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/g)].map((m) => m[1]!);
  const title = /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/.exec(opf)?.[1]?.trim();
  const chapters: string[] = [];
  for (const id of spine) {
    const href = manifest.get(id);
    if (!href) continue;
    const xhtml = read(resolvePath(dir, href.split("#")[0]!));
    if (!xhtml) continue;
    let text = htmlToText(xhtml);
    const chapterTitle = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(xhtml)?.[1]?.trim();
    if (chapterTitle && !text.startsWith("#") && !text.startsWith(chapterTitle))
      text = `# ${decodeEntities(chapterTitle)}\n\n${text}`;
    if (text.trim()) chapters.push(text);
  }
  const text = normalizeText(chapters.join("\n\n"));
  if (!text) throw new ApiError(400, "empty_text", "EPUB 中没有可提取的文本");
  return { text, pageOffsets: [0], pageCount: null, ...(title ? { title: decodeEntities(title) } : {}) };
}

function resolvePath(dir: string, href: string): string {
  const parts = (dir + href).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p !== ".") out.push(p);
  }
  return out.join("/");
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 QuireNote/0.1";

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit = {},
  ms = 30_000,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetchImpl(url, { ...init, signal: ctrl.signal, redirect: "follow" });
  } catch (err) {
    throw new ApiError(
      400,
      "fetch_failed",
      `无法访问 ${url}：${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(t);
  }
}

/** 抓取网页（HTML / PDF / 纯文本），返回解析结果与原始字节。 */
export async function fetchUrl(
  url: string,
  fetchImpl: typeof fetch,
): Promise<{ doc: ParsedDoc; bytes: Uint8Array; mime: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ApiError(400, "bad_url", `URL 无效：${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    throw new ApiError(400, "bad_url", "只支持 http / https 链接");
  const res = await fetchWithTimeout(fetchImpl, url, {
    headers: {
      "user-agent": UA,
      accept: "text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.5",
    },
  });
  if (!res.ok) throw new ApiError(400, "fetch_failed", `抓取失败：HTTP ${res.status}`);
  const mime = res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "text/html";
  const bytes = new Uint8Array(await res.arrayBuffer());
  let doc: ParsedDoc;
  if (mime === "application/pdf" || url.toLowerCase().endsWith(".pdf")) doc = await parsePdf(bytes);
  else if (mime.startsWith("text/plain") || mime === "text/markdown") doc = parsePlain(decodeUtf8(bytes));
  else doc = parseHtmlArticle(decodeHtml(bytes, res.headers.get("content-type")), url);
  if (!doc.text.trim()) throw new ApiError(400, "empty_text", "网页中没有可提取的正文");
  return { doc: { ...doc, mime }, bytes, mime };
}

function decodeHtml(bytes: Uint8Array, contentType: string | null): string {
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 2048));
  const charset =
    /charset=([\w-]+)/i.exec(contentType ?? "")?.[1] ??
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ??
    "utf-8";
  try {
    return new TextDecoder(charset.toLowerCase()).decode(bytes);
  } catch {
    return decodeUtf8(bytes);
  }
}

// ───────────── YouTube 字幕 ─────────────

export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
    if (/(^|\.)youtube\.com$/.test(u.hostname) || /(^|\.)youtube-nocookie\.com$/.test(u.hostname)) {
      if (u.searchParams.get("v")) return u.searchParams.get("v");
      const m = /^\/(?:shorts|embed|live|v)\/([\w-]{6,})/.exec(u.pathname);
      if (m) return m[1]!;
    }
  } catch {
    /* 非 URL */
  }
  return /^[\w-]{11}$/.test(url) ? url : null;
}

interface CaptionTrack {
  baseUrl: string;
  languageCode?: string;
  kind?: string;
  name?: { simpleText?: string };
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** 解析 timedtext XML（<text start dur>）或 json3（events/segs）。 */
export function parseCaptions(body: string): { start: number; text: string }[] {
  const trimmed = body.trim();
  if (trimmed.startsWith("{")) {
    const j = JSON.parse(trimmed) as { events?: { tStartMs?: number; segs?: { utf8?: string }[] }[] };
    return (j.events ?? [])
      .filter((e) => e.segs?.length)
      .map((e) => ({
        start: (e.tStartMs ?? 0) / 1000,
        text: e
          .segs!.map((s) => s.utf8 ?? "")
          .join("")
          .trim(),
      }))
      .filter((l) => l.text);
  }
  const out: { start: number; text: string }[] = [];
  for (const m of trimmed.matchAll(/<(?:text|p)\b([^>]*)>([\s\S]*?)<\/(?:text|p)>/g)) {
    const attrs = m[1]!;
    const start = Number(
      /\bstart="([\d.]+)"/.exec(attrs)?.[1] ?? Number(/\bt="(\d+)"/.exec(attrs)?.[1] ?? 0) / 1000,
    );
    const text = decodeEntities(decodeEntities(m[2]!.replace(/<[^>]+>/g, "")))
      .replace(/\s+/g, " ")
      .trim();
    if (text) out.push({ start, text });
  }
  return out;
}

/** 字幕行 → 段落（约每 30 秒一段，段首带时间戳）。 */
export function captionsToText(lines: { start: number; text: string }[]): string {
  const paras: string[] = [];
  let cur: string[] = [];
  let curStart = 0;
  for (const l of lines) {
    if (!cur.length) curStart = l.start;
    cur.push(l.text);
    if (l.start - curStart >= 30) {
      paras.push(`[${formatTime(curStart)}] ${cur.join(" ")}`);
      cur = [];
    }
  }
  if (cur.length) paras.push(`[${formatTime(curStart)}] ${cur.join(" ")}`);
  return paras.join("\n\n");
}

export async function fetchYoutubeTranscript(url: string, fetchImpl: typeof fetch): Promise<ParsedDoc> {
  const id = youtubeId(url);
  if (!id) throw new ApiError(400, "bad_url", "不是有效的 YouTube 链接");
  const res = await fetchWithTimeout(fetchImpl, `https://www.youtube.com/watch?v=${id}&hl=zh-CN`, {
    headers: { "user-agent": UA, "accept-language": "zh-CN,zh;q=0.9,en;q=0.8" },
  });
  if (!res.ok) throw new ApiError(400, "fetch_failed", `无法打开 YouTube 页面：HTTP ${res.status}`);
  const html = await res.text();
  const titleMatch =
    /"title":"((?:[^"\\]|\\.)*)","lengthSeconds"/.exec(html) ?? /<title>([\s\S]*?)<\/title>/.exec(html);
  let title: string | undefined;
  if (titleMatch) {
    try {
      title = JSON.parse(`"${titleMatch[1]}"`) as string;
    } catch {
      title = decodeEntities(titleMatch[1]!);
    }
    title = title.replace(/\s*-\s*YouTube$/, "").trim();
  }
  const tracksMatch = /"captionTracks":(\[.*?\])/.exec(html);
  if (!tracksMatch) {
    throw new ApiError(
      400,
      "no_captions",
      "无法获取该视频的字幕：视频可能没有字幕、需要登录，或 YouTube 限制了访问",
    );
  }
  let tracks: CaptionTrack[];
  try {
    tracks = JSON.parse(tracksMatch[1]!) as CaptionTrack[];
  } catch {
    throw new ApiError(400, "no_captions", "无法解析 YouTube 字幕列表");
  }
  const pick =
    tracks.find((t) => t.languageCode?.startsWith("zh") && t.kind !== "asr") ??
    tracks.find((t) => t.languageCode?.startsWith("en") && t.kind !== "asr") ??
    tracks.find((t) => t.kind !== "asr") ??
    tracks[0];
  if (!pick?.baseUrl) throw new ApiError(400, "no_captions", "该视频没有可用的字幕轨");
  const capRes = await fetchWithTimeout(fetchImpl, pick.baseUrl.replace(/\\u0026/g, "&"), {
    headers: { "user-agent": UA },
  });
  const body = capRes.ok ? await capRes.text() : "";
  const lines = body ? parseCaptions(body) : [];
  if (!lines.length) throw new ApiError(400, "no_captions", "字幕内容为空（YouTube 可能要求登录或校验令牌）");
  return { text: captionsToText(lines), pageOffsets: [0], pageCount: null, ...(title ? { title } : {}) };
}
