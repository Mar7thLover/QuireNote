import type { CardTemplate, RuleScope } from "@quirenote/core";
import { buildSrcdoc, SANDBOX_ATTR } from "@quirenote/render";
import { memo, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { resolvedMode, useTheme } from "@/stores/theme";
import { allTemplates, useRenderedSegments } from "./store";

/** 应用正则规则：普通文本交给 renderText，匹配片段渲染成沙箱卡片。 */
export function RenderedSegments({
  text,
  scope,
  renderText,
}: {
  text: string;
  scope: RuleScope;
  renderText: (text: string) => ReactNode;
}) {
  const result = useRenderedSegments(text, scope);
  if (!result) return <>{renderText(text)}</>;
  const templates = allTemplates();
  return (
    <>
      {result.segments.map((seg, i) =>
        seg.type === "text" ? (
          seg.text.trim() ? (
            <div key={i}>{renderText(seg.text)}</div>
          ) : null
        ) : templates.get(seg.templateId) ? (
          <SandboxCard key={i} template={templates.get(seg.templateId)!} vars={seg.vars} />
        ) : (
          <div key={i}>{renderText(seg.raw)}</div>
        ),
      )}
    </>
  );
}

/** 读取当前应用主题的实际颜色，注入到卡片 iframe 中，使卡片跟随深浅色。 */
export function useCardThemeVars(): Record<string, string> {
  const theme = useTheme();
  const mode = resolvedMode(theme.mode);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 主题变化时重新读取计算样式
  return useMemo(() => {
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string) => cs.getPropertyValue(n).trim();
    return {
      "--card-bg": v("--surface"),
      "--card-fg": v("--fg"),
      "--card-muted": v("--fg-muted"),
      "--card-accent": v("--accent"),
      "--card-border": v("--border"),
      "--card-radius": `${theme.radius + 2}px`,
      "--font-sans": theme.fontSans,
      "--font-serif": theme.fontSerif,
      "--font-mono": theme.fontMono,
    };
  }, [mode, theme.accent, theme.radius, theme.fontSans, theme.fontSerif, theme.fontMono]);
}

export const SandboxCard = memo(function SandboxCard({
  template,
  vars,
  className,
}: {
  template: Pick<CardTemplate, "html" | "css">;
  vars: Record<string, string>;
  className?: string;
}) {
  const themeVars = useCardThemeVars();
  const srcdoc = useMemo(() => buildSrcdoc(template, vars, { themeVars }), [template, vars, themeVars]);
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(80);

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;
    let ro: ResizeObserver | null = null;
    const measure = () => {
      const doc = iframe.contentDocument;
      if (!doc?.documentElement) return;
      setHeight(Math.ceil(doc.documentElement.scrollHeight));
      ro?.disconnect();
      ro = new ResizeObserver(() => setHeight(Math.ceil(doc.documentElement.scrollHeight)));
      ro.observe(doc.body);
    };
    iframe.addEventListener("load", measure);
    return () => {
      iframe.removeEventListener("load", measure);
      ro?.disconnect();
    };
  }, []);

  return (
    <iframe
      ref={ref}
      title="card"
      sandbox={SANDBOX_ATTR}
      srcDoc={srcdoc}
      className={className ?? "my-3 block w-full border-0"}
      style={{ height }}
      loading="lazy"
    />
  );
});
