import type { RenderRule } from "@quirenote/core";

/** 规则引擎输出的一段内容：纯文本，或者交给卡片模板渲染的 card。 */
/**
 * 原文偏移（只在 ApplyOptions.offsets 为 true 时带上）：from / to 是这段在输入文本里的范围；
 * replaced 表示文字已被纯文本替换规则改过，不再等于原文切片。
 */
export interface SegmentOffsets {
  from?: number;
  to?: number;
  replaced?: boolean;
}
export type TextSegment = { type: "text"; text: string } & SegmentOffsets;
export type CardSegment = {
  type: "card";
  templateId: string;
  /** 模板变量（由捕获组经 slots / 命名组映射而来，已去掉首尾空白）。 */
  vars: Record<string, string>;
  /** 被替换掉的原文，便于"复制原文"或降级显示。 */
  raw: string;
  /** 产出该卡片的规则 id。 */
  ruleId: string;
} & SegmentOffsets;
export type Segment = TextSegment | CardSegment;

export type RuleErrorKind = "invalid-pattern" | "timeout" | "worker-error";

export interface RuleError {
  ruleId: string;
  ruleName: string;
  kind: RuleErrorKind;
  message: string;
}

export interface RenderResult {
  segments: Segment[];
  /** 被跳过的规则及原因；有错误不影响其他规则继续执行。 */
  errors: RuleError[];
}

export interface ApplyOptions {
  /** 只执行 scopes 中包含该作用域的规则；不传则执行全部启用的规则。 */
  scope?: RenderRule["scopes"][number];
  /** 在分段上带原文偏移（编辑器把匹配映射回文档位置时用）。 */
  offsets?: boolean;
}

/** 单个匹配的可序列化描述（worker 与主线程之间传递）。 */
export interface MatchInfo {
  index: number;
  match: string;
  /** 编号捕获组 $1..$n，未参与匹配的组为 null。 */
  groups: (string | null)[];
  /** 命名捕获组，没有则为 null。 */
  named: Record<string, string | null> | null;
}

export interface MatchRequest {
  id: number;
  pattern: string;
  flags: string;
  texts: string[];
}

export type MatchOutcome = { ok: true; results: MatchInfo[][] } | { ok: false; error: string };

export type MatchResponse = MatchOutcome & { id: number };
