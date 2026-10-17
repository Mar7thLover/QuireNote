import type { CardTemplate, RuleScope } from "@quirenote/core";
import { buildSrcdoc, renderInlineHtml, SANDBOX_ATTR } from "@quirenote/render";
import { Fragment, memo, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import { resolvedMode, useTheme } from "@/stores/theme";
import { RenderOverrideContext, templatesFor, useRenderedSegments } from "./store";

/** 行内匹配在文本里的占位：Markdown 里是一个空链接，交给 a 组件换成渲染结果。 */
export const INLINE_PREFIX = "#qn-seg-";
const PLACEHOLDER_RE = /\[\u200b\]\(#qn-seg-(\d+)\)/g;

/** 纯文本渲染时，把占位换回行内节点。 */
export function withInline(text: string, inline?: ReadonlyMap<string, ReactNode>): ReactNode {
  if (!inline?.size) return text;
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    out.push(text.slice(last, m.index));
    out.push(<Fragment key={m.index}>{inline.get(`${INLINE_PREFIX}${m[1]}`)}</Fragment>);
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

/** 匹配是否独占一行（或跨行）：是就作为块级卡片，否则留在段落里。 */
function isBlock(raw: string, before: string | null, after: string | null): boolean {
  if (raw.includes("\n")) return true;
  const lineStart = before === null || /(^|\n)[ \t]*$/.test(before);
  const lineEnd = after === null || /^[ \t]*(\n|$)/.test(after);
  return lineStart && lineEnd;
}

/**
 * 应用正则规则：独占一行的匹配渲染成沙箱卡片；行内的匹配留在原位（简单的行内模板直接渲染，
 * 其余放进小的沙箱 iframe），不打断所在的段落和列表。
 */
export function RenderedSegments({
  text,
  scope,
  renderText,
}: {
  text: string;
  scope: RuleScope;
  renderText: (text: string, inline?: ReadonlyMap<string, ReactNode>) => ReactNode;
}) {
  const result = useRenderedSegments(text, scope);
  const override = useContext(RenderOverrideContext);
  if (!result) return <>{renderText(text)}</>;
  const templates = templatesFor(override);
  const segs = result.segments;
  const out: ReactNode[] = [];
  let buf = "";
  let inline = new Map<string, ReactNode>();
  const flush = (key: string) => {
    if (buf.trim()) out.push(<div key={key}>{renderText(buf, inline)}</div>);
    buf = "";
    inline = new Map();
  };
  segs.forEach((seg, i) => {
    if (seg.type === "text") {
      buf += seg.text;
      return;
    }
    const template = templates.get(seg.templateId);
    if (!template) {
      buf += seg.raw;
      return;
    }
    // 紧挨着另一个匹配时不算行首 / 行尾
    const prev = segs[i - 1];
    const next = segs[i + 1];
    const before = prev ? (prev.type === "text" ? prev.text : "\u0001") : null;
    const after = next ? (next.type === "text" ? next.text : "\u0001") : null;
    // 简单的行内模板（上色、加粗之类）不管在哪都留在文字里
    const html = renderInlineHtml(template, seg.vars);
    if (html !== null && seg.raw.includes("\n")) {
      // 行内模板却匹配到了跨行的文字（正则写得太宽）：保留原文，不把几段合成一行
      buf += seg.raw;
      return;
    }
    if (html === null && isBlock(seg.raw, before, after)) {
      flush(`t${i}`);
      out.push(<SandboxCard key={i} template={template} vars={seg.vars} />);
      return;
    }
    inline.set(
      `${INLINE_PREFIX}${i}`,
      html !== null ? (
        // biome-ignore lint/security/noDangerouslySetInnerHtml: renderInlineHtml 只放行行内标签和白名单样式
        <span className="qn-inline-rule" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <span className="qn-inline-card">
          <SandboxCard template={template} vars={seg.vars} className="block w-full border-0" />
        </span>
      ),
    );
    buf += `[\u200b](${INLINE_PREFIX}${i})`;
  });
  flush("end");
  return <>{out}</>;
}

/** 读取当前应用主题的实际颜色（非 hook 版本，编辑器装饰里用）。 */
export function readCardThemeVars(): Record<string, string> {
  const theme = useTheme.getState();
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
}

/** 读取当前应用主题的实际颜色，注入到卡片 iframe 中，使卡片跟随深浅色。 */
export function useCardThemeVars(): Record<string, string> {
  const theme = useTheme();
  const mode = resolvedMode(theme.mode);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 主题变化时重新读取计算样式
  return useMemo(
    () => readCardThemeVars(),
    [mode, theme.accent, theme.radius, theme.fontSans, theme.fontSerif, theme.fontMono],
  );
}

/** 把 iframe 的高度跟随内容（沙箱允许同源读取，但不允许脚本）。返回清理函数。 */
export function autoHeight(iframe: HTMLIFrameElement, onHeight: (h: number) => void): () => void {
  let ro: ResizeObserver | null = null;
  const measure = () => {
    const doc = iframe.contentDocument;
    if (!doc?.documentElement) return;
    onHeight(Math.ceil(doc.documentElement.scrollHeight));
    ro?.disconnect();
    ro = new ResizeObserver(() => onHeight(Math.ceil(doc.documentElement.scrollHeight)));
    ro.observe(doc.body);
  };
  iframe.addEventListener("load", measure);
  return () => {
    iframe.removeEventListener("load", measure);
    ro?.disconnect();
  };
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
