import { builtinRuleSamples } from "@folio/render";
import { cn } from "@folio/ui";
import { type Editor, Extension, type Range } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import {
  CheckSquare,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Lightbulb,
  List,
  ListOrdered,
  ListTree,
  type LucideIcon,
  Minus,
  PenLine,
  Quote,
  ScrollText,
  Sparkles,
  Table,
  Type,
} from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import i18n from "@/i18n";

export interface SlashItem {
  id: string;
  title: string;
  group: "basic" | "ai" | "card";
  icon: LucideIcon;
  keywords: string;
  run: (editor: Editor, range: Range) => void;
}

/** AI 斜杠命令由编辑器宿主注入（需要 notebookId 等上下文）。 */
export type AiSlashHandler = (action: "continue" | "summarize" | "outline", editor: Editor) => void;

function basicItems(): SlashItem[] {
  const t = (k: string) => i18n.t(`editor.${k}`);
  const block = (id: string, icon: LucideIcon, keywords: string, fn: (e: Editor) => void): SlashItem => ({
    id,
    title: t(`slash_${id}`),
    group: "basic",
    icon,
    keywords,
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).run();
      fn(editor);
    },
  });
  return [
    block("text", Type, "text paragraph 正文 段落", (e) => e.chain().setParagraph().run()),
    block("h1", Heading1, "h1 heading 标题", (e) => e.chain().toggleHeading({ level: 1 }).run()),
    block("h2", Heading2, "h2 heading 标题", (e) => e.chain().toggleHeading({ level: 2 }).run()),
    block("h3", Heading3, "h3 heading 标题", (e) => e.chain().toggleHeading({ level: 3 }).run()),
    block("bullet", List, "bullet list 列表 无序", (e) => e.chain().toggleBulletList().run()),
    block("ordered", ListOrdered, "ordered list 列表 有序 编号", (e) => e.chain().toggleOrderedList().run()),
    block("todo", CheckSquare, "todo task 待办 任务", (e) => e.chain().toggleTaskList().run()),
    block("quote", Quote, "quote 引用", (e) => e.chain().toggleBlockquote().run()),
    block("callout", Lightbulb, "callout tip 提示", (e) => e.chain().setCallout().run()),
    block("code", Code2, "code 代码", (e) => e.chain().toggleCodeBlock().run()),
    block("table", Table, "table 表格", (e) =>
      e.chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    ),
    block("divider", Minus, "divider hr 分割线", (e) => e.chain().setHorizontalRule().run()),
  ];
}

const CARD_LABELS: Record<string, string> = {
  term: "术语卡",
  compare: "对比卡",
  stat: "数据卡",
  quote: "引用卡",
  timeline: "时间线卡",
  knowledge: "知识卡",
  points: "要点卡",
};

function cardItems(): SlashItem[] {
  return Object.entries(builtinRuleSamples)
    .filter(([, sample]) => sample.startsWith("【"))
    .map(([ruleId, sample]) => {
      const key = ruleId.split(".").at(-1) ?? "";
      return {
        id: `card-${ruleId}`,
        title: CARD_LABELS[key] ?? ruleId,
        group: "card" as const,
        icon: ScrollText,
        keywords: `card 卡片 模板 ${ruleId} ${CARD_LABELS[key] ?? ""}`,
        run: (editor: Editor, range: Range) => {
          editor.chain().focus().deleteRange(range).insertCard(sample).run();
        },
      };
    });
}

export function slashItems(ai: AiSlashHandler, query: string): SlashItem[] {
  const t = (k: string) => i18n.t(`editor.${k}`);
  const aiItem = (
    id: "continue" | "summarize" | "outline",
    key: string,
    icon: LucideIcon,
    kw: string,
  ): SlashItem => ({
    id: `ai-${id}`,
    title: t(key),
    group: "ai",
    icon,
    keywords: `ai ${kw}`,
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).run();
      ai(id, editor);
    },
  });
  const all = [
    aiItem("continue", "slash_ai_continue", PenLine, "continue 续写 写作"),
    aiItem("summarize", "slash_ai_summary", Sparkles, "summary 总结 资料"),
    aiItem("outline", "slash_ai_outline", ListTree, "outline 大纲"),
    ...basicItems(),
    ...cardItems(),
  ];
  const q = query.toLowerCase().trim();
  if (!q) return all;
  return all.filter((i) => `${i.title} ${i.keywords} ${i.id}`.toLowerCase().includes(q));
}

interface ListHandle {
  onKeyDown: (e: KeyboardEvent) => boolean;
}

const SlashList = forwardRef<ListHandle, SuggestionProps<SlashItem>>(function SlashList(props, ref) {
  const [index, setIndex] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 列表变化时重置选中项
  useEffect(() => setIndex(0), [props.items]);
  const select = (i: number) => {
    const item = props.items[i];
    if (item) props.command(item);
  };
  useImperativeHandle(ref, () => ({
    onKeyDown: (e) => {
      if (e.key === "ArrowDown") {
        setIndex((i) => (i + 1) % Math.max(1, props.items.length));
        return true;
      }
      if (e.key === "ArrowUp") {
        setIndex((i) => (i - 1 + props.items.length) % Math.max(1, props.items.length));
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        select(index);
        return true;
      }
      return false;
    },
  }));
  useEffect(() => {
    document.querySelector(`[data-slash-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  if (!props.items.length) return null;
  let lastGroup = "";
  return (
    <div className="max-h-80 w-64 overflow-y-auto rounded-lg border border-border bg-surface-raised p-1 shadow-lg animate-pop">
      {props.items.map((item, i) => {
        const header = item.group !== lastGroup;
        lastGroup = item.group;
        return (
          <div key={item.id}>
            {header ? (
              <div className="px-2 pt-1.5 pb-1 text-[11px] font-medium text-fg-subtle">
                {item.group === "ai"
                  ? "AI"
                  : item.group === "card"
                    ? "卡片模板"
                    : i18n.t("editor.group_basic")}
              </div>
            ) : null}
            <button
              type="button"
              data-slash-index={i}
              onMouseEnter={() => setIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                select(i);
              }}
              className={cn(
                "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px]",
                i === index && "bg-accent-soft text-accent-soft-fg",
              )}
            >
              <span
                className={cn(
                  "grid size-6 place-items-center rounded-md border border-border bg-surface",
                  item.group === "ai" && "border-accent/30 text-accent",
                )}
              >
                <item.icon className="size-3.5" />
              </span>
              {item.title}
            </button>
          </div>
        );
      })}
    </div>
  );
});

export const SlashCommand = Extension.create<{ ai: AiSlashHandler }>({
  name: "slashCommand",
  addOptions() {
    return { ai: () => {} };
  },
  addProseMirrorPlugins() {
    const ai = this.options.ai;
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        char: "/",
        startOfLine: false,
        allowSpaces: false,
        items: ({ query }) => slashItems(ai, query),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: () => {
          let renderer: ReactRenderer<ListHandle, SuggestionProps<SlashItem>> | null = null;
          let el: HTMLDivElement | null = null;
          const place = (props: SuggestionProps<SlashItem>) => {
            const rect = props.clientRect?.();
            if (!rect || !el) return;
            const below = rect.bottom + 330 < window.innerHeight;
            el.style.left = `${Math.min(rect.left, window.innerWidth - 270)}px`;
            el.style.top = below ? `${rect.bottom + 6}px` : `${Math.max(8, rect.top - 330)}px`;
          };
          return {
            onStart: (props) => {
              renderer = new ReactRenderer(SlashList, { props, editor: props.editor });
              el = document.createElement("div");
              el.style.position = "fixed";
              el.style.zIndex = "70";
              el.appendChild(renderer.element);
              document.body.appendChild(el);
              place(props);
            },
            onUpdate: (props) => {
              renderer?.updateProps(props);
              place(props);
            },
            onKeyDown: ({ event }) => {
              if (event.key === "Escape") {
                el?.remove();
                return true;
              }
              return renderer?.ref?.onKeyDown(event) ?? false;
            },
            onExit: () => {
              el?.remove();
              renderer?.destroy();
              el = null;
              renderer = null;
            },
          };
        },
      }),
    ];
  },
});
