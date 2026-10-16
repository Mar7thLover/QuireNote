import { generateText, Output, streamText } from "ai";
import type { z } from "zod";
import { errorMessage, languageModel } from "./sdk";
import { AiError, type ChatTurn, type ModelRef } from "./types";

export interface ChatRequest {
  system: string;
  messages: ChatTurn[];
  abortSignal?: AbortSignal;
}

/** 流式对话，逐段 yield 文本增量。出错时抛出 AiError。 */
export async function* streamChat(ref: ModelRef, req: ChatRequest): AsyncGenerator<string> {
  const model = languageModel(ref.provider, ref.model);
  const result = streamText({
    model,
    instructions: req.system,
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    abortSignal: req.abortSignal,
    maxRetries: 1,
    // 错误通过 stream 中的 error 部分处理，不让 SDK 打印到控制台。
    onError: () => {},
  });
  try {
    for await (const part of result.stream) {
      if (part.type === "text-delta") yield part.text;
      else if (part.type === "error") throw new AiError(errorMessage(part.error));
    }
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
    return req.schema.parse(result.output);
  } catch (err) {
    throw new AiError(`结构化生成失败：${errorMessage(err)}`);
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
    return result.text;
  } catch (err) {
    throw new AiError(`图片识别失败：${errorMessage(err)}`);
  }
}
