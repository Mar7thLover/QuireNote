/** 用量回报与花费估算。价格为 Anthropic 官方 API 标价（美元 / 百万 Token），其他模型不估价。 */
import type { ModelRef, UsageEvent } from "./types";

interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const p = (input: number, output: number, cacheRead = input / 10): Price => ({
  input,
  output,
  cacheRead,
  cacheWrite: input * 1.25,
});

/** 按模型 ID 前缀匹配，越具体的放越前。 */
const PRICES: [RegExp, Price][] = [
  [/claude-(fable|mythos)-5/, p(10, 50, 0.25)],
  [/claude-opus-5-5/, p(4, 20, 0.2)],
  [/claude-opus-(5|4-[5-9])/, p(5, 25)],
  [/claude-sonnet-5/, p(2, 10, 0.2)],
  [/claude-sonnet-4/, p(3, 15)],
  [/claude-haiku-5/, p(0.1, 0.5, 0.01)],
  [/claude-haiku-4/, p(1, 5)],
];

/** 联网搜索服务端工具：每千次 10 美元。 */
const SEARCH_PRICE = 10 / 1000;

export function priceOf(model: string): Price | null {
  return PRICES.find(([re]) => re.test(model))?.[1] ?? null;
}

/** 估算一组用量的花费（美元）；模型没有价目时返回 null。 */
export function estimateCost(
  model: string,
  u: Pick<UsageEvent, "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens" | "searches">,
): number | null {
  const price = priceOf(model);
  if (!price) return u.searches ? u.searches * SEARCH_PRICE : null;
  const fresh = Math.max(0, u.inputTokens - u.cacheReadTokens - u.cacheWriteTokens);
  return (
    (fresh * price.input +
      u.cacheReadTokens * price.cacheRead +
      u.cacheWriteTokens * price.cacheWrite +
      u.outputTokens * price.output) /
      1_000_000 +
    u.searches * SEARCH_PRICE
  );
}

/** AI SDK 的用量结构（各字段可能缺省）。 */
interface SdkUsage {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  inputTokenDetails?: { cacheReadTokens?: number | undefined; cacheWriteTokens?: number | undefined };
}

export function reportUsage(
  ref: ModelRef,
  kind: UsageEvent["kind"],
  usage: SdkUsage | undefined,
  searches = 0,
): void {
  const cb = ref.provider.onUsage;
  if (!cb) return;
  try {
    cb({
      providerId: ref.provider.id,
      model: ref.model,
      kind,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      cacheReadTokens: usage?.inputTokenDetails?.cacheReadTokens ?? 0,
      cacheWriteTokens: usage?.inputTokenDetails?.cacheWriteTokens ?? 0,
      searches,
    });
  } catch {
    /* 统计失败不影响调用本身 */
  }
}
