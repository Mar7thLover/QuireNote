import { generateText } from "ai";
import { requestJson } from "./http";
import { aiText } from "./messages";
import { anthropicTools, baseUrlOf, errorMessage, languageModel, requireKey } from "./sdk";
import { AiError, type ModelRef, type SearchResult, UnsupportedError } from "./types";
import { reportUsage } from "./usage";

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
    case "anthropic":
      return claudeSearch(ref, query, max, opts.withContent ?? false);
    default:
      throw new UnsupportedError(aiText().noSearch(p.kind));
  }
}

/** 从模型输出里取出第一个 JSON 数组（模型偶尔会在前后加说明文字或代码围栏）。 */
function parseJsonArray(text: string): unknown[] | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Claude 联网搜索：服务端 web_search 工具检索，Claude 再把每个结果整理成可引用的摘要。
 * 搜索结果的正文是加密的，只能由 Claude 读取，所以摘要由 Claude 写；URL 只保留真实搜到的。
 */
async function claudeSearch(
  ref: ModelRef,
  query: string,
  max: number,
  withContent: boolean,
): Promise<SearchResult[]> {
  const tools = anthropicTools(ref.provider);
  // 动态过滤版只支持 Sonnet / Opus；Haiku 用基础版。
  const webSearch = /haiku/i.test(ref.model)
    ? tools.webSearch_20250305({ maxUses: 3 })
    : tools.webSearch_20260209({ maxUses: 3 });
  const length = withContent ? "6–10 sentences" : "2–4 sentences";
  const run = () =>
    generateText({
      model: languageModel(ref.provider, ref.model),
      tools: { web_search: webSearch },
      instructions: [
        "You are the web search backend of a research notebook.",
        "Search the web for the user's query, then reply with ONLY a JSON array, no prose and no code fences.",
        `Each item: {"url": string, "title": string, "snippet": string}. At most ${max} items, most relevant first.`,
        `"snippet" is ${length} of concrete facts that page states about the query, written in the page's own language. Never invent URLs; only use pages returned by the search tool.`,
      ].join("\n"),
      prompt: query,
      providerOptions: { anthropic: { effort: "low" } },
      maxRetries: 1,
    });
  let result: Awaited<ReturnType<typeof run>>;
  try {
    result = await run();
  } catch (err) {
    throw new AiError(aiText().searchFailed(errorMessage(err)));
  }

  // 真实搜到的页面（工具结果），用来校验和兜底。
  const found = new Map<string, { url: string; title: string }>();
  let searches = 0;
  for (const step of result.steps) {
    for (const part of step.content) {
      if (part.type === "tool-call" && part.toolName === "web_search") searches++;
      if (part.type === "tool-result" && part.toolName === "web_search" && Array.isArray(part.output)) {
        for (const r of part.output as { url?: string; title?: string | null }[]) {
          if (r.url && !found.has(r.url)) found.set(r.url, { url: r.url, title: r.title || r.url });
        }
      }
    }
  }
  for (const s of result.sources) {
    if (s.sourceType === "url" && !found.has(s.url))
      found.set(s.url, { url: s.url, title: s.title || s.url });
  }
  reportUsage(ref, "search", result.totalUsage, searches);

  const items = (parseJsonArray(result.text) ?? []).flatMap((v) => {
    const o = v as { url?: unknown; title?: unknown; snippet?: unknown };
    if (typeof o.url !== "string" || typeof o.snippet !== "string") return [];
    if (found.size && !found.has(o.url)) return [];
    const title =
      typeof o.title === "string" && o.title.trim() ? o.title : (found.get(o.url)?.title ?? o.url);
    return [{ url: o.url, title, snippet: o.snippet.trim() }];
  });
  const out: SearchResult[] = items.slice(0, max);
  // 模型没写摘要的页面也带上（只有标题），深度研究会再抓取正文。
  for (const f of found.values()) {
    if (out.length >= max) break;
    if (!out.some((o) => o.url === f.url)) out.push({ title: f.title, url: f.url, snippet: "" });
  }
  // 不填 content：深度研究会抓取页面全文，抓不到时退回这里的摘要。
  return out;
}
