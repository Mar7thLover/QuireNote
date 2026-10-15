import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Separator,
  Tooltip,
} from "@folio/ui";
import Highlight from "@tiptap/extension-highlight";
import { TableKit } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import Typography from "@tiptap/extension-typography";
import { Placeholder } from "@tiptap/extensions";
import { Markdown as MarkdownExt } from "@tiptap/markdown";
import { type Editor, EditorContent, type JSONContent, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  BookOpenCheck,
  ChevronDown,
  Code,
  Highlighter,
  Italic,
  Languages,
  Lightbulb,
  ListPlus,
  Minimize2,
  PenLine,
  SearchCheck,
  Sparkles,
  Strikethrough,
  Wand2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/i18n";
import type { TransformAction } from "@/lib/ai";
import { DND_SNIPPET, useUi } from "@/stores/ui";
import { AiDraft, type AiRequest } from "./AiDraft";
import { Callout, CardEmbed, CitationNode, ElementTag } from "./nodes";
import { SlashCommand } from "./slash";

export interface EditorChange {
  doc: JSONContent;
  markdown: string;
}

export function FolioEditor({
  notebookId,
  initialDoc,
  initialMarkdown,
  onChange,
  className,
  autofocus,
}: {
  notebookId: string;
  initialDoc: unknown;
  initialMarkdown: string;
  onChange: (c: EditorChange) => void;
  className?: string;
  autofocus?: boolean;
}) {
  const { t } = useTranslation();
  const [ai, setAi] = useState<AiRequest | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const aiRef = useRef<(a: TransformAction, editor: Editor, extra?: Partial<AiRequest>) => void>(() => {});

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      Placeholder.configure({
        placeholder: ({ node }) =>
          node.type.name === "heading" ? t("common.untitled") : t("editor.placeholder"),
      }),
      Highlight.configure({ multicolor: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: true } }),
      Typography,
      MarkdownExt,
      CardEmbed,
      CitationNode,
      ElementTag,
      Callout,
      SlashCommand.configure({
        ai: (action, ed) => aiRef.current(action === "summarize" ? "summarize" : action, ed),
      }),
    ],
    content: (initialDoc as JSONContent | null) ?? initialMarkdown ?? "",
    contentType: initialDoc ? "json" : "markdown",
    autofocus: autofocus ? "end" : false,
    editorProps: {
      attributes: { class: "tiptap prose prose-serif max-w-none focus:outline-none" },
      handleDrop: (view, event) => {
        const snippet = event.dataTransfer?.getData(DND_SNIPPET);
        if (!snippet) return false;
        const pos =
          view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.to;
        event.preventDefault();
        editorRef.current
          ?.chain()
          .focus()
          .insertContentAt(pos, `\n> ${snippet.replace(/\n+/g, " ")}\n\n`, { contentType: "markdown" })
          .run();
        return true;
      },
      handleKeyDown: (_view, event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "j") {
          event.preventDefault();
          const ed = editorRef.current;
          if (ed) aiRef.current("custom", ed, { label: t("editor.custom") });
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => onChangeRef.current({ doc: editor.getJSON(), markdown: editor.getMarkdown() }),
    immediatelyRender: true,
  });
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;

  aiRef.current = (action, ed, extra) => {
    const { from, to, empty } = ed.state.selection;
    let text = empty ? "" : ed.state.doc.textBetween(from, to, "\n");
    if (action === "continue") text = ed.state.doc.textBetween(Math.max(0, from - 1500), from, "\n");
    if (action === "outline" || action === "summarize") text = ed.getMarkdown().slice(0, 4000);
    if (action === "custom" && !text) text = ed.getMarkdown().slice(0, 4000);
    setAi({ action, label: t(`editor.${actionKey(action)}`), text, from, to, ...extra });
  };

  // 外部（如 Agent 应用改动）更新了笔记时同步内容
  useEffect(() => {
    if (!editor || editor.isFocused) return;
    const current = editor.getMarkdown();
    if (initialMarkdown && current !== initialMarkdown && !initialDoc) {
      editor.commands.setContent(initialMarkdown, { contentType: "markdown", emitUpdate: false });
    }
  }, [editor, initialMarkdown, initialDoc]);

  if (!editor) return null;
  return (
    <div className={cn("relative", className)}>
      <BubbleMenu
        editor={editor}
        options={{ placement: "top", offset: 8 }}
        shouldShow={({ editor: ed, state }) =>
          !state.selection.empty && !ed.isActive("cardEmbed") && ed.isEditable
        }
        className="flex items-center gap-0.5 rounded-lg border border-border bg-surface-raised p-1 shadow-lg"
      >
        <AiMenu onRun={(a, extra) => aiRef.current(a, editor, extra)} />
        <Separator vertical className="mx-0.5" />
        <MarkButton editor={editor} mark="bold" icon={Bold} label="Mod+B" />
        <MarkButton editor={editor} mark="italic" icon={Italic} label="Mod+I" />
        <MarkButton editor={editor} mark="strike" icon={Strikethrough} />
        <MarkButton editor={editor} mark="code" icon={Code} />
        <MarkButton editor={editor} mark="highlight" icon={Highlighter} />
        <Separator vertical className="mx-0.5" />
        <Tooltip content="用自然语言操作（命令面板）">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              const { from, to } = editor.state.selection;
              const sel = editor.state.doc.textBetween(from, to, " ");
              useUi.getState().openPalette(`针对选中的「${sel.slice(0, 30)}${sel.length > 30 ? "…" : ""}」`);
            }}
            aria-label="command"
          >
            <Wand2 />
          </Button>
        </Tooltip>
      </BubbleMenu>
      <EditorContent editor={editor} />
      {ai ? (
        <AiDraft
          key={`${ai.action}-${ai.from}-${ai.label}`}
          editor={editor}
          notebookId={notebookId}
          request={ai}
          onClose={() => setAi(null)}
        />
      ) : null}
    </div>
  );
}

function actionKey(a: TransformAction): string {
  return (
    {
      explain: "explain",
      rewrite: "rewrite",
      expand: "expand",
      shorten: "shorten",
      translate: "translate",
      summarize: "summarize",
      find_source: "findSource",
      quiz: "quiz",
      continue: "slash_ai_continue",
      outline: "slash_ai_outline",
      custom: "custom",
    } as const
  )[a];
}

function AiMenu({ onRun }: { onRun: (a: TransformAction, extra?: Partial<AiRequest>) => void }) {
  const { t } = useTranslation();
  const item = (a: TransformAction, Icon: typeof Sparkles, key: string) => (
    <DropdownMenuItem onSelect={() => onRun(a)}>
      <Icon />
      {t(`editor.${key}`)}
    </DropdownMenuItem>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="text-accent hover:text-accent">
          <Sparkles />
          {t("editor.ai")}
          <ChevronDown className="!size-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {item("explain", Lightbulb, "explain")}
        {item("rewrite", PenLine, "rewrite")}
        {item("expand", ListPlus, "expand")}
        {item("shorten", Minimize2, "shorten")}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Languages />
            {t("editor.translate")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {[
              ["English", "英文"],
              ["简体中文", "中文"],
              ["日本語", "日文"],
            ].map(([lang, label]) => (
              <DropdownMenuItem
                key={lang}
                onSelect={() =>
                  onRun("translate", { targetLang: lang, label: `${t("editor.translate")} → ${label}` })
                }
              >
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        {item("find_source", SearchCheck, "findSource")}
        {item("quiz", BookOpenCheck, "quiz")}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onRun("custom")} shortcut="Mod+J">
          <Wand2 />
          {t("editor.custom")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MarkButton({
  editor,
  mark,
  icon: Icon,
  label,
}: {
  editor: Editor;
  mark: "bold" | "italic" | "strike" | "code" | "highlight";
  icon: typeof Bold;
  label?: string;
}) {
  const active = editor.isActive(mark);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn(active && "bg-accent-soft text-accent-soft-fg")}
      onClick={() => editor.chain().focus().toggleMark(mark).run()}
      aria-label={label ?? mark}
      aria-pressed={active}
    >
      <Icon />
    </Button>
  );
}
