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

/** 从 markdown 中取前若干个字符的纯文本预览。 */
export function plainPreview(md: string, max = 140): string {
  const t = md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`~\-[\]()!|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export function greetingKey(): "greeting_morning" | "greeting_afternoon" | "greeting_evening" {
  const h = new Date().getHours();
  return h < 12 ? "greeting_morning" : h < 18 ? "greeting_afternoon" : "greeting_evening";
}
