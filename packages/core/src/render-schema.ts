/** 渲染规则与卡片模板（schema.ts 与 card.ts 共用，单独成文件避免循环引用）。 */
import { z } from "zod";

export const RuleScope = z.enum(["chat", "note", "artifact", "lorebook"]);
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
