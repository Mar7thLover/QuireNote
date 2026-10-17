/**
 * Quire 卡（quire_card_v1）：笔记 / Notebook、资源、渲染包、知识书打包成一个文件。
 * 字段与语义见 docs/CARD_SPEC.md。知识书字段沿用规格里的 snake_case，与卡片文件一致，省去转换层。
 */
import { z } from "zod";
import { patchOf } from "./patch";
import { CardTemplate, RenderRule } from "./render-schema";

export const QUIRE_CARD_SPEC = "quire_card_v1";
export const QUIRE_CARD_VERSION = "1.1";

const Extensions = z.record(z.string(), z.unknown());

// ───────────── 资源 ─────────────

export const AssetType = z.string().min(1).max(40);
export const Asset = z.object({
  /** 形如 `ast_xxx.png`：带扩展名，正文里写 `asset://<id>`，看 id 就知道是图片还是视频。 */
  id: z.string(),
  notebookId: z.string(),
  name: z.string(),
  mime: z.string(),
  size: z.number(),
  sha256: z.string(),
  createdAt: z.string(),
});
export type Asset = z.infer<typeof Asset>;

// ───────────── 知识书 ─────────────

export const LoreLogic = z.enum(["and_any", "and_all", "not_any", "not_all"]);
export type LoreLogic = z.infer<typeof LoreLogic>;
export const LorePosition = z.enum(["before_sources", "after_sources", "at_depth"]);
export type LorePosition = z.infer<typeof LorePosition>;
export const LoreRole = z.enum(["system", "user", "assistant"]);
export type LoreRole = z.infer<typeof LoreRole>;

/** 一条知识书条目（卡片里与数据库里同一个形状，数据库另外记 notebookId 与时间）。 */
export const LoreEntryFields = z.object({
  name: z.string().max(200).default(""),
  keys: z.array(z.string().max(500)).max(200).default([]),
  secondary_keys: z.array(z.string().max(500)).max(200).default([]),
  logic: LoreLogic.default("and_any"),
  content: z.string().max(100_000).default(""),
  constant: z.boolean().default(false),
  enabled: z.boolean().default(true),
  order: z.number().default(100),
  priority: z.number().default(100),
  position: LorePosition.default("after_sources"),
  depth: z.number().int().min(0).max(1000).default(4),
  role: LoreRole.default("system"),
  probability: z.number().min(0).max(100).default(100),
  group: z.string().max(200).default(""),
  group_weight: z.number().min(0).default(100),
  sticky: z.number().int().min(0).nullable().default(null),
  cooldown: z.number().int().min(0).nullable().default(null),
  delay: z.number().int().min(0).nullable().default(null),
  prevent_recursion: z.boolean().default(false),
  exclude_recursion: z.boolean().default(false),
  scan_depth: z.number().int().min(0).max(100).nullable().default(null),
  case_sensitive: z.boolean().nullable().default(null),
  match_whole_words: z.boolean().nullable().default(null),
  comment: z.string().max(5000).default(""),
  extensions: Extensions.default({}),
});
export type LoreEntryFields = z.infer<typeof LoreEntryFields>;
export const LoreEntryInput = patchOf(LoreEntryFields);
export type LoreEntryInput = z.infer<typeof LoreEntryInput>;

export const LoreEntry = LoreEntryFields.extend({
  id: z.string(),
  notebookId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type LoreEntry = z.infer<typeof LoreEntry>;

/** 整本知识书的设置（存在 Notebook 上）。 */
export const LorebookSettings = z.object({
  name: z.string().max(200).default(""),
  description: z.string().max(5000).default(""),
  enabled: z.boolean().default(true),
  scan_depth: z.number().int().min(0).max(100).default(4),
  token_budget: z.number().int().min(0).max(200_000).default(2000),
  recursive: z.boolean().default(false),
  max_recursion: z.number().int().min(1).max(10).default(3),
  case_sensitive: z.boolean().default(false),
  match_whole_words: z.boolean().default(false),
  extensions: Extensions.default({}),
});
export type LorebookSettings = z.infer<typeof LorebookSettings>;
export const DEFAULT_LOREBOOK: LorebookSettings = LorebookSettings.parse({});
export const LorebookSettingsPatch = patchOf(LorebookSettings);
export type LorebookSettingsPatch = z.infer<typeof LorebookSettingsPatch>;

export const CardLoreEntry = LoreEntryFields.extend({ id: z.string() });
export type CardLoreEntry = z.infer<typeof CardLoreEntry>;
export const CardLorebook = LorebookSettings.extend({
  entries: z.array(CardLoreEntry).max(5000).default([]),
});
export type CardLorebook = z.infer<typeof CardLorebook>;

/** 某轮对话实际用到的知识书条目（记在助手消息上）。 */
export const UsedLore = z.object({
  id: z.string(),
  name: z.string(),
  /** 这一轮为什么插入；sticky 的保持不算新的触发，计时从上一次真正触发算起。 */
  trigger: z.enum(["constant", "direct", "recursive", "sticky"]).optional(),
});
export type UsedLore = z.infer<typeof UsedLore>;

// ───────────── 渲染包 ─────────────

export const RenderPack = z.object({
  rules: z.array(RenderRule).max(500).default([]),
  templates: z.array(CardTemplate).max(500).default([]),
  /** 卡片模板配色（accent、radius、字体等），只影响这张卡里的卡片模板。 */
  theme: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});
export type RenderPack = z.infer<typeof RenderPack>;

// ───────────── 卡片 ─────────────

export const CardAsset = z.object({
  id: z.string().min(1).max(200),
  /** image / video / audio / font / cover，自定义类型以 x_ 开头。 */
  type: AssetType,
  name: z.string().max(300).default(""),
  mime: z.string().max(200).default("application/octet-stream"),
  /** embedded://assets/…（压缩包内）、data: URL（内联）或 https:// 外链。 */
  uri: z.string(),
  size: z.number().optional(),
  sha256: z.string().optional(),
});
export type CardAsset = z.infer<typeof CardAsset>;

export const CardNote = z.object({
  id: z.string(),
  title: z.string().max(500).default(""),
  markdown: z.string().max(5_000_000).default(""),
  tags: z.array(z.string()).default([]),
  kind: z.enum(["note", "card"]).default("note"),
});
export type CardNote = z.infer<typeof CardNote>;

export const CardHighlight = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  color: z.string().max(40).default("yellow"),
  note: z.string().max(20_000).default(""),
});
export type CardHighlight = z.infer<typeof CardHighlight>;

/** 资料：解析后的全文、页码与高亮；`.quire` 压缩包里还带原始文件（PDF、DOCX、音视频……）。 */
export const CardSource = z.object({
  id: z.string(),
  title: z.string().max(500),
  kind: z.string().default("text"),
  url: z.string().nullable().default(null),
  text: z.string(),
  summary: z.string().max(20_000).default(""),
  /** 每页起始字符偏移；不分页的资料为 [0]。 */
  page_offsets: z.array(z.number().int().min(0)).default([0]),
  highlights: z.array(CardHighlight).max(10_000).default([]),
  /** 原始文件对应的资源 id（资源类型为 `source`）；JSON 与 PNG 卡不带原始文件。 */
  file: z.string().nullable().default(null),
  mime: z.string().nullable().default(null),
  /** 导入后是否默认勾选参与对话。 */
  selected: z.boolean().default(true),
});
export type CardSource = z.infer<typeof CardSource>;

/** Studio 生成物：`data` 与 QuireNote 的 ArtifactData 同形（报告、思维导图、测验……）；媒体用 `asset://<id>` 引用。 */
export const CardArtifact = z.object({
  id: z.string(),
  kind: z.string().min(1).max(40),
  title: z.string().max(500).default(""),
  data: z.unknown(),
  source_ids: z.array(z.string()).default([]),
  instructions: z.string().max(20_000).default(""),
});
export type CardArtifact = z.infer<typeof CardArtifact>;

/** 元素：概念、术语、人物等，带出处。 */
export const CardElement = z.object({
  id: z.string(),
  type: z.string().min(1).max(40),
  name: z.string().min(1).max(500),
  definition: z.string().max(50_000).default(""),
  aliases: z.array(z.string().max(500)).max(200).default([]),
  refs: z
    .array(
      z.object({
        source_id: z.string().nullable().default(null),
        note_id: z.string().nullable().default(null),
        quote: z.string().max(5000).default(""),
      }),
    )
    .max(200)
    .default([]),
  relations: z
    .array(z.object({ target_id: z.string(), label: z.string().max(200) }))
    .max(200)
    .default([]),
});
export type CardElement = z.infer<typeof CardElement>;

/** 复习卡：只带正反面，导入后从头开始复习。 */
export const CardReviewCard = z.object({
  front: z.string().max(20_000),
  back: z.string().max(20_000),
  element_id: z.string().nullable().default(null),
  artifact_id: z.string().nullable().default(null),
});
export type CardReviewCard = z.infer<typeof CardReviewCard>;

export const QuireCardData = z.object({
  kind: z.enum(["note", "notebook"]),
  name: z.string().min(1).max(300),
  summary: z.string().max(2000).default(""),
  creator: z.string().max(200).default(""),
  creator_notes: z.string().max(20_000).default(""),
  version: z.string().max(50).default(""),
  tags: z.array(z.string().max(100)).max(100).default([]),
  language: z.string().max(20).optional(),
  created_at: z.number().default(0),
  modified_at: z.number().default(0),
  source: z.array(z.string()).max(100).default([]),
  notebook: z
    .object({
      title: z.string().min(1).max(200),
      description: z.string().default(""),
      icon: z.string().default("📓"),
      color: z.string().default("indigo"),
    })
    .optional(),
  notes: z.array(CardNote).max(10_000).default([]),
  sources: z.array(CardSource).max(1000).default([]),
  artifacts: z.array(CardArtifact).max(1000).default([]),
  elements: z.array(CardElement).max(10_000).default([]),
  review_cards: z.array(CardReviewCard).max(20_000).default([]),
  ai_instructions: z.string().max(50_000).default(""),
  render: RenderPack.optional(),
  lorebook: CardLorebook.optional(),
  assets: z.array(CardAsset).max(5000).default([]),
  extensions: Extensions.default({}),
});
export type QuireCardData = z.infer<typeof QuireCardData>;

export const QuireCard = z.object({
  spec: z.literal(QUIRE_CARD_SPEC),
  /** 读取方遇到更高的版本不拒绝，按已知字段读取。 */
  spec_version: z.string(),
  data: QuireCardData,
});
export type QuireCard = z.infer<typeof QuireCard>;

/** 正文里的资源引用：`asset://<id>`。 */
export const ASSET_URI_RE = /asset:\/\/([A-Za-z0-9_.-]+)/g;

/** 资源 id 的扩展名决定显示方式。 */
export function mediaKindOf(src: string): "image" | "video" | "audio" | null {
  const ext = src.split(/[?#]/)[0]!.split(".").pop()?.toLowerCase() ?? "";
  if (/^(png|jpe?g|gif|webp|avif|svg|bmp)$/.test(ext)) return "image";
  if (/^(mp4|webm|mov|m4v|ogv)$/.test(ext)) return "video";
  if (/^(mp3|wav|ogg|oga|m4a|aac|flac|opus)$/.test(ext)) return "audio";
  return null;
}
