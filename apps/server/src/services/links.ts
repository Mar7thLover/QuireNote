/** 链接预览：抓取网页的标题、描述、缩略图，按 URL 缓存。笔记里单独一行的网址渲染成预览卡片。 */
import { createHash } from "node:crypto";
import { nowIso } from "@quirenote/core";
import type { AppContext } from "../context";
import { badRequest } from "../errors";
import { decodeHtml, fetchWithTimeout, UA } from "../ingest/parsers";
import type { LinkPreview } from "../store/types";

const MAX_HTML = 1024 * 1024;
/** 缓存一周后重新抓取。 */
const TTL_MS = 7 * 24 * 3600 * 1000;

const decodeEntities = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));

/** 从 HTML 头部取 og / twitter / title / description。 */
export function parsePreview(html: string, url: string): Omit<LinkPreview, "id" | "createdAt" | "updatedAt"> {
  const head = html.slice(0, 200_000);
  const meta = (names: string[]) => {
    for (const n of names) {
      const re = new RegExp(
        `<meta[^>]+(?:property|name)=["']${n}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${n}["']`,
        "i",
      );
      const m = re.exec(head);
      const v = (m?.[1] ?? m?.[2] ?? "").trim();
      if (v) return decodeEntities(v);
    }
    return "";
  };
  const title =
    meta(["og:title", "twitter:title"]) ||
    decodeEntities(/<title[^>]*>([^<]*)<\/title>/i.exec(head)?.[1]?.trim() ?? "");
  let image = meta(["og:image", "og:image:url", "twitter:image"]);
  if (image) {
    try {
      image = new URL(image, url).href;
      if (!/^https?:/.test(image)) image = "";
    } catch {
      image = "";
    }
  }
  const host = new URL(url).hostname.replace(/^www\./, "");
  return {
    url,
    title: title.slice(0, 300) || host,
    description: meta(["og:description", "description", "twitter:description"]).slice(0, 500),
    image: image || null,
    site: meta(["og:site_name"]).slice(0, 100) || host,
  };
}

export async function linkPreview(ctx: AppContext, url: string): Promise<LinkPreview> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw badRequest("网址无效");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    throw badRequest("只支持 http / https 链接");
  const id = createHash("sha256").update(parsed.href).digest("hex").slice(0, 32);
  const cached = await ctx.store.linkPreviews.get(id);
  if (cached && Date.now() - Date.parse(cached.updatedAt) < TTL_MS) return cached;
  const ts = nowIso();
  let info: Omit<LinkPreview, "id" | "createdAt" | "updatedAt">;
  try {
    const res = await fetchWithTimeout(
      ctx.fetch,
      parsed.href,
      { headers: { "user-agent": UA, accept: "text/html" } },
      8000,
    );
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !/html/i.test(type)) throw new Error("not html");
    const buf = new Uint8Array(await res.arrayBuffer()).subarray(0, MAX_HTML);
    info = parsePreview(decodeHtml(buf, type), res.url || parsed.href);
    info.url = parsed.href;
  } catch {
    // 抓不到时只显示域名，不报错：链接本身仍然可以点。
    const host = parsed.hostname.replace(/^www\./, "");
    info = { url: parsed.href, title: host, description: "", image: null, site: host };
  }
  const rec: LinkPreview = { id, ...info, createdAt: cached?.createdAt ?? ts, updatedAt: ts };
  if (cached) await ctx.store.linkPreviews.update(id, rec);
  else await ctx.store.linkPreviews.insert(rec);
  return rec;
}
