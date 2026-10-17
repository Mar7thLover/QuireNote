import type { SourceContent } from "@quirenote/core";
import {
  BookmarkPlus,
  Copy,
  Eraser,
  Globe,
  Highlighter,
  Lightbulb,
  MessageSquarePlus,
  MessagesSquare,
  Quote,
} from "lucide-react";
import i18n from "@/i18n";
import { copyText } from "@/lib/clipboard";
import type { MenuSection } from "@/lib/contextMenu";
import { askInChat, saveQuoteAsCard, searchWeb } from "@/lib/workspaceActions";
import { clearRange, HIGHLIGHT_COLORS, highlightRange, userHighlightsIn } from "./SelectionToolbar";

type Highlight = SourceContent["highlights"][number];

/**
 * 阅读器里右键选中文字或已有高亮时的菜单：提问、解释、高亮颜色、批注、摘录、复制。
 * openToolbar 打开同一个高亮工具栏并直接展开批注或解释（结果留在阅读区里）。
 */
export function readerSections(p: {
  notebookId: string;
  sourceId: string;
  sourceTitle: string;
  range: { start: number; end: number; text: string };
  highlights: Highlight[];
  openToolbar: (mode: "annotate" | "explain") => void;
}): MenuSection[] {
  const t = i18n.t.bind(i18n);
  const { range, sourceId, sourceTitle } = p;
  const quote = { text: range.text, sourceId, sourceTitle };
  const mine = userHighlightsIn(p.highlights, range);
  const covered = p.highlights.some((h) => h.start < range.end && h.end > range.start);
  const colors = new Set(mine.map((h) => h.color));
  const active = mine.length && colors.size === 1 ? mine[0]!.color : null;
  const annotated = mine.some((h) => h.note);
  return [
    [
      { id: "rd.ask", label: t("reader.ask"), icon: MessagesSquare, onSelect: () => askInChat(quote) },
      {
        id: "rd.explain",
        label: t("reader.explain"),
        icon: Lightbulb,
        onSelect: () => p.openToolbar("explain"),
      },
    ],
    [
      {
        id: "rd.highlight",
        label: t(mine.length ? "menu.changeColor" : "menu.highlight"),
        icon: Highlighter,
        items: HIGHLIGHT_COLORS.map((c) => ({
          id: `rd.color.${c}`,
          label: t(`reader.color_${c}`),
          swatch: `hl-${c}`,
          checked: active === c,
          onSelect: () => void highlightRange(sourceId, range, p.highlights, c),
        })),
      },
      {
        id: "rd.annotate",
        label: t(annotated ? "menu.editAnnotation" : "menu.annotate"),
        icon: MessageSquarePlus,
        onSelect: () => p.openToolbar("annotate"),
      },
      ...(covered
        ? [
            {
              id: "rd.clear",
              label: t("reader.removeHighlight"),
              icon: Eraser,
              danger: true,
              onSelect: () => void clearRange(sourceId, range, p.highlights),
            },
          ]
        : []),
    ],
    [
      {
        id: "rd.card",
        label: t("reader.toCard"),
        icon: BookmarkPlus,
        onSelect: () => void saveQuoteAsCard(p.notebookId, quote),
      },
      {
        id: "rd.copy",
        label: t("common.copy"),
        icon: Copy,
        shortcut: "Mod+C",
        onSelect: () => copyText(range.text),
      },
      {
        id: "rd.copyQuote",
        label: t("menu.copyAsQuote"),
        icon: Quote,
        onSelect: () => copyText(`> ${range.text.replace(/\n+/g, " ")}\n\n— ${sourceTitle}`, true),
      },
      { id: "rd.search", label: t("menu.webSearch"), icon: Globe, onSelect: () => searchWeb(range.text) },
    ],
  ];
}
