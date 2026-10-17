/**
 * 笔记里的嵌入块。每种都有单独成行的 Markdown 写法，别的 Markdown 阅读器也能看懂大意：
 * - 图片 / 视频 / 音频：`![说明](asset://id 或 https://…)`，类型看扩展名
 * - HTML 块：```html 代码块，清洗后放进不执行脚本的沙箱 iframe
 * - YouTube / Bilibili：单独一行的视频链接 → 播放器
 * - 链接预览：单独一行的网址 → 标题、描述、缩略图卡片（服务端抓取并缓存）
 */
import { mediaKindOf } from "@quirenote/core";
import { buildSrcdoc, SANDBOX_ATTR } from "@quirenote/render";
import { cn } from "@quirenote/ui";
import { useQuery } from "@tanstack/react-query";
import { mergeAttributes, Node } from "@tiptap/core";
import { type NodeViewProps, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { Code2, ExternalLink, ImageOff } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { autoHeight, useCardThemeVars } from "@/features/render/RenderedSegments";
import { api, apiBase } from "@/lib/api";
import { videoEmbedUrl } from "@/lib/video";

/** asset://id → 服务端地址；其他地址原样。 */
export function resolveSrc(src: string): string {
  return src.startsWith("asset://") ? `${apiBase()}/assets/${encodeURIComponent(src.slice(8))}` : src;
}

// ───────────── 图片 / 视频 / 音频 ─────────────

export const Media = Node.create({
  name: "media",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { src: { default: "" }, alt: { default: "" }, title: { default: null } };
  },
  parseHTML() {
    return [
      {
        tag: "figure[data-media]",
        getAttrs: (el) => ({
          src: (el as HTMLElement).getAttribute("data-src") ?? "",
          alt: (el as HTMLElement).getAttribute("data-alt") ?? "",
        }),
      },
      {
        tag: "img[src]",
        getAttrs: (el) => ({
          src: (el as HTMLImageElement).getAttribute("src") ?? "",
          alt: (el as HTMLImageElement).getAttribute("alt") ?? "",
        }),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "figure",
      mergeAttributes({ "data-media": "", "data-src": HTMLAttributes.src, "data-alt": HTMLAttributes.alt }),
    ];
  },
  markdownTokenName: "quirenoteMedia",
  markdownTokenizer: {
    name: "quirenoteMedia",
    level: "block",
    start: (src: string) => src.search(/(^|\n)!\[/),
    tokenize: (src: string) => {
      const m = /^!\[([^\]\n]*)\]\(\s*(\S+?)(?:\s+"([^"\n]*)")?\s*\)[ \t]*(?:\n|$)/.exec(src);
      return m ? { type: "quirenoteMedia", raw: m[0], alt: m[1], src: m[2], title: m[3] ?? null } : undefined;
    },
  },
  parseMarkdown: (token) => ({
    type: "media",
    attrs: {
      src: token.src as string,
      alt: (token.alt as string) ?? "",
      title: (token.title as string) ?? null,
    },
  }),
  renderMarkdown: (node) => {
    const a = node.attrs as { src: string; alt: string; title: string | null };
    return `![${(a.alt ?? "").replace(/[\]\n]/g, " ")}](${a.src}${a.title ? ` "${a.title.replace(/"/g, "'")}"` : ""})`;
  },
  addNodeView() {
    return ReactNodeViewRenderer(MediaView);
  },
});

function MediaView({ node, selected, updateAttributes, editor }: NodeViewProps) {
  const { src, alt } = node.attrs as { src: string; alt: string };
  const url = resolveSrc(src);
  const kind = mediaKindOf(src) ?? "image";
  const [failed, setFailed] = useState(false);
  return (
    <NodeViewWrapper as="figure" className={cn("qn-media my-4", selected && "qn-selected")} data-drag-handle>
      {failed ? (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-[13px] text-fg-subtle">
          <ImageOff className="size-4" />
          {alt || src}
        </div>
      ) : kind === "video" ? (
        // biome-ignore lint/a11y/useMediaCaption: 说明文字在下方
        <video
          src={url}
          controls
          preload="metadata"
          className="w-full rounded-lg"
          onError={() => setFailed(true)}
        />
      ) : kind === "audio" ? (
        // biome-ignore lint/a11y/useMediaCaption: 说明文字在下方
        <audio src={url} controls preload="metadata" className="w-full" onError={() => setFailed(true)} />
      ) : (
        <img
          src={url}
          alt={alt}
          loading="lazy"
          className="max-w-full rounded-lg"
          onError={() => setFailed(true)}
        />
      )}
      {editor.isEditable && selected ? (
        <input
          defaultValue={alt}
          placeholder="说明（可选）"
          onBlur={(e) => e.target.value !== alt && updateAttributes({ alt: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className="mt-1.5 w-full bg-transparent text-center text-[13px] text-fg-subtle outline-none"
        />
      ) : alt ? (
        <figcaption className="mt-1.5 text-center text-[13px] text-fg-subtle">{alt}</figcaption>
      ) : null}
    </NodeViewWrapper>
  );
}

// ───────────── HTML 块 ─────────────

export const HtmlBlock = Node.create({
  name: "htmlBlock",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { code: { default: "" }, editing: { default: false, rendered: false } };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-html-block]",
        getAttrs: (el) => ({ code: (el as HTMLElement).getAttribute("data-code") ?? "" }),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ "data-html-block": "", "data-code": HTMLAttributes.code })];
  },
  markdownTokenName: "quirenoteHtml",
  markdownTokenizer: {
    name: "quirenoteHtml",
    level: "block",
    start: (src: string) => src.search(/(^|\n)```html\b/),
    tokenize: (src: string) => {
      const m = /^```html[^\n]*\n([\s\S]*?)\n```[ \t]*(?:\n|$)/.exec(src);
      return m ? { type: "quirenoteHtml", raw: m[0], code: m[1] } : undefined;
    },
  },
  parseMarkdown: (token) => ({ type: "htmlBlock", attrs: { code: (token.code as string) ?? "" } }),
  renderMarkdown: (node) => `\`\`\`html\n${(node.attrs?.code as string) ?? ""}\n\`\`\``,
  addNodeView() {
    return ReactNodeViewRenderer(HtmlBlockView);
  },
});

export const HTML_SAMPLE = `<div style="padding:16px 20px;border:1px solid var(--card-border);border-radius:var(--card-radius);background:var(--card-bg)">
  <div style="font-family:var(--font-serif);font-size:18px">标题</div>
  <p style="color:var(--card-muted);margin:6px 0 0">在这里写 HTML。可以用 var(--card-accent) 等主题变量取色，脚本不会执行。</p>
</div>`;

function HtmlBlockView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const code = node.attrs.code as string;
  const [editing, setEditing] = useState<boolean>(!!node.attrs.editing || !code.trim());
  const themeVars = useCardThemeVars();
  const srcdoc = useMemo(() => buildSrcdoc({ html: code, css: "" }, {}, { themeVars }), [code, themeVars]);
  const [height, setHeight] = useState(60);
  // iframe 在编辑态与显示态之间会重新挂载：用回调 ref 每次挂上时开始量高度，卸下时清理
  const frameRef = useCallback(
    (el: HTMLIFrameElement | null) => (el ? autoHeight(el, setHeight) : undefined),
    [],
  );
  if (editing && editor.isEditable)
    return (
      <NodeViewWrapper className="my-3" data-drag-handle>
        <div className="mb-1 flex items-center gap-1.5 text-[12px] text-fg-subtle">
          <Code2 className="size-3.5" />
          HTML（Ctrl + Enter 完成）
        </div>
        <textarea
          autoFocus
          defaultValue={code || HTML_SAMPLE}
          spellCheck={false}
          className="w-full rounded-lg border border-border-strong bg-surface-sunken p-3 font-mono text-[12.5px] leading-relaxed outline-none [field-sizing:content] min-h-24"
          onBlur={(e) => {
            updateAttributes({ code: e.target.value.trim(), editing: false });
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.blur();
            if (e.key === "Escape") e.currentTarget.blur();
          }}
        />
      </NodeViewWrapper>
    );
  return (
    <NodeViewWrapper
      className={cn("group relative my-3 rounded-lg", selected && "qn-selected")}
      data-drag-handle
    >
      <iframe
        ref={frameRef}
        title="HTML"
        sandbox={SANDBOX_ATTR}
        srcDoc={srcdoc}
        className="pointer-events-none block w-full border-0"
        style={{ height }}
      />
      {editor.isEditable ? (
        <button
          type="button"
          contentEditable={false}
          onClick={() => setEditing(true)}
          className="absolute top-2 right-2 rounded-md border border-border bg-surface-raised px-2 py-1 text-[12px] text-fg-subtle opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:text-fg"
        >
          编辑 HTML
        </button>
      ) : null}
    </NodeViewWrapper>
  );
}

// ───────────── 视频链接 ─────────────

const URL_LINE = /^<?(https?:\/\/[^\s<>]+?)>?[ \t]*(?:\n|$)/;

export const VideoEmbed = Node.create({
  name: "videoEmbed",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { url: { default: "" } };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-video-embed]",
        getAttrs: (el) => ({ url: (el as HTMLElement).getAttribute("data-url") ?? "" }),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ "data-video-embed": "", "data-url": HTMLAttributes.url })];
  },
  markdownTokenName: "quirenoteVideo",
  markdownTokenizer: {
    name: "quirenoteVideo",
    level: "block",
    start: (src: string) => src.search(/(^|\n)<?https?:\/\//),
    tokenize: (src: string) => {
      const m = URL_LINE.exec(src);
      return m && videoEmbedUrl(m[1]!) ? { type: "quirenoteVideo", raw: m[0], url: m[1] } : undefined;
    },
  },
  parseMarkdown: (token) => ({ type: "videoEmbed", attrs: { url: token.url as string } }),
  renderMarkdown: (node) => `${node.attrs?.url as string}`,
  addNodeView() {
    return ReactNodeViewRenderer(VideoEmbedView);
  },
});

function VideoEmbedView({ node, selected }: NodeViewProps) {
  const url = node.attrs.url as string;
  const player = videoEmbedUrl(url);
  return (
    <NodeViewWrapper className={cn("my-4", selected && "qn-selected")} data-drag-handle>
      {player ? (
        <iframe
          title={url}
          src={player}
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          allow="fullscreen; picture-in-picture; encrypted-media"
          referrerPolicy="strict-origin-when-cross-origin"
          className="aspect-video w-full rounded-lg border-0 bg-surface-sunken"
          loading="lazy"
        />
      ) : null}
      <a
        href={url}
        target="_blank"
        rel="noreferrer noopener"
        style={{ textDecoration: "none" }}
        className="mt-1 block truncate text-[12.5px] text-fg-subtle hover:text-fg"
      >
        {url}
      </a>
    </NodeViewWrapper>
  );
}

// ───────────── 链接预览 ─────────────

export const LinkPreview = Node.create({
  name: "linkPreview",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { url: { default: "" } };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-link-preview]",
        getAttrs: (el) => ({ url: (el as HTMLElement).getAttribute("data-url") ?? "" }),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ "data-link-preview": "", "data-url": HTMLAttributes.url })];
  },
  markdownTokenName: "quirenoteLink",
  markdownTokenizer: {
    name: "quirenoteLink",
    level: "block",
    start: (src: string) => src.search(/(^|\n)<?https?:\/\//),
    tokenize: (src: string) => {
      const m = URL_LINE.exec(src);
      return m && !videoEmbedUrl(m[1]!) ? { type: "quirenoteLink", raw: m[0], url: m[1] } : undefined;
    },
  },
  parseMarkdown: (token) => ({ type: "linkPreview", attrs: { url: token.url as string } }),
  renderMarkdown: (node) => `${node.attrs?.url as string}`,
  addNodeView() {
    return ReactNodeViewRenderer(LinkPreviewView);
  },
});

function LinkPreviewView({ node, selected }: NodeViewProps) {
  const url = node.attrs.url as string;
  const q = useQuery({
    queryKey: ["link-preview", url],
    queryFn: () => api.linkPreview(url),
    staleTime: 3600_000,
  });
  const p = q.data;
  return (
    <NodeViewWrapper className={cn("my-3", selected && "qn-selected")} data-drag-handle>
      <a
        href={url}
        target="_blank"
        rel="noreferrer noopener"
        contentEditable={false}
        style={{ textDecoration: "none" }}
        className="flex overflow-hidden rounded-xl border border-border bg-surface transition-colors hover:border-border-strong"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1 px-4 py-3">
          <span className="truncate text-[14.5px] font-medium text-fg">{p?.title ?? url}</span>
          {p?.description ? (
            <span className="line-clamp-2 text-[13px] leading-relaxed text-fg-subtle">{p.description}</span>
          ) : null}
          <span className="mt-auto flex items-center gap-1 pt-1 text-[12px] text-fg-subtle">
            <ExternalLink className="size-3" />
            {p?.site ?? new URL(url).hostname}
          </span>
        </span>
        {p?.image ? (
          <img
            src={p.image}
            alt=""
            loading="lazy"
            className="w-36 shrink-0 object-cover"
            referrerPolicy="no-referrer"
          />
        ) : null}
      </a>
    </NodeViewWrapper>
  );
}
