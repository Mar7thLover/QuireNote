/** 不调用模型的抽取式文本工具：资料主题名、摘要兜底（没有对话模型或调用失败时）。 */
import { aiText } from "./messages";
import { inDocumentOrder, passageSentences, pickRepresentative } from "./rank";
import { isChinese, stripMarkdown, truncate } from "./text";
import type { Passage } from "./types";

/** 由片段推断主题名：唯一资料标题、「X 等 n 份资料」或首行文字。 */
export function topicOf(passages: Passage[], fallback?: string): string {
  if (fallback?.trim()) return fallback.trim();
  const titles = [...new Set(passages.map((p) => p.title).filter((t): t is string => !!t))];
  if (titles.length === 1) return titles[0]!;
  if (titles.length > 1) return aiText().topicMany(titles[0]!, titles.length);
  const first = passages[0]?.text.split("\n").find((l) => l.trim());
  return first ? truncate(stripMarkdown(first), 30) : aiText().topicFallback;
}

/** 抽取式摘要：选出有代表性的几句原文，按原文顺序拼接。 */
export function extractiveSummary(text: string, maxSentences = 2): string {
  const sents = passageSentences([{ n: 1, text }]);
  if (!sents.length) return truncate(stripMarkdown(text), 160);
  return inDocumentOrder(pickRepresentative(sents, maxSentences))
    .map((s) => s.clean)
    .join(isChinese(text) ? "" : " ");
}
