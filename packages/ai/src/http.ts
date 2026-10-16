import { AiError, type ProviderRuntime } from "./types";

export function fetchOf(p: ProviderRuntime): typeof fetch {
  return p.fetch ?? globalThis.fetch;
}

/** 合并用户自定义请求头（同名时覆盖调用方给的头）。 */
function withExtraHeaders(p: ProviderRuntime, headers: HeadersInit | undefined): HeadersInit | undefined {
  if (!p.headers || !Object.keys(p.headers).length) return headers;
  const merged = new Headers(headers);
  for (const [k, v] of Object.entries(p.headers)) merged.set(k, v);
  return merged;
}

async function errorText(res: Response): Promise<string> {
  const body = await res.text().catch(() => "");
  try {
    const j = JSON.parse(body) as Record<string, unknown>;
    const e = j.error ?? j.detail ?? j.message;
    if (typeof e === "string") return e;
    if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  } catch {
    /* 非 JSON */
  }
  return body.slice(0, 300);
}

export async function request(
  p: ProviderRuntime,
  url: string,
  init: RequestInit = {},
  timeoutMs = 60_000,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchOf(p)(url, {
      ...init,
      headers: withExtraHeaders(p, init.headers),
      signal: init.signal ?? ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    throw new AiError(`无法连接 ${new URL(url).host}：${msg}`, "network");
  }
  clearTimeout(timer);
  if (!res.ok) {
    throw new AiError(
      `HTTP ${res.status}：${(await errorText(res)) || res.statusText}`,
      "http_error",
      res.status >= 500 ? 502 : 400,
    );
  }
  return res;
}

export async function requestJson<T>(
  p: ProviderRuntime,
  url: string,
  init: RequestInit = {},
  timeoutMs?: number,
): Promise<T> {
  const res = await request(p, url, init, timeoutMs);
  try {
    return (await res.json()) as T;
  } catch {
    throw new AiError(`响应不是合法 JSON：${url}`, "bad_response");
  }
}

export async function requestBytes(
  p: ProviderRuntime,
  url: string,
  init: RequestInit = {},
  timeoutMs?: number,
): Promise<{ data: Uint8Array; mediaType: string }> {
  const res = await request(p, url, init, timeoutMs);
  const buf = new Uint8Array(await res.arrayBuffer());
  return {
    data: buf,
    mediaType: res.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream",
  };
}

export function jsonInit(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}
