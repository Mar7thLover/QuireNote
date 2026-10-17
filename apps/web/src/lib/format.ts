import { markdownExcerpt } from "@quirenote/core";
import { currentLang } from "@/i18n";

export function relativeTime(iso: string): string {
  const d = new Date(iso).getTime();
  const diff = (Date.now() - d) / 1000;
  const rtf = new Intl.RelativeTimeFormat(currentLang() === "zh" ? "zh-CN" : "en", { numeric: "auto" });
  if (diff < 45) return rtf.format(0, "second");
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), "minute");
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), "hour");
  if (diff < 86400 * 7) return rtf.format(-Math.round(diff / 86400), "day");
  return new Date(iso).toLocaleDateString(currentLang() === "zh" ? "zh-CN" : "en", {
    month: "short",
    day: "numeric",
  });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let i = -1;
  let v = n;
  do {
    v /= 1024;
    i++;
  } while (v >= 1024 && i < u.length - 1);
  return `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat(currentLang() === "zh" ? "zh-CN" : "en", {
    notation: n > 9999 ? "compact" : "standard",
  }).format(n);
}

/** Token 数：1,234 / 12.3K / 4.5M。 */
export function formatTokens(n: number): string {
  if (n < 10_000) return new Intl.NumberFormat("en").format(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 100_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(n < 100_000_000 ? 1 : 0)}M`;
}

/** 美元金额：$0.00；大于 0 但不足一分显示 <$0.01。 */
export function formatUsd(n: number): string {
  if (n > 0 && n < 0.01) return "<$0.01";
  return `$${n.toFixed(n >= 1000 ? 0 : 2)}`;
}

/** 本地化的数字（字数等）。 */
export function formatNumber(n: number): string {
  return new Intl.NumberFormat(currentLang() === "zh" ? "zh-CN" : "en").format(n);
}

/** YYYY-MM-DD → 10月16日 / Oct 16。 */
export function shortDay(day: string): string {
  if (!day) return "";
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString(currentLang() === "zh" ? "zh-CN" : "en", {
    month: "short",
    day: "numeric",
  });
}

/** 从 markdown 中取前若干个字符的纯文本预览。 */
export function plainPreview(md: string, max = 140): string {
  return markdownExcerpt(md, max);
}

export function greetingKey(): "greeting_morning" | "greeting_afternoon" | "greeting_evening" {
  const h = new Date().getHours();
  return h < 12 ? "greeting_morning" : h < 18 ? "greeting_afternoon" : "greeting_evening";
}
