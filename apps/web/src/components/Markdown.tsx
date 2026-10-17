import { type Citation, parseCitationMarkers, type RuleScope } from "@quirenote/core";
import { cn, HoverCard, HoverCardContent, HoverCardTrigger } from "@quirenote/ui";
import { FileText } from "lucide-react";
import { memo, type ReactNode, useMemo } from "react";
import ReactMarkdown, { type Components, type UrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { INLINE_PREFIX, RenderedSegments } from "@/features/render/RenderedSegments";
import { useWorkspace } from "@/stores/workspace";

/** 把 `[1]`、`[2, 3]` 改写为 `[1](#cite-1)` 链接，交给自定义 a 组件渲染成徽标。 */
export function linkifyCitations(md: string): string {
  const markers = parseCitationMarkers(md);
  if (!markers.length) return md;
  let out = "";
  let last = 0;
  const byIndex = new Map<number, { length: number; nums: number[] }>();
  for (const m of markers) {
    const e = byIndex.get(m.index) ?? { length: m.length, nums: [] };
    e.nums.push(m.n);
    byIndex.set(m.index, e);
  }
  for (const [index, { length, nums }] of [...byIndex.entries()].sort((a, b) => a[0] - b[0])) {
    out += md.slice(last, index) + nums.map((n) => `[${n}](#cite-${n})`).join("");
    last = index + length;
  }
  return out + md.slice(last);
}

export const Markdown = memo(function Markdown({
  text,
  citations,
  className,
  scope,
  serif,
  components: extra,
  urlTransform,
}: {
  text: string;
  citations?: Citation[];
  className?: string;
  /** 指定后会先应用该作用范围的正则规则，把匹配内容渲染成沙箱卡片。 */
  scope?: RuleScope;
  serif?: boolean;
  /** 额外的元素渲染（例如分享页里的图片、视频和 HTML 块），链接 a 不可覆盖。 */
  components?: Components;
  /** 改写链接与图片地址（例如 asset:// → 资源地址）；默认只放行安全协议。 */
  urlTransform?: UrlTransform;
}) {
  const md = useMemo(() => (citations ? linkifyCitations(text) : text), [text, citations]);
  const components = useMemo<Components>(
    () => ({
      ...extra,
      a: ({ href, children }) => {
        if (href?.startsWith(INLINE_PREFIX)) return null;
        if (href?.startsWith("#cite-")) {
          const n = Number(href.slice(6));
          return <CiteBadge n={n} citation={citations?.find((c) => c.n === n)} />;
        }
        return (
          <a href={href} target="_blank" rel="noreferrer noopener">
            {children}
          </a>
        );
      },
    }),
    [citations, extra],
  );
  const body = (src: string, inline?: ReadonlyMap<string, ReactNode>) => (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      urlTransform={urlTransform}
      components={
        inline?.size
          ? {
              ...components,
              a: (props) =>
                props.href?.startsWith(INLINE_PREFIX)
                  ? (inline.get(props.href) ?? null)
                  : (components.a as (p: typeof props) => ReactNode)(props),
            }
          : components
      }
    >
      {src}
    </ReactMarkdown>
  );
  return (
    <div className={cn("prose", serif && "prose-serif", className)}>
      {scope ? <RenderedSegments text={md} scope={scope} renderText={body} /> : body(md)}
    </div>
  );
});

export function CiteBadge({ n, citation }: { n: number; citation?: Citation }) {
  const jumpTo = useWorkspace((s) => s.jumpTo);
  if (!citation) {
    return (
      <span className="cite" data-invalid title="引用不存在">
        {n}
      </span>
    );
  }
  return (
    <HoverCard openDelay={150} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className="cite"
          onClick={() => jumpTo(citation.sourceId, citation.start, citation.end)}
          aria-label={`引用 ${n}：${citation.sourceTitle}`}
        >
          {n}
        </button>
      </HoverCardTrigger>
      <HoverCardContent className="w-96" side="top">
        <CitationPreview citation={citation} />
      </HoverCardContent>
    </HoverCard>
  );
}

export function CitationPreview({ citation, extra }: { citation: Citation; extra?: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
        <FileText className="size-3.5" />
        <span className="truncate">{citation.sourceTitle}</span>
        {citation.page ? <span className="shrink-0 text-fg-subtle">· p.{citation.page}</span> : null}
        {extra}
      </div>
      <p className="line-clamp-6 border-l-2 border-accent/50 pl-2.5 font-serif text-[13.5px] leading-relaxed text-fg">
        {citation.quote}
      </p>
      <p className="text-[11px] text-fg-subtle">点击跳转到原文并高亮</p>
    </div>
  );
}
