import { z } from "zod";

/** 通用字段：所有条目预留 ownerId，便于以后切到多用户。 */
const base = {
  id: z.string(),
  ownerId: z.string().default("local"),
  createdAt: z.string(),
  updatedAt: z.string(),
};

/** 自定义属性值（数据库视图用）。 */
export const PropValue = z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]);
export type PropValue = z.infer<typeof PropValue>;
export const Props = z.record(z.string(), PropValue);
export type Props = z.infer<typeof Props>;

// ───────────── Notebook ─────────────
export const Notebook = z.object({
  ...base,
  title: z.string().min(1).max(200),
  description: z.string().default(""),
  icon: z.string().default("📓"),
  color: z.string().default("indigo"),
  pinned: z.boolean().default(false),
  /** 列表展示用的统计，服务端计算后带回。 */
  stats: z
    .object({ sources: z.number(), notes: z.number(), artifacts: z.number(), elements: z.number() })
    .optional(),
});
export type Notebook = z.infer<typeof Notebook>;
export const NotebookInput = Notebook.pick({
  title: true,
  description: true,
  icon: true,
  color: true,
}).partial({
  description: true,
  icon: true,
  color: true,
});
export type NotebookInput = z.infer<typeof NotebookInput>;

// ───────────── Source ─────────────
export const SourceKind = z.enum([
  "pdf",
  "url",
  "text",
  "markdown",
  "docx",
  "epub",
  "image",
  "audio",
  "video",
  "youtube",
  "search",
]);
export type SourceKind = z.infer<typeof SourceKind>;

export const SourceStatus = z.enum(["pending", "processing", "ready", "error"]);
export type SourceStatus = z.infer<typeof SourceStatus>;

export const Source = z.object({
  ...base,
  notebookId: z.string(),
  kind: SourceKind,
  title: z.string(),
  status: SourceStatus,
  error: z.string().nullable().default(null),
  /** 是否参与对话检索（勾选状态）。 */
  selected: z.boolean().default(true),
  url: z.string().nullable().default(null),
  mime: z.string().nullable().default(null),
  size: z.number().default(0),
  pageCount: z.number().nullable().default(null),
  charCount: z.number().default(0),
  summary: z.string().default(""),
  /** 原始文件是否可下载 / 对照显示。 */
  hasFile: z.boolean().default(false),
  props: Props.default({}),
});
export type Source = z.infer<typeof Source>;

/** 解析后的全文 + 页偏移，用于阅读器和跳转高亮。 */
export const SourceContent = z.object({
  sourceId: z.string(),
  text: z.string(),
  /** 每页起始字符偏移；非分页资料为 [0]。 */
  pageOffsets: z.array(z.number()),
  highlights: z.array(
    z.object({
      id: z.string(),
      start: z.number(),
      end: z.number(),
      color: z.string(),
      note: z.string().default(""),
      by: z.enum(["user", "ai"]),
    }),
  ),
});
export type SourceContent = z.infer<typeof SourceContent>;

export const Chunk = z.object({
  id: z.string(),
  sourceId: z.string(),
  notebookId: z.string(),
  index: z.number(),
  text: z.string(),
  start: z.number(),
  end: z.number(),
  page: z.number().nullable(),
  heading: z.string().nullable(),
});
export type Chunk = z.infer<typeof Chunk>;

// ───────────── Citation / Chat ─────────────
export const Citation = z.object({
  /** 回答里出现的编号 [n]。 */
  n: z.number().int().positive(),
  chunkId: z.string(),
  sourceId: z.string(),
  sourceTitle: z.string(),
  quote: z.string(),
  start: z.number(),
  end: z.number(),
  page: z.number().nullable(),
});
export type Citation = z.infer<typeof Citation>;

export const MessageRole = z.enum(["user", "assistant", "system"]);
export const Message = z.object({
  id: z.string(),
  conversationId: z.string(),
  /** 父消息，构成树：同一 parent 的多个子节点即分支。 */
  parentId: z.string().nullable(),
  role: MessageRole,
  content: z.string(),
  citations: z.array(Citation).default([]),
  model: z.string().nullable().default(null),
  status: z.enum(["done", "streaming", "error"]).default("done"),
  createdAt: z.string(),
});
export type Message = z.infer<typeof Message>;

export const Conversation = z.object({
  ...base,
  notebookId: z.string(),
  title: z.string(),
  /** 当前显示的叶子节点，决定可见分支。 */
  activeLeafId: z.string().nullable(),
});
export type Conversation = z.infer<typeof Conversation>;

// ───────────── Note ─────────────
export const NoteOrigin = z.object({
  type: z.enum(["manual", "chat", "source", "studio", "agent"]),
  refId: z.string().nullable().default(null),
  sourceId: z.string().nullable().default(null),
});
export const Note = z.object({
  ...base,
  notebookId: z.string(),
  title: z.string(),
  /** Tiptap JSON 文档；为 null 时编辑器从 markdown 构建。 */
  doc: z.unknown().nullable().default(null),
  /** Markdown 表示：搜索、导出、Agent 改动和卡片预览都用它。 */
  markdown: z.string().default(""),
  kind: z.enum(["note", "card"]).default("note"),
  tags: z.array(z.string()).default([]),
  pinned: z.boolean().default(false),
  origin: NoteOrigin.default({ type: "manual", refId: null, sourceId: null }),
  props: Props.default({}),
});
export type Note = z.infer<typeof Note>;
export const NoteInput = z.object({
  title: z.string(),
  doc: z.unknown().nullable().optional(),
  markdown: z.string().optional(),
  kind: z.enum(["note", "card"]).optional(),
  tags: z.array(z.string()).optional(),
  pinned: z.boolean().optional(),
  origin: NoteOrigin.optional(),
  props: Props.optional(),
});
export type NoteInput = z.infer<typeof NoteInput>;

// ───────────── Studio Artifact ─────────────
export const ArtifactKind = z.enum([
  "report",
  "briefing",
  "study_guide",
  "faq",
  "timeline",
  "mindmap",
  "flashcards",
  "quiz",
  "table",
  "infographic",
  "slides",
  "audio",
  "video",
  "image",
]);
export type ArtifactKind = z.infer<typeof ArtifactKind>;

export const MindmapNode = z.object({
  id: z.string(),
  label: z.string(),
  note: z.string().default(""),
  parentId: z.string().nullable(),
  collapsed: z.boolean().default(false),
});
export type MindmapNode = z.infer<typeof MindmapNode>;

export const Flashcard = z.object({
  id: z.string(),
  front: z.string(),
  back: z.string(),
  elementId: z.string().nullable().default(null),
});
export const QuizQuestion = z.object({
  id: z.string(),
  question: z.string(),
  options: z.array(z.string()),
  answer: z.number().int(),
  explanation: z.string().default(""),
});
export const TimelineEvent = z.object({
  id: z.string(),
  date: z.string(),
  title: z.string(),
  detail: z.string().default(""),
});
export const TableData = z.object({
  columns: z.array(
    z.object({ id: z.string(), name: z.string(), type: z.enum(["text", "number", "date"]).default("text") }),
  ),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))),
});
export const Slide = z.object({
  id: z.string(),
  title: z.string(),
  bullets: z.array(z.string()),
  notes: z.string().default(""),
  image: z.string().nullable().default(null),
});
export const PodcastLine = z.object({ speaker: z.enum(["A", "B"]), text: z.string() });

/** 各类生成物的结构化数据。文本类统一用 markdown。 */
export const ArtifactData = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("markdown"), markdown: z.string() }),
  z.object({ kind: z.literal("mindmap"), nodes: z.array(MindmapNode) }),
  z.object({ kind: z.literal("flashcards"), cards: z.array(Flashcard) }),
  z.object({ kind: z.literal("quiz"), questions: z.array(QuizQuestion) }),
  z.object({ kind: z.literal("timeline"), events: z.array(TimelineEvent) }),
  z.object({ kind: z.literal("table"), table: TableData }),
  z.object({ kind: z.literal("slides"), slides: z.array(Slide) }),
  z.object({ kind: z.literal("audio"), script: z.array(PodcastLine), audioUrl: z.string().nullable() }),
  z.object({ kind: z.literal("video"), slides: z.array(Slide), videoUrl: z.string().nullable() }),
  z.object({ kind: z.literal("image"), prompt: z.string(), imageUrl: z.string().nullable() }),
]);
export type ArtifactData = z.infer<typeof ArtifactData>;

export const Artifact = z.object({
  ...base,
  notebookId: z.string(),
  kind: ArtifactKind,
  title: z.string(),
  status: z.enum(["pending", "generating", "ready", "error"]),
  error: z.string().nullable().default(null),
  sourceIds: z.array(z.string()).default([]),
  data: ArtifactData.nullable(),
  props: Props.default({}),
});
export type Artifact = z.infer<typeof Artifact>;

// ───────────── Element ─────────────
export const ElementType = z.enum([
  "concept",
  "term",
  "person",
  "event",
  "date",
  "data",
  "claim",
  "formula",
  "question",
]);
export type ElementType = z.infer<typeof ElementType>;

export const ElementRef = z.object({
  sourceId: z.string().nullable(),
  chunkId: z.string().nullable(),
  noteId: z.string().nullable().default(null),
  messageId: z.string().nullable().default(null),
  quote: z.string(),
});
export const Element = z.object({
  ...base,
  notebookId: z.string(),
  type: ElementType,
  name: z.string(),
  definition: z.string().default(""),
  aliases: z.array(z.string()).default([]),
  refs: z.array(ElementRef).default([]),
  /** 关联元素 id + 关系描述。 */
  relations: z.array(z.object({ targetId: z.string(), label: z.string() })).default([]),
  /** 0–1 掌握度，由复习记录计算。 */
  mastery: z.number().min(0).max(1).default(0),
  props: Props.default({}),
});
export type Element = z.infer<typeof Element>;

// ───────────── Review (FSRS) ─────────────
export const ReviewCard = z.object({
  id: z.string(),
  notebookId: z.string(),
  front: z.string(),
  back: z.string(),
  elementId: z.string().nullable(),
  artifactId: z.string().nullable(),
  due: z.string(),
  stability: z.number(),
  difficulty: z.number(),
  reps: z.number(),
  lapses: z.number(),
  state: z.number(),
  lastReview: z.string().nullable(),
});
export type ReviewCard = z.infer<typeof ReviewCard>;
export const ReviewRating = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
export type ReviewRating = z.infer<typeof ReviewRating>;

// ───────────── Providers ─────────────
export const Capability = z.enum(["chat", "embedding", "search", "tts", "stt", "image", "video"]);
export type Capability = z.infer<typeof Capability>;

export const ProviderKind = z.enum([
  "anthropic",
  "openai",
  "google",
  "ollama",
  "openai-compatible",
  "tavily",
  "brave",
  "searxng",
  "elevenlabs",
  "edge-tts",
  "fal",
  "replicate",
  "comfyui",
]);
export type ProviderKind = z.infer<typeof ProviderKind>;

export const ProviderConfig = z.object({
  id: z.string(),
  kind: ProviderKind,
  name: z.string(),
  baseUrl: z.string().nullable(),
  /** 只告诉前端有没有 Key 及末四位，绝不回传明文。 */
  hasKey: z.boolean(),
  keyHint: z.string().nullable(),
  enabled: z.boolean(),
  createdAt: z.string(),
});
export type ProviderConfig = z.infer<typeof ProviderConfig>;

export const ProviderInput = z.object({
  kind: ProviderKind,
  name: z.string().min(1),
  baseUrl: z.string().nullable().optional(),
  apiKey: z.string().optional(),
  enabled: z.boolean().optional(),
});
export type ProviderInput = z.infer<typeof ProviderInput>;

export const ModelAssignment = z.object({
  capability: Capability,
  providerId: z.string(),
  model: z.string(),
});
export type ModelAssignment = z.infer<typeof ModelAssignment>;

// ───────────── Jobs ─────────────
export const Job = z.object({
  id: z.string(),
  type: z.string(),
  status: z.enum(["queued", "running", "done", "error"]),
  progress: z.number().min(0).max(1),
  message: z.string(),
  refId: z.string().nullable(),
  notebookId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Job = z.infer<typeof Job>;

// ───────────── Database views ─────────────
export const EntityType = z.enum(["note", "source", "artifact", "element"]);
export type EntityType = z.infer<typeof EntityType>;
export const PropertyType = z.enum(["text", "number", "select", "multi_select", "date", "checkbox", "url"]);
export type PropertyType = z.infer<typeof PropertyType>;
export const PropertyDef = z.object({
  id: z.string(),
  notebookId: z.string(),
  entity: EntityType,
  name: z.string(),
  type: PropertyType,
  options: z.array(z.object({ value: z.string(), color: z.string() })).default([]),
});
export type PropertyDef = z.infer<typeof PropertyDef>;

export const FilterOp = z.enum(["eq", "neq", "contains", "gt", "lt", "empty", "not_empty"]);
export const DbView = z.object({
  id: z.string(),
  notebookId: z.string(),
  entity: EntityType,
  name: z.string(),
  layout: z.enum(["table", "board", "gallery", "calendar"]),
  filters: z.array(z.object({ field: z.string(), op: FilterOp, value: PropValue })).default([]),
  sorts: z.array(z.object({ field: z.string(), dir: z.enum(["asc", "desc"]) })).default([]),
  groupBy: z.string().nullable().default(null),
  dateField: z.string().nullable().default(null),
  hidden: z.array(z.string()).default([]),
});
export type DbView = z.infer<typeof DbView>;

// ───────────── Rendering (rules + templates + theme) ─────────────
export const RuleScope = z.enum(["chat", "note", "artifact"]);
export type RuleScope = z.infer<typeof RuleScope>;
export const RenderRule = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  pattern: z.string(),
  flags: z.string().default("g"),
  /** 替换为模板组件（templateId），或纯文本替换（replacement，支持 $1）。 */
  templateId: z.string().nullable(),
  replacement: z.string().default(""),
  /** 捕获组 → 模板变量名映射，例如 { "1": "term" }。 */
  slots: z.record(z.string(), z.string()).default({}),
  scopes: z.array(RuleScope),
  order: z.number(),
});
export type RenderRule = z.infer<typeof RenderRule>;

export const CardTemplate = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(""),
  html: z.string(),
  css: z.string(),
  /** 变量插槽及其示例值，用于编辑器预览。 */
  slots: z.array(z.object({ name: z.string(), sample: z.string() })),
  builtin: z.boolean().default(false),
});
export type CardTemplate = z.infer<typeof CardTemplate>;

export const ThemeSettings = z.object({
  mode: z.enum(["light", "dark", "system"]),
  accent: z.string(),
  fontSans: z.string(),
  fontSerif: z.string(),
  fontMono: z.string(),
  radius: z.number().min(0).max(24),
  density: z.enum(["compact", "comfortable", "spacious"]),
  background: z.object({
    type: z.enum(["none", "gradient", "image", "aurora"]),
    value: z.string(),
    opacity: z.number().min(0).max(1),
  }),
});
export type ThemeSettings = z.infer<typeof ThemeSettings>;

/** .folio-theme 文件内容。 */
export const FolioTheme = z.object({
  format: z.literal("folio-theme"),
  version: z.literal(1),
  name: z.string(),
  author: z.string().default(""),
  theme: ThemeSettings.partial().optional(),
  templates: z.array(CardTemplate).default([]),
  rules: z.array(RenderRule).default([]),
});
export type FolioTheme = z.infer<typeof FolioTheme>;

// ───────────── Agent diff ─────────────
/** Agent 提出的一组改动；用户确认后才落库。 */
export const AgentOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("create_note"), title: z.string(), markdown: z.string() }),
  z.object({
    op: z.literal("update_note"),
    noteId: z.string(),
    title: z.string().optional(),
    markdown: z.string(),
  }),
  z.object({ op: z.literal("delete_note"), noteId: z.string() }),
  z.object({
    op: z.literal("create_table"),
    title: z.string(),
    table: TableData,
  }),
  z.object({
    op: z.literal("add_mindmap_node"),
    artifactId: z.string(),
    parentId: z.string(),
    label: z.string(),
  }),
  z.object({ op: z.literal("create_element"), type: ElementType, name: z.string(), definition: z.string() }),
]);
export type AgentOp = z.infer<typeof AgentOp>;
export const AgentProposal = z.object({
  id: z.string(),
  summary: z.string(),
  ops: z.array(AgentOp),
});
export type AgentProposal = z.infer<typeof AgentProposal>;

export type Flashcard = z.infer<typeof Flashcard>;
export type QuizQuestion = z.infer<typeof QuizQuestion>;
export type TimelineEvent = z.infer<typeof TimelineEvent>;
export type TableData = z.infer<typeof TableData>;
export type Slide = z.infer<typeof Slide>;
export type PodcastLine = z.infer<typeof PodcastLine>;
