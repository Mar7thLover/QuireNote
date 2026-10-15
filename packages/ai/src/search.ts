import { requestJson } from "./http";
import { baseUrlOf, requireKey } from "./sdk";
import { type ModelRef, type SearchResult, UnsupportedError } from "./types";

export interface SearchOptions {
  maxResults?: number;
  /** 需要正文（Tavily 可直接返回；其他后端只有摘要）。 */
  withContent?: boolean;
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'");
}

export async function webSearch(
  ref: ModelRef,
  query: string,
  opts: SearchOptions = {},
): Promise<SearchResult[]> {
  const p = ref.provider;
  const max = opts.maxResults ?? 8;
  switch (p.kind) {
    case "tavily": {
      const data = await requestJson<{
        results?: { title?: string; url: string; content?: string; raw_content?: string | null }[];
      }>(p, `${baseUrlOf(p)}/search`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${requireKey(p)}` },
        body: JSON.stringify({
          query,
          max_results: max,
          search_depth: ref.model === "advanced" ? "advanced" : "basic",
          include_raw_content: opts.withContent ?? false,
          include_answer: false,
        }),
      });
      return (data.results ?? []).map((r) => ({
        title: r.title ?? r.url,
        url: r.url,
        snippet: r.content ?? "",
        ...(r.raw_content ? { content: r.raw_content } : {}),
      }));
    }
    case "brave": {
      const url = `${baseUrlOf(p)}/web/search?q=${encodeURIComponent(query)}&count=${Math.min(max, 20)}`;
      const data = await requestJson<{
        web?: { results?: { title: string; url: string; description?: string; extra_snippets?: string[] }[] };
      }>(p, url, { headers: { accept: "application/json", "x-subscription-token": requireKey(p) } });
      return (data.web?.results ?? []).slice(0, max).map((r) => ({
        title: stripTags(r.title),
        url: r.url,
        snippet: stripTags([r.description ?? "", ...(r.extra_snippets ?? [])].join(" ").trim()),
      }));
    }
    case "searxng": {
      const cat = ref.model && ref.model !== "default" ? `&categories=${encodeURIComponent(ref.model)}` : "";
      const url = `${baseUrlOf(p)}/search?q=${encodeURIComponent(query)}&format=json${cat}`;
      const headers: Record<string, string> = { accept: "application/json" };
      if (p.apiKey) headers.authorization = `Bearer ${p.apiKey}`;
      const data = await requestJson<{ results?: { title: string; url: string; content?: string }[] }>(
        p,
        url,
        {
          headers,
        },
      );
      return (data.results ?? [])
        .slice(0, max)
        .map((r) => ({ title: r.title, url: r.url, snippet: r.content ?? "" }));
    }
    default:
      throw new UnsupportedError(`provider 类型 ${p.kind} 不支持联网搜索`);
  }
}
