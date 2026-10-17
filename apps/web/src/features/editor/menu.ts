import type { Editor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import {
  Bold,
  BookmarkPlus,
  BookOpenCheck,
  Boxes,
  CheckSquare,
  ClipboardPaste,
  ClipboardType,
  Code,
  Code2,
  Columns3,
  Copy,
  Download,
  Eraser,
  ExternalLink,
  FileCode2,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  ImagePlus,
  Italic,
  Languages,
  Lightbulb,
  Link2,
  Link2Off,
  List,
  ListOrdered,
  ListPlus,
  ListTree,
  MessagesSquare,
  Minimize2,
  Minus,
  PenLine,
  Plus,
  Quote,
  Rows3,
  Scissors,
  SearchCheck,
  Sparkles,
  Strikethrough,
  Table,
  TableCellsMerge,
  TableCellsSplit,
  TextSelect,
  Trash2,
  Type,
  Wand2,
} from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import i18n from "@/i18n";
import type { TransformAction } from "@/lib/ai";
import { copyText, download, readClipboardHtml, readClipboardText } from "@/lib/clipboard";
import { type Contribution, type MenuItem, type MenuSection, selectionAt } from "@/lib/contextMenu";
import { askInChat, saveQuoteAsCard } from "@/lib/workspaceActions";
import { useUi } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";
import type { AiRequest } from "./AiDraft";
import { resolveSrc } from "./embeds";

export interface EditorMenuDeps {
  notebookId: string;
  runAi: (action: TransformAction, extra?: Partial<AiRequest>) => void;
  upload: () => void;
}

const t = (k: string, o?: Record<string, unknown>) => i18n.t(k, o);

/** 编辑器里的剪切 / 复制：让 ProseMirror 自己序列化（保留格式）；浏览器不允许时退回纯文本。 */
function clipboardCommand(editor: Editor, kind: "copy" | "cut") {
  editor.commands.focus();
  if (document.execCommand(kind)) return;
  const { from, to } = editor.state.selection;
  void copyText(editor.state.doc.textBetween(from, to, "\n")).then(
    (ok) => ok && kind === "cut" && editor.chain().focus().deleteSelection().run(),
  );
}

async function paste(editor: Editor, plain: boolean) {
  const html = plain ? null : await readClipboardHtml();
  if (html) {
    editor.commands.focus();
    editor.view.pasteHTML(html);
    return;
  }
  const text = await readClipboardText();
  if (text == null) return;
  editor.commands.focus();
  editor.view.pasteText(text);
}

/** 右键点到的原子节点（图片、链接预览、HTML 块、引用、元素标签…）及其位置。 */
function atomAt(editor: Editor, el: HTMLElement, x: number, y: number): { node: PmNode; pos: number } | null {
  const { view, state } = editor;
  const hit = view.posAtCoords({ left: x, top: y });
  if (hit && hit.inside >= 0) {
    const node = state.doc.nodeAt(hit.inside);
    if (node?.isAtom && !node.isText) return { node, pos: hit.inside };
  }
  const wrapper = el.closest<HTMLElement>("[data-node-view-wrapper]");
  if (!wrapper || !view.dom.contains(wrapper)) return null;
  const p = view.posAtDOM(wrapper, 0);
  for (const pos of [p, p - 1]) {
    const node = pos >= 0 ? state.doc.nodeAt(pos) : null;
    if (node?.isAtom && !node.isText) return { node, pos };
  }
  return null;
}

function nodeSections(editor: Editor, { node, pos }: { node: PmNode; pos: number }): MenuSection[] {
  const a = node.attrs as Record<string, string | number | null>;
  const remove: MenuItem = {
    id: "ed.node.delete",
    label: t("menu.deleteBlock"),
    icon: Trash2,
    danger: true,
    disabled: !editor.isEditable,
    onSelect: () => editor.chain().focus().setNodeSelection(pos).deleteSelection().run(),
  };
  const url = String(a.url ?? "");
  switch (node.type.name) {
    case "media": {
      const src = resolveSrc(String(a.src ?? ""));
      return [
        [
          {
            id: "ed.media.open",
            label: t("menu.openImage"),
            icon: ExternalLink,
            onSelect: () => window.open(src, "_blank", "noopener"),
          },
          {
            id: "ed.media.copyUrl",
            label: t("menu.copyImageUrl"),
            icon: Link2,
            onSelect: () => copyText(src, true),
          },
          {
            id: "ed.media.download",
            label: t("menu.downloadImage"),
            icon: Download,
            onSelect: () => download(src),
          },
        ],
        [remove],
      ];
    }
    case "linkPreview":
    case "videoEmbed":
      return [
        [
          {
            id: "ed.embed.open",
            label: t("menu.openLink"),
            icon: ExternalLink,
            onSelect: () => window.open(url, "_blank", "noopener"),
          },
          {
            id: "ed.embed.copy",
            label: t("menu.copyLink"),
            icon: Link2,
            onSelect: () => copyText(url, true),
          },
          {
            id: "ed.embed.toLink",
            label: t("menu.toPlainLink"),
            icon: Link2Off,
            disabled: !editor.isEditable,
            onSelect: () =>
              editor
                .chain()
                .focus()
                .insertContentAt(
                  { from: pos, to: pos + node.nodeSize },
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: url, marks: [{ type: "link", attrs: { href: url } }] }],
                  },
                )
                .run(),
          },
        ],
        [remove],
      ];
    case "citation":
      return [
        [
          {
            id: "ed.cite.open",
            label: t("menu.openCitation"),
            icon: FileText,
            disabled: !a.sourceId,
            onSelect: () =>
              a.sourceId &&
              useWorkspace.getState().jumpTo(String(a.sourceId), Number(a.start ?? 0), Number(a.end ?? 0)),
          },
          {
            id: "ed.cite.copy",
            label: t("menu.copyQuote"),
            icon: Copy,
            onSelect: () => copyText(`> ${String(a.quote ?? "")}\n\n— ${String(a.sourceTitle ?? "")}`, true),
          },
        ],
        [remove],
      ];
    case "elementTag":
      return [
        [
          {
            id: "ed.element.open",
            label: t("menu.viewDetails"),
            icon: Boxes,
            onSelect: () =>
              useWorkspace
                .getState()
                .open({ kind: "elements", title: t("nav.elements"), extra: { focus: String(a.name ?? "") } }),
          },
        ],
        [remove],
      ];
    case "htmlBlock":
      return [
        [
          {
            id: "ed.html.edit",
            label: t("common.edit"),
            icon: FileCode2,
            disabled: !editor.isEditable,
            onSelect: () =>
              editor
                .chain()
                .focus()
                .setNodeSelection(pos)
                .updateAttributes("htmlBlock", { editing: true })
                .run(),
          },
        ],
        [remove],
      ];
    default:
      return [[remove]];
  }
}

/** 编辑器的右键菜单：剪贴板、链接、AI、格式、表格、转换与插入；点在嵌入内容上时是该内容自己的菜单。 */
export function editorContribution(
  editor: Editor,
  e: ReactMouseEvent,
  deps: EditorMenuDeps,
): Contribution | null {
  const el = e.target as HTMLElement;
  // 文档之外（AI 草稿、浮动工具栏）不归编辑器管；节点里的输入框（图片说明、HTML 源码）交给通用的输入框菜单。
  if (!editor.view.dom.contains(el) || el.closest("input, textarea")) return null;
  const all: Contribution["claims"] = ["selection", "link", "image", "editable"];
  const editable = editor.isEditable;

  const atom = atomAt(editor, el, e.clientX, e.clientY);
  if (atom) return { claims: all, sections: nodeSections(editor, atom) };

  // 右键点在浏览器的选区上：以它为准（编辑器可能还没同步刚选中的文字）。
  // 落在选区外：先把光标放过去（和原生行为一致），后面的操作都针对这个位置。
  const { view } = editor;
  const hit = view.posAtCoords({ left: e.clientX, top: e.clientY });
  const { from, to } = editor.state.selection;
  const dom = window.getSelection();
  if (dom?.rangeCount && view.dom.contains(dom.anchorNode) && selectionAt(el, e.clientX, e.clientY)) {
    const r = dom.getRangeAt(0);
    const a = view.posAtDOM(r.startContainer, r.startOffset);
    const b = view.posAtDOM(r.endContainer, r.endOffset);
    if (Math.min(a, b) !== from || Math.max(a, b) !== to)
      editor.commands.setTextSelection({ from: Math.min(a, b), to: Math.max(a, b) });
  } else if (hit && (hit.pos < from || hit.pos > to)) editor.commands.setTextSelection(hit.pos);

  const sel = editor.state.selection;
  const text = sel.empty ? "" : editor.state.doc.textBetween(sel.from, sel.to, "\n");
  const has = !!text.trim();

  const clipboard: MenuSection = [
    {
      id: "ed.cut",
      label: t("menu.cut"),
      icon: Scissors,
      shortcut: "Mod+X",
      disabled: !has || !editable,
      onSelect: () => clipboardCommand(editor, "cut"),
    },
    {
      id: "ed.copy",
      label: t("common.copy"),
      icon: Copy,
      shortcut: "Mod+C",
      disabled: !has,
      onSelect: () => clipboardCommand(editor, "copy"),
    },
    {
      id: "ed.paste",
      label: t("menu.paste"),
      icon: ClipboardPaste,
      shortcut: "Mod+V",
      disabled: !editable,
      onSelect: () => void paste(editor, false),
    },
    {
      id: "ed.pastePlain",
      label: t("menu.pastePlain"),
      icon: ClipboardType,
      shortcut: "Mod+Shift+V",
      disabled: !editable,
      onSelect: () => void paste(editor, true),
    },
    {
      id: "ed.selectAll",
      label: t("menu.selectAll"),
      icon: TextSelect,
      shortcut: "Mod+A",
      onSelect: () => editor.chain().focus().selectAll().run(),
    },
  ];

  const sections: MenuSection[] = [clipboard];

  const a = el.closest<HTMLAnchorElement>("a[href]");
  if (a && editor.view.dom.contains(a)) {
    const href = a.getAttribute("href") ?? "";
    sections.push([
      {
        id: "ed.link.open",
        label: t("menu.openLink"),
        icon: ExternalLink,
        onSelect: () => window.open(href, "_blank", "noopener"),
      },
      { id: "ed.link.copy", label: t("menu.copyLink"), icon: Link2, onSelect: () => copyText(href, true) },
      {
        id: "ed.link.edit",
        label: t("menu.editLink"),
        icon: PenLine,
        disabled: !editable,
        onSelect: () => editLink(editor, href),
      },
      {
        id: "ed.link.remove",
        label: t("menu.removeLink"),
        icon: Link2Off,
        disabled: !editable,
        onSelect: () => editor.chain().focus().extendMarkRange("link").unsetLink().run(),
      },
    ]);
  }

  if (editable) {
    const ai = (
      action: TransformAction,
      key: string,
      icon: MenuItem["icon"],
      extra?: Partial<AiRequest>,
    ) => ({
      id: `ed.ai.${action}${extra?.targetLang ?? ""}`,
      label: t(`editor.${key}`),
      icon,
      onSelect: () => deps.runAi(action, extra),
    });
    if (has) {
      sections.push([
        {
          id: "ed.ai",
          label: t("editor.ai"),
          icon: Sparkles,
          items: [
            ai("rewrite", "rewrite", PenLine),
            ai("expand", "expand", ListPlus),
            ai("shorten", "shorten", Minimize2),
            {
              id: "ed.ai.translate",
              label: t("editor.translate"),
              icon: Languages,
              items: (
                [
                  ["English", "英文"],
                  ["简体中文", "中文"],
                  ["日本語", "日文"],
                ] as const
              ).map(([lang, label]) => ({
                id: `ed.ai.translate.${lang}`,
                label: lang,
                onSelect: () =>
                  deps.runAi("translate", { targetLang: lang, label: `${t("editor.translate")} → ${label}` }),
              })),
            },
            ai("explain", "explain", Lightbulb),
            ai("find_source", "findSource", SearchCheck),
            ai("quiz", "quiz", BookOpenCheck),
            { ...ai("custom", "custom", Wand2), shortcut: "Mod+J" },
          ],
        },
        { id: "ed.ask", label: t("reader.ask"), icon: MessagesSquare, onSelect: () => askInChat({ text }) },
        {
          id: "ed.card",
          label: t("reader.toCard"),
          icon: BookmarkPlus,
          onSelect: () => void saveQuoteAsCard(deps.notebookId, { text }),
        },
        {
          id: "ed.command",
          label: t("menu.naturalCommand"),
          icon: Wand2,
          onSelect: () =>
            useUi
              .getState()
              .openPalette(
                t("menu.naturalCommandSeed", { text: `${text.slice(0, 30)}${text.length > 30 ? "…" : ""}` }),
              ),
        },
      ]);
    } else {
      sections.push([
        {
          id: "ed.ai",
          label: t("editor.ai"),
          icon: Sparkles,
          items: [
            ai("continue", "slash_ai_continue", PenLine),
            ai("outline", "slash_ai_outline", ListTree),
            ai("summarize", "summarize", Sparkles),
            { ...ai("custom", "custom", Wand2), shortcut: "Mod+J" },
          ],
        },
      ]);
    }

    const blocks: MenuSection = [];
    if (has) blocks.push(formatMenu(editor));
    if (editor.isActive("table")) blocks.push(tableMenu(editor));
    blocks.push(turnIntoMenu(editor), insertMenu(editor, deps));
    sections.push(blocks);
  }

  return { claims: all, sections };
}

function editLink(editor: Editor, current = "") {
  const href = prompt(t("menu.linkPrompt"), current)?.trim();
  if (href === undefined) return;
  const chain = editor.chain().focus().extendMarkRange("link");
  (href ? chain.setLink({ href }) : chain.unsetLink()).run();
}

function formatMenu(editor: Editor): MenuItem {
  const mark = (
    name: "bold" | "italic" | "strike" | "code" | "highlight",
    key: string,
    icon: MenuItem["icon"],
    shortcut?: string,
  ) => ({
    id: `ed.fmt.${name}`,
    label: t(`menu.${key}`),
    icon,
    shortcut,
    checked: editor.isActive(name),
    onSelect: () => editor.chain().focus().toggleMark(name).run(),
  });
  return {
    id: "ed.format",
    label: t("menu.format"),
    icon: Type,
    items: [
      mark("bold", "bold", Bold, "Mod+B"),
      mark("italic", "italic", Italic, "Mod+I"),
      mark("strike", "strike", Strikethrough),
      mark("code", "inlineCode", Code),
      mark("highlight", "markHighlight", Highlighter),
      {
        id: "ed.fmt.link",
        label: t(editor.isActive("link") ? "menu.editLink" : "menu.addLink"),
        icon: Link2,
        onSelect: () => editLink(editor, editor.getAttributes("link").href as string | undefined),
      },
      {
        id: "ed.fmt.clear",
        label: t("menu.clearFormat"),
        icon: Eraser,
        onSelect: () => editor.chain().focus().unsetAllMarks().run(),
      },
    ],
  };
}

function tableMenu(editor: Editor): MenuItem {
  const can = editor.can();
  const cmd = (
    id: string,
    key: string,
    icon: MenuItem["icon"],
    enabled: boolean,
    run: () => boolean,
    danger = false,
  ) => ({
    id: `ed.table.${id}`,
    label: t(`menu.${key}`),
    icon,
    danger,
    disabled: !enabled,
    onSelect: () => void run(),
  });
  const c = () => editor.chain().focus();
  return {
    id: "ed.table",
    label: t("menu.table"),
    icon: Table,
    items: [
      cmd("rowBefore", "addRowBefore", Rows3, can.addRowBefore(), () => c().addRowBefore().run()),
      cmd("rowAfter", "addRowAfter", Rows3, can.addRowAfter(), () => c().addRowAfter().run()),
      cmd("colBefore", "addColumnBefore", Columns3, can.addColumnBefore(), () => c().addColumnBefore().run()),
      cmd("colAfter", "addColumnAfter", Columns3, can.addColumnAfter(), () => c().addColumnAfter().run()),
      cmd("merge", "mergeCells", TableCellsMerge, can.mergeCells(), () => c().mergeCells().run()),
      cmd("split", "splitCell", TableCellsSplit, can.splitCell(), () => c().splitCell().run()),
      cmd("header", "toggleHeaderRow", Table, can.toggleHeaderRow(), () => c().toggleHeaderRow().run()),
      cmd("delRow", "deleteRow", Trash2, can.deleteRow(), () => c().deleteRow().run(), true),
      cmd("delCol", "deleteColumn", Trash2, can.deleteColumn(), () => c().deleteColumn().run(), true),
      cmd("delTable", "deleteTable", Trash2, can.deleteTable(), () => c().deleteTable().run(), true),
    ],
  };
}

function turnIntoMenu(editor: Editor): MenuItem {
  const block = (id: string, icon: MenuItem["icon"], active: boolean, run: () => boolean) => ({
    id: `ed.turn.${id}`,
    label: t(`editor.slash_${id}`),
    icon,
    checked: active,
    onSelect: () => void run(),
  });
  const c = () => editor.chain().focus();
  const heading = (level: 1 | 2 | 3) => editor.isActive("heading", { level });
  return {
    id: "ed.turnInto",
    label: t("menu.turnInto"),
    icon: Type,
    items: [
      block(
        "text",
        Type,
        editor.isActive("paragraph") &&
          !editor.isActive("bulletList") &&
          !editor.isActive("orderedList") &&
          !editor.isActive("taskList") &&
          !editor.isActive("blockquote"),
        () => c().setParagraph().run(),
      ),
      block("h1", Heading1, heading(1), () => c().toggleHeading({ level: 1 }).run()),
      block("h2", Heading2, heading(2), () => c().toggleHeading({ level: 2 }).run()),
      block("h3", Heading3, heading(3), () => c().toggleHeading({ level: 3 }).run()),
      block("bullet", List, editor.isActive("bulletList"), () => c().toggleBulletList().run()),
      block("ordered", ListOrdered, editor.isActive("orderedList"), () => c().toggleOrderedList().run()),
      block("todo", CheckSquare, editor.isActive("taskList"), () => c().toggleTaskList().run()),
      block("quote", Quote, editor.isActive("blockquote"), () => c().toggleBlockquote().run()),
      block("code", Code2, editor.isActive("codeBlock"), () => c().toggleCodeBlock().run()),
    ],
  };
}

function insertMenu(editor: Editor, deps: EditorMenuDeps): MenuItem {
  const c = () => editor.chain().focus();
  const item = (id: string, icon: MenuItem["icon"], run: () => void) => ({
    id: `ed.insert.${id}`,
    label: t(`editor.slash_${id}`),
    icon,
    onSelect: run,
  });
  return {
    id: "ed.insert",
    label: t("menu.insert"),
    icon: Plus,
    items: [
      item("table", Table, () => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()),
      item("callout", Lightbulb, () => c().setCallout().run()),
      item("divider", Minus, () => c().setHorizontalRule().run()),
      item("media", ImagePlus, deps.upload),
      item("html", Code2, () =>
        c()
          .insertContent({ type: "htmlBlock", attrs: { code: "", editing: true } })
          .run(),
      ),
    ],
  };
}
