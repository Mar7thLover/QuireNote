import { embedMany } from "ai";
import { embeddingModel, errorMessage } from "./sdk";
import { AiError, type ModelRef } from "./types";
import { reportUsage } from "./usage";

/** 批量 Embedding。返回与输入等长的向量数组。 */
export async function embedTexts(
  ref: ModelRef,
  texts: string[],
  abortSignal?: AbortSignal,
): Promise<number[][]> {
  if (!texts.length) return [];
  const model = embeddingModel(ref.provider, ref.model);
  try {
    const out: number[][] = [];
    // 分批，避免超过各家单次上限。
    const batch = 64;
    for (let i = 0; i < texts.length; i += batch) {
      const res = await embedMany({ model, values: texts.slice(i, i + batch), abortSignal, maxRetries: 2 });
      out.push(...res.embeddings);
      reportUsage(ref, "embedding", { inputTokens: res.usage?.tokens ?? 0 });
    }
    return out;
  } catch (err) {
    throw new AiError(`Embedding 失败：${errorMessage(err)}`);
  }
}

/** 模型的唯一键，用于区分不同模型产生的向量。 */
export function embeddingKey(ref: ModelRef): string {
  return `${ref.provider.id}:${ref.model}`;
}
