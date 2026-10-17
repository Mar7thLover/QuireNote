import { customAlphabet } from "nanoid";
import type { ArtifactKind, ElementType, SourceKind } from "./schema";

const alphabet = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 14);

/** 带前缀的短 id，例如 `nb_x8k2...`，日志里一眼能看出类型。 */
export function newId(prefix: string): string {
  return `${prefix}_${alphabet()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export interface CitationMarker {
  n: number;
  /** 在文本中的位置，便于前端替换成可点击徽标。 */
  index: number;
  length: number;
}

/**
 * 解析回答中的引用编号，支持 `[1]`、`[1, 3]`、`[2][4]` 等写法。
 * 代码块内的方括号不计入。
 */
export function parseCitationMarkers(text: string): CitationMarker[] {
  const out: CitationMarker[] = [];
  const fence = /```[\s\S]*?```|`[^`\n]*`/g;
  const masked = text.replace(fence, (m) => " ".repeat(m.length));
  const re = /\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g;
  for (const m of masked.matchAll(re)) {
    const nums = m[1]!.split(",").map((s) => Number.parseInt(s.trim(), 10));
    for (const n of nums) {
      if (n > 0) out.push({ n, index: m.index, length: m[0].length });
    }
  }
  return out;
}

/** 回答中实际使用的引用编号（去重、保序）。 */
export function usedCitationNumbers(text: string): number[] {
  const seen = new Set<number>();
  for (const m of parseCitationMarkers(text)) seen.add(m.n);
  return [...seen];
}

export const SOURCE_KIND_META: Record<SourceKind, { label: string; labelEn: string; icon: string }> = {
  pdf: { label: "PDF", labelEn: "PDF", icon: "file-text" },
  url: { label: "网页", labelEn: "Web page", icon: "globe" },
  text: { label: "文本", labelEn: "Text", icon: "type" },
  markdown: { label: "Markdown", labelEn: "Markdown", icon: "file-code" },
  docx: { label: "Word", labelEn: "Word", icon: "file-type" },
  epub: { label: "EPUB", labelEn: "EPUB", icon: "book-open" },
  image: { label: "图片", labelEn: "Image", icon: "image" },
  audio: { label: "音频", labelEn: "Audio", icon: "audio-lines" },
  video: { label: "视频", labelEn: "Video", icon: "video" },
  youtube: { label: "YouTube", labelEn: "YouTube", icon: "youtube" },
  search: { label: "搜索结果", labelEn: "Search", icon: "search" },
};

export const ARTIFACT_KIND_META: Record<
  ArtifactKind,
  { label: string; labelEn: string; icon: string; group: "text" | "visual" | "learn" | "media" }
> = {
  report: { label: "报告", labelEn: "Report", icon: "file-text", group: "text" },
  briefing: { label: "简报", labelEn: "Briefing", icon: "newspaper", group: "text" },
  study_guide: { label: "学习指南", labelEn: "Study guide", icon: "graduation-cap", group: "learn" },
  faq: { label: "FAQ", labelEn: "FAQ", icon: "message-circle-question", group: "text" },
  timeline: { label: "时间线", labelEn: "Timeline", icon: "milestone", group: "visual" },
  mindmap: { label: "思维导图", labelEn: "Mind map", icon: "network", group: "visual" },
  flashcards: { label: "闪卡", labelEn: "Flashcards", icon: "layers", group: "learn" },
  quiz: { label: "测验", labelEn: "Quiz", icon: "list-checks", group: "learn" },
  table: { label: "数据表格", labelEn: "Data table", icon: "table", group: "visual" },
  infographic: { label: "信息图", labelEn: "Infographic", icon: "chart-pie", group: "visual" },
  slides: { label: "幻灯片", labelEn: "Slides", icon: "presentation", group: "visual" },
  audio: { label: "音频概览", labelEn: "Audio overview", icon: "podcast", group: "media" },
  video: { label: "视频概览", labelEn: "Video overview", icon: "clapperboard", group: "media" },
  image: { label: "配图", labelEn: "Image", icon: "image", group: "media" },
};

export const ELEMENT_TYPE_META: Record<ElementType, { label: string; labelEn: string; color: string }> = {
  concept: { label: "概念", labelEn: "Concept", color: "indigo" },
  term: { label: "术语", labelEn: "Term", color: "violet" },
  person: { label: "人物", labelEn: "Person", color: "amber" },
  event: { label: "事件", labelEn: "Event", color: "rose" },
  date: { label: "日期", labelEn: "Date", color: "orange" },
  data: { label: "数据", labelEn: "Data", color: "emerald" },
  claim: { label: "论点", labelEn: "Claim", color: "sky" },
  formula: { label: "公式", labelEn: "Formula", color: "teal" },
  question: { label: "待解决问题", labelEn: "Open question", color: "fuchsia" },
};

/** 文本类生成物（统一用 markdown 数据）。 */
export const MARKDOWN_ARTIFACTS: ArtifactKind[] = ["report", "briefing", "study_guide", "faq", "infographic"];

/**
 * 笔记的纯文本摘要（列表预览、卡片简介）：去掉代码块、图片与资源引用、HTML、提示块标记和标题行，
 * 链接只留文字。全是标题时退回用标题文字。
 */
export function markdownExcerpt(md: string, max = 140): string {
  const body = md
    .replace(/```[\s\S]*?```/g, "\n")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/asset:\/\/[\w.-]+/g, " ")
    .replace(/<[^>\n]+>/g, " ")
    .replace(/^\s*>\s*\[![a-z]+\][+-]?/gim, " ");
  const lines = body.split("\n").map((l) => l.replace(/^\s*(?:[-+*]|\d+[.)])\s+/, ""));
  const text = lines.filter((l) => !/^\s*#{1,6}\s/.test(l)).join(" ");
  const clean = (s: string) =>
    s
      .replace(/[#>*_`~|]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const out = clean(text) || clean(body);
  return out.length > max ? `${out.slice(0, max)}…` : out;
}
