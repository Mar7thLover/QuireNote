import { isChinese } from "../text";
import type { Passage } from "../types";
import { cosine } from "./embedding";
import { inDocumentOrder, passageSentences, rankByQuery } from "./rank";

export interface LocalAnswerOptions {
  /** 最多摘录的句子数。 */
  maxSentences?: number;
}

/**
 * 抽取式回答：从编号片段中挑出与问题最相关的句子，按原文顺序组织成要点，每条带 [n] 引用。
 * 不做推理、不编造内容。返回分段数组，便于流式逐段输出。
 */
export function localAnswerSegments(
  question: string,
  passages: Passage[],
  opts: LocalAnswerOptions = {},
): string[] {
  const zh = isChinese(question) || (!question.trim() && passages.some((p) => isChinese(p.text)));
  if (!passages.length) {
    return [
      zh
        ? "在已勾选的资料中没有找到与问题相关的内容。请勾选更多资料，或换个问法再试。"
        : "I couldn't find anything relevant in the selected sources. Try selecting more sources or rephrasing.",
    ];
  }
  const max = opts.maxSentences ?? 4;
  const ranked = rankByQuery(question, passageSentences(passages));
  const picked: typeof ranked = [];
  const perPassage = new Map<number, number>();
  for (const r of ranked) {
    if (picked.length >= max) break;
    if (picked.length > 0 && (r.score < 0.12 || r.score < 0.5 * ranked[0]!.score)) break;
    const used = perPassage.get(r.item.n) ?? 0;
    if (used >= 2) continue;
    if (picked.some((p) => cosine(p.item.vec, r.item.vec) > 0.85)) continue;
    picked.push(r);
    perPassage.set(r.item.n, used + 1);
  }
  if (!picked.length) {
    // 资料里没有可用句子（例如全是标题）：退回到第一个片段的开头。
    const p = passages[0]!;
    return [`${p.text.trim().slice(0, 160)} [${p.n}]`];
  }
  const ordered = inDocumentOrder(picked.map((p) => p.item));
  const segments: string[] = [zh ? "根据所选资料：\n\n" : "Based on the selected sources:\n\n"];
  ordered.forEach((s, i) => {
    const sentence = s.clean.replace(/\s+/g, " ").trim();
    segments.push(`${i + 1}. ${sentence} [${s.n}]\n`);
  });
  segments.push(
    zh
      ? "\n> 以上内容由内置 local 模型从资料中直接摘录，未经推理。配置 Claude / OpenAI / Gemini 等模型可获得完整回答。"
      : "\n> Extracted verbatim by the built-in local model. Configure a real chat model for full answers.",
  );
  return segments;
}

export function localAnswer(question: string, passages: Passage[], opts?: LocalAnswerOptions): string {
  return localAnswerSegments(question, passages, opts).join("");
}

/** 把整段文本切成小块逐段 yield，模拟真实模型的流式输出。 */
export async function* streamSegments(segments: string[], chunkSize = 12): AsyncGenerator<string> {
  for (const seg of segments) {
    const chars = Array.from(seg);
    for (let i = 0; i < chars.length; i += chunkSize) {
      yield chars.slice(i, i + chunkSize).join("");
      await new Promise<void>((r) => setImmediate(r));
    }
  }
}
