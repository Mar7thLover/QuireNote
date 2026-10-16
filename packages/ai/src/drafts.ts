import { ElementType } from "@quirenote/core";
import { z } from "zod";

/**
 * 面向模型的结构化输出 schema（"草稿"）：字段全部必填、不带 id 和默认值，
 * 兼容各家 structured output 的严格模式。服务端再把草稿转成 core 里的正式数据（补 id）。
 */

export const MindmapDraft = z.object({
  nodes: z
    .array(
      z.object({
        key: z.string().describe("节点唯一键，例如 n1、n2"),
        label: z.string().describe("节点标题，简短"),
        note: z.string().describe("补充说明，可为空字符串"),
        parentKey: z.string().nullable().describe("父节点 key，根节点为 null"),
      }),
    )
    .describe("扁平节点列表，恰好一个根节点"),
});
export type MindmapDraft = z.infer<typeof MindmapDraft>;

export const FlashcardsDraft = z.object({
  cards: z.array(z.object({ front: z.string(), back: z.string() })),
});
export type FlashcardsDraft = z.infer<typeof FlashcardsDraft>;

export const QuizDraft = z.object({
  questions: z.array(
    z.object({
      question: z.string(),
      options: z.array(z.string()).describe("2–5 个选项"),
      answer: z.number().int().describe("正确选项下标（从 0 开始）"),
      explanation: z.string(),
    }),
  ),
});
export type QuizDraft = z.infer<typeof QuizDraft>;

export const TimelineDraft = z.object({
  events: z.array(
    z.object({
      date: z.string().describe("日期或年份，如 1956、1956-08"),
      title: z.string(),
      detail: z.string(),
    }),
  ),
});
export type TimelineDraft = z.infer<typeof TimelineDraft>;

export const TableDraft = z.object({
  columns: z.array(z.object({ name: z.string(), type: z.enum(["text", "number", "date"]) })),
  rows: z.array(z.array(z.string()).describe("与 columns 一一对应的单元格")),
});
export type TableDraft = z.infer<typeof TableDraft>;

export const SlidesDraft = z.object({
  slides: z.array(z.object({ title: z.string(), bullets: z.array(z.string()), notes: z.string() })),
});
export type SlidesDraft = z.infer<typeof SlidesDraft>;

export const PodcastDraft = z.object({
  script: z.array(z.object({ speaker: z.enum(["A", "B"]), text: z.string() })),
});
export type PodcastDraft = z.infer<typeof PodcastDraft>;

export const ImagePromptDraft = z.object({ prompt: z.string() });
export type ImagePromptDraft = z.infer<typeof ImagePromptDraft>;

export const ElementsDraft = z.object({
  elements: z.array(
    z.object({
      type: ElementType,
      name: z.string(),
      definition: z.string(),
      quote: z.string().describe("资料中的原文出处，逐字摘录"),
      passage: z.number().int().describe("出处片段编号 n"),
    }),
  ),
});
export type ElementsDraft = z.infer<typeof ElementsDraft>;

export const EnrichDraft = z.object({
  definition: z.string(),
  aliases: z.array(z.string()),
  related: z.array(z.string()).describe("相关的其他概念名"),
});
export type EnrichDraft = z.infer<typeof EnrichDraft>;

export const AgentOpDraft = z.object({
  op: z.enum([
    "create_note",
    "update_note",
    "delete_note",
    "create_table",
    "add_mindmap_node",
    "create_element",
  ]),
  noteId: z.string().nullable(),
  title: z.string().nullable(),
  markdown: z.string().nullable(),
  table: z.object({ columns: z.array(z.string()), rows: z.array(z.array(z.string())) }).nullable(),
  artifactId: z.string().nullable(),
  parentId: z.string().nullable(),
  label: z.string().nullable(),
  elementType: ElementType.nullable(),
  name: z.string().nullable(),
  definition: z.string().nullable(),
});
export type AgentOpDraft = z.infer<typeof AgentOpDraft>;

export const AgentDraft = z.object({
  summary: z.string().describe("一句话说明将要做的改动"),
  ops: z.array(AgentOpDraft),
});
export type AgentDraft = z.infer<typeof AgentDraft>;

export const ResearchQueriesDraft = z.object({ queries: z.array(z.string()) });
export type ResearchQueriesDraft = z.infer<typeof ResearchQueriesDraft>;

export const HighlightsDraft = z.object({
  highlights: z.array(z.object({ quote: z.string().describe("逐字摘录的原文句子"), note: z.string() })),
});
export type HighlightsDraft = z.infer<typeof HighlightsDraft>;
