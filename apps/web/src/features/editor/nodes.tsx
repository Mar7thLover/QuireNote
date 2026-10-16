import { ELEMENT_TYPE_META, type ElementType } from "@quirenote/core";
import { Tag } from "@quirenote/ui";
import { mergeAttributes, Node } from "@tiptap/core";
import { type NodeViewProps, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { Pencil } from "lucide-react";
import { useState } from "react";
import { RenderedSegments } from "@/features/render/RenderedSegments";
import { useWorkspace } from "@/stores/workspace";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    quirenoteCard: { insertCard: (raw: string) => ReturnType };
    quirenoteCallout: { setCallout: () => ReturnType };
  }
}

/**
 * 模板卡片块：内容是一段卡片语法（如 `【术语：名称｜定义】`），
 * 渲染时交给正则规则引擎和沙箱模板；Markdown 序列化为原文，保证可移植。
 */
export const CardEmbed = Node.create({
  name: "cardEmbed",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { raw: { default: "" } };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-card-embed]",
        getAttrs: (el) => ({ raw: (el as HTMLElement).getAttribute("data-raw") ?? "" }),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ "data-card-embed": "", "data-raw": HTMLAttributes.raw })];
  },
  markdownTokenName: "quirenoteCard",
  markdownTokenizer: {
    name: "quirenoteCard",
    level: "block",
    start: (src: string) => src.search(/(^|\n)【/),
    tokenize: (src: string) => {
      const m = /^【[^】\n]{1,2000}】[ \t]*(?:\n|$)/.exec(src);
      return m ? { type: "quirenoteCard", raw: m[0], text: m[0].trim() } : undefined;
    },
  },
  parseMarkdown: (token) => ({
    type: "cardEmbed",
    attrs: { raw: (token.text as string) ?? token.raw?.trim() ?? "" },
  }),
  renderMarkdown: (node) => `${(node.attrs?.raw as string) ?? ""}\n\n`,
  addCommands() {
    return {
      insertCard:
        (raw) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { raw } }),
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(CardView);
  },
});

function CardView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const [editing, setEditing] = useState(false);
  const raw = node.attrs.raw as string;
  return (
    <NodeViewWrapper
      className={`group relative my-2 rounded-lg ${selected ? "ring-2 ring-accent/50" : ""}`}
      data-drag-handle
    >
      {editing ? (
        <textarea
          autoFocus
          defaultValue={raw}
          className="w-full rounded-lg border border-accent bg-surface-sunken p-2.5 font-mono text-[13px] outline-none"
          rows={Math.max(2, raw.length / 60)}
          onBlur={(e) => {
            updateAttributes({ raw: e.target.value.trim() });
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.blur();
            if (e.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <>
          <div contentEditable={false} className="pointer-events-none">
            <RenderedSegments
              text={raw}
              scope="note"
              renderText={(t) => <p className="text-fg-muted">{t}</p>}
            />
          </div>
          {editor.isEditable ? (
            <button
              type="button"
              contentEditable={false}
              onClick={() => setEditing(true)}
              className="absolute top-2 right-2 grid size-7 place-items-center rounded-md border border-border bg-surface-raised text-fg-subtle opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:text-fg"
              aria-label="编辑卡片"
            >
              <Pencil className="size-3.5" />
            </button>
          ) : null}
        </>
      )}
    </NodeViewWrapper>
  );
}

/** 引用徽标（行内原子节点），保存出处信息，点击跳回原文。 */
export const CitationNode = Node.create({
  name: "citation",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return {
      n: { default: 1 },
      sourceId: { default: null },
      sourceTitle: { default: "" },
      start: { default: 0 },
      end: { default: 0 },
      quote: { default: "" },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-citation]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-citation": "" }), String(HTMLAttributes.n)];
  },
  renderMarkdown: (node) => `[${node.attrs?.n ?? ""}]`,
  addNodeView() {
    return ReactNodeViewRenderer(CitationView);
  },
});

function CitationView({ node }: NodeViewProps) {
  const a = node.attrs as {
    n: number;
    sourceId: string;
    sourceTitle: string;
    start: number;
    end: number;
    quote: string;
  };
  return (
    <NodeViewWrapper as="span">
      <button
        type="button"
        className="cite"
        title={`${a.sourceTitle}：${a.quote.slice(0, 120)}`}
        onClick={() => a.sourceId && useWorkspace.getState().jumpTo(a.sourceId, a.start, a.end)}
      >
        {a.n}
      </button>
    </NodeViewWrapper>
  );
}

/** 元素标签：链接到 Notebook 的元素知识库。Markdown 中写作 `[[名称]]`。 */
export const ElementTag = Node.create({
  name: "elementTag",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return { elementId: { default: null }, name: { default: "" }, type: { default: "concept" } };
  },
  parseHTML() {
    return [{ tag: "span[data-element]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-element": "" }), HTMLAttributes.name];
  },
  markdownTokenName: "quirenoteElement",
  markdownTokenizer: {
    name: "quirenoteElement",
    level: "inline",
    start: "[[",
    tokenize: (src: string) => {
      const m = /^\[\[([^\]\n]{1,80})\]\]/.exec(src);
      return m ? { type: "quirenoteElement", raw: m[0], text: m[1] } : undefined;
    },
  },
  parseMarkdown: (token) => ({ type: "elementTag", attrs: { name: token.text } }),
  renderMarkdown: (node) => `[[${node.attrs?.name ?? ""}]]`,
  addNodeView() {
    return ReactNodeViewRenderer(ElementTagView);
  },
});

function ElementTagView({ node }: NodeViewProps) {
  const type = (node.attrs.type as ElementType) ?? "concept";
  const meta = ELEMENT_TYPE_META[type] ?? ELEMENT_TYPE_META.concept;
  return (
    <NodeViewWrapper as="span" className="mx-0.5">
      <Tag
        color={meta.color}
        className="cursor-pointer align-baseline"
        onClick={() =>
          useWorkspace.getState().open({ kind: "elements", title: "元素", extra: { focus: node.attrs.name } })
        }
      >
        {node.attrs.name as string}
      </Tag>
    </NodeViewWrapper>
  );
}

/** 提示块。Markdown 序列化为 `> [!tip] …`，与内置提示卡规则一致。 */
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "inline*",
  defining: true,
  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-callout": "", class: "callout" }),
      ["span", { contenteditable: "false" }, "💡"],
      ["div", 0],
    ];
  },
  renderMarkdown: (node, h) => `> [!tip] ${h.renderChildren(node.content ?? [])}\n\n`,
  addCommands() {
    return {
      setCallout:
        () =>
        ({ commands }) =>
          commands.setNode(this.name),
    };
  },
});
