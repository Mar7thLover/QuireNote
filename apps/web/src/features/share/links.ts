/** 分享链接的地址：设置里填的公开地址优先，否则用应用连接的服务器或当前页面的地址。 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { qk } from "@/lib/query";

export const SHARE_BASE_KEY = "shareBaseUrl";

/** 没有设置公开地址时：外部壳（Capacitor）连接的服务器，或者当前页面。 */
export function defaultShareBase(): string {
  try {
    const override = localStorage.getItem("quirenote.server");
    if (override) return new URL(override).origin;
  } catch {}
  return window.location.origin;
}

/** 规整用户填的地址：只接受 http(s)，去掉末尾的斜杠、查询和锚点；空串表示清除。无效时返回 null。 */
export function normalizeShareBase(value: string): string | null {
  const v = value.trim();
  if (!v) return "";
  try {
    const u = new URL(v);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

export const shareUrl = (base: string, path: string) => `${base.replace(/\/+$/, "")}${path}`;

/** 只有本机或局域网才能打开的地址（发给别人也打不开）。 */
export function isPrivateAddress(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return true;
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "::1" || host === "0.0.0.0") return true;
  // IPv6 链路本地与唯一本地地址
  if (host.includes(":") && /^(fe80|f[cd][0-9a-f]{2}):/.test(host)) return true;
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 127 ||
    a === 10 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 169 && b === 254)
  );
}

/** 当前生效的分享地址与是否来自设置。 */
export function useShareBase(enabled = true): { base: string; custom: boolean; loading: boolean } {
  const q = useQuery({
    queryKey: qk.settings(SHARE_BASE_KEY),
    queryFn: () => api.settings.get<string>(SHARE_BASE_KEY),
    enabled,
  });
  const saved = typeof q.data === "string" ? q.data.trim() : "";
  return { base: saved || defaultShareBase(), custom: !!saved, loading: q.isPending };
}
