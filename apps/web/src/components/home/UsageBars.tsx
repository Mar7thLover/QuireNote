import { cn } from "@quirenote/ui";
import { useState } from "react";
import { useTranslation } from "@/i18n";
import { formatTokens, formatUsd, shortDay } from "@/lib/format";

/**
 * 最近 14 天的 Token 用量柱状图（单一序列，不需要图例）。
 * 最近 7 天用点缀色，之前 7 天同色调淡化，对应卡片上「较前 7 天」的比较。悬停显示当天数值。
 */
export function UsageBars({ daily }: { daily: { day: string; tokens: number; cost: number }[] }) {
  const { t } = useTranslation();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...daily.map((d) => d.tokens));
  const h = 64;
  const cur = hover !== null ? daily[hover] : null;
  return (
    <div className="relative w-full max-w-[280px]">
      <div
        className="flex h-16 items-end gap-[3px]"
        role="img"
        aria-label={t("home.usageChartLabel")}
        onMouseLeave={() => setHover(null)}
      >
        {daily.map((d, i) => {
          const recent = i >= daily.length - 7;
          const bh = d.tokens ? Math.max(3, Math.round((d.tokens / max) * h)) : 2;
          return (
            // 命中区域是整列，比柱子本身大
            // biome-ignore lint/a11y/noStaticElementInteractions: 悬停提示只是补充，数值在卡片文字里
            <div key={d.day} className="flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)}>
              <div
                className={cn(
                  "w-full rounded-t-[4px] transition-opacity",
                  d.tokens ? (recent ? "bg-accent" : "bg-accent/35") : "bg-border",
                  hover !== null && hover !== i && "opacity-60",
                )}
                style={{ height: bh }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-fg-subtle tabular-nums">
        <span>{shortDay(daily[0]?.day ?? "")}</span>
        <span>{t("home.today")}</span>
      </div>
      {cur ? (
        <div
          className="pointer-events-none absolute -top-12 z-10 -translate-x-1/2 rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-[12px] whitespace-nowrap shadow-md"
          style={{ left: `${((hover! + 0.5) / daily.length) * 100}%` }}
        >
          <div className="text-fg-subtle">{shortDay(cur.day)}</div>
          <div className="text-fg tabular-nums">
            {formatTokens(cur.tokens)} tokens
            {cur.cost > 0 ? <span className="text-fg-muted"> · {formatUsd(cur.cost)}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 本月花费占预算的圆环；超过 90% 用警示色（旁边有文字说明，不只靠颜色）。 */
export function BudgetRing({ ratio }: { ratio: number }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  const v = Math.min(1, Math.max(0, ratio));
  return (
    <svg viewBox="0 0 44 44" className="size-12 shrink-0 -rotate-90" aria-hidden>
      <circle cx="22" cy="22" r={r} fill="none" stroke="var(--border)" strokeWidth="3.5" />
      <circle
        cx="22"
        cy="22"
        r={r}
        fill="none"
        stroke={ratio >= 0.9 ? "var(--warning)" : "var(--accent)"}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeDasharray={`${Math.max(v * c, v > 0 ? 2 : 0)} ${c}`}
      />
    </svg>
  );
}
