import { generateText, Output, streamText } from "ai";
import type { z } from "zod";
import { localAnswerSegments, streamSegments } from "./local/chat";
import { errorMessage, languageModel } from "./sdk";
import { AiError, type ChatTurn, type ModelRef, type Passage } from "./types";

export interface ChatRequest {
  system: string;
  messages: ChatTurn[];
  /** 编号片段；local provider 据此生成抽取式回答。真实模型的片段应已写入 system / messages。 */
  passages?: Passage[];
  abortSignal?: AbortSignal;
  /** local provider 的回答分段（用于非对话类的就地 AI）。提供时直接流式输出这段文本。 */
  localText?: () => string;
}

export function isLocal(ref: ModelRef): boolean {
  return ref.provider.kind === "local";
}

/** 流式对话，逐段 yield 文本增量。出错时抛出 AiError。 */
export async function* streamChat(ref: ModelRef, req: ChatRequest): AsyncGenerator<string> {
  if (isLocal(ref)) {
    const lastUser = [...req.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const segments = req.localText ? [req.localText()] : localAnswerSegments(lastUser, req.passages ?? []);
    yield* streamSegments(segments);
    return;
  }
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

/** 一次性生成文本。local provider 必须提供 localText。 */
export async function generateChatText(
  ref: ModelRef,
  req: { system: string; prompt: string; localText: () => string; abortSignal?: AbortSignal },
): Promise<string> {
  if (isLocal(ref)) return req.localText();
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

/** 结构化生成：真实模型走 Output.object；local provider 调用启发式函数。结果都会用 schema 校验。 */
export async function generateStructured<S extends z.ZodType>(
  ref: ModelRef,
  req: {
    schema: S;
    name: string;
    system: string;
    prompt: string;
    local: () => z.infer<S>;
    abortSignal?: AbortSignal;
  },
): Promise<z.infer<S>> {
  if (isLocal(ref)) return req.schema.parse(req.local());
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
  if (isLocal(ref)) {
    throw new AiError(
      "图片 OCR 需要支持视觉的对话模型：请在设置中为“对话”能力分配 Claude / OpenAI / Gemini 等模型",
      "unsupported",
      400,
    );
  }
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
