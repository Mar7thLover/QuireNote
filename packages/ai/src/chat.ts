import { generateText, Output, streamText } from "ai";
import type { z } from "zod";
import { aiText } from "./messages";
import { errorMessage, languageModel } from "./sdk";
import { AiError, type ChatTurn, type ModelRef } from "./types";
import { reportUsage } from "./usage";

const isAnthropic = (ref: ModelRef) =>
  ref.provider.kind === "anthropic" || ref.provider.kind === "anthropic-compatible";
const EPHEMERAL = { anthropic: { cacheControl: { type: "ephemeral" as const } } };

/** Anthropic 自动缓存最后一个可缓存块：同一段对话里继续追问时，之前的部分按缓存价计费。 */
export function cacheOptions(ref: ModelRef) {
  return isAnthropic(ref) ? EPHEMERAL : undefined;
}

/**
 * 系统提示词（含资料片段）单独设一个缓存断点：新开对话、换个问题，只要资料没变也能命中缓存。
 * 其他提供方原样传字符串。
 */
function instructionsFor(ref: ModelRef, system: string, tail?: string) {
  if (!isAnthropic(ref)) return tail ? `${system}\n\n${tail}` : system;
  const head = { role: "system" as const, content: system, providerOptions: EPHEMERAL };
  return tail ? [head, { role: "system" as const, content: tail }] : head;
}

export interface ChatRequest {
  system: string;
  /** 放在缓存断点之后的系统提示（每轮会变的内容，如触发的知识书条目）。 */
  systemTail?: string;
  messages: ChatTurn[];
  abortSignal?: AbortSignal;
  /** 对话预设里的生成参数；不给时用模型默认值。 */
  temperature?: number | null;
  topP?: number | null;
  maxOutputTokens?: number | null;
}

/** 生成参数：Anthropic 较新的模型不允许同时给 temperature 和 top_p，两个都有时只用 temperature。 */
function samplingOptions(ref: ModelRef, req: ChatRequest) {
  const out: { temperature?: number; topP?: number; maxOutputTokens?: number } = {};
  if (req.temperature != null) out.temperature = req.temperature;
  if (req.topP != null && !(isAnthropic(ref) && req.temperature != null)) out.topP = req.topP;
  if (req.maxOutputTokens != null) out.maxOutputTokens = req.maxOutputTokens;
  return out;
}

/** 流式对话，逐段 yield 文本增量。出错时抛出 AiError。 */
export async function* streamChat(ref: ModelRef, req: ChatRequest): AsyncGenerator<string> {
  const model = languageModel(ref.provider, ref.model);
  const result = streamText({
    model,
    instructions: instructionsFor(ref, req.system, req.systemTail),
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    abortSignal: req.abortSignal,
    maxRetries: 1,
    providerOptions: cacheOptions(ref),
    ...samplingOptions(ref, req),
    // 错误通过 stream 中的 error 部分处理，不让 SDK 打印到控制台。
    onError: () => {},
  });
  try {
    for await (const part of result.stream) {
      if (part.type === "text-delta") yield part.text;
      else if (part.type === "error") throw new AiError(errorMessage(part.error));
    }
    reportUsage(ref, "chat", await result.totalUsage);
  } catch (err) {
    if (err instanceof AiError) throw err;
    throw new AiError(errorMessage(err));
  }
}

/** 一次性生成文本。 */
export async function generateChatText(
  ref: ModelRef,
  req: { system: string; prompt: string; abortSignal?: AbortSignal },
): Promise<string> {
  try {
    const result = await generateText({
      model: languageModel(ref.provider, ref.model),
      instructions: req.system,
      prompt: req.prompt,
      abortSignal: req.abortSignal,
      maxRetries: 1,
    });
    reportUsage(ref, "chat", result.usage);
    return result.text;
  } catch (err) {
    throw new AiError(errorMessage(err));
  }
}

/** 结构化生成：走 Output.object，结果再用 schema 校验。 */
export async function generateStructured<S extends z.ZodType>(
  ref: ModelRef,
  req: {
    schema: S;
    name: string;
    system: string;
    prompt: string;
    abortSignal?: AbortSignal;
  },
): Promise<z.infer<S>> {
  try {
    const result = await generateText({
      model: languageModel(ref.provider, ref.model),
      instructions: req.system,
      prompt: req.prompt,
      output: Output.object({ schema: req.schema, name: req.name }),
      abortSignal: req.abortSignal,
      maxRetries: 1,
    });
    reportUsage(ref, "chat", result.usage);
    return req.schema.parse(result.output);
  } catch (err) {
    throw new AiError(aiText().structuredFailed(errorMessage(err)));
  }
}

/** 带图片的单轮生成（图片 OCR / 描述）。 */
export async function describeImage(
  ref: ModelRef,
  req: { image: Uint8Array; mediaType: string; prompt: string },
): Promise<string> {
  try {
    const result = await generateText({
      model: languageModel(ref.provider, ref.model),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: req.prompt },
            { type: "image", image: req.image, mediaType: req.mediaType },
          ],
        },
      ],
      maxRetries: 1,
    });
    reportUsage(ref, "chat", result.usage);
    return result.text;
  } catch (err) {
    throw new AiError(aiText().visionFailed(errorMessage(err)));
  }
}
