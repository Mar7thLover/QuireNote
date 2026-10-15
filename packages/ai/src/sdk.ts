/** 把 ProviderRuntime 转成 Vercel AI SDK 的模型实例。始终显式传 baseURL / apiKey，不读宿主环境变量。 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { EmbeddingModel, ImageModel, LanguageModel, SpeechModel, TranscriptionModel } from "ai";
import { defaultBaseUrl } from "./catalog";
import { AiError, type ProviderRuntime, UnsupportedError } from "./types";

export function baseUrlOf(p: ProviderRuntime): string {
  const url = (p.baseUrl?.trim() || defaultBaseUrl(p.kind) || "").replace(/\/+$/, "");
  if (!url) throw new AiError(`provider ${p.id} 缺少 baseUrl`, "bad_config", 400);
  return url;
}

export function requireKey(p: ProviderRuntime): string {
  if (!p.apiKey) throw new AiError(`provider「${p.id}」未配置 API Key`, "missing_key", 400);
  return p.apiKey;
}

function anthropic(p: ProviderRuntime) {
  return createAnthropic({ baseURL: baseUrlOf(p), apiKey: requireKey(p), fetch: p.fetch });
}
function openai(p: ProviderRuntime) {
  return createOpenAI({ baseURL: baseUrlOf(p), apiKey: requireKey(p), fetch: p.fetch });
}
function google(p: ProviderRuntime) {
  return createGoogle({ baseURL: baseUrlOf(p), apiKey: requireKey(p), fetch: p.fetch });
}
function compatible(p: ProviderRuntime) {
  return createOpenAICompatible({
    name: p.kind === "ollama" ? "ollama" : "openai-compatible",
    baseURL: baseUrlOf(p),
    // Ollama 不校验 Key，但 SDK 需要一个值才会带 Authorization 头；没有 Key 时不传。
    apiKey: p.apiKey || undefined,
    fetch: p.fetch,
    supportsStructuredOutputs: p.kind !== "ollama",
  });
}

export function languageModel(p: ProviderRuntime, model: string): LanguageModel {
  switch (p.kind) {
    case "anthropic":
      return anthropic(p)(model);
    case "openai":
      return openai(p).chat(model);
    case "google":
      return google(p)(model);
    case "ollama":
    case "openai-compatible":
      return compatible(p).chatModel(model);
    default:
      throw new UnsupportedError(`provider 类型 ${p.kind} 不支持对话`);
  }
}

export function embeddingModel(p: ProviderRuntime, model: string): EmbeddingModel {
  switch (p.kind) {
    case "openai":
      return openai(p).embedding(model);
    case "google":
      return google(p).embedding(model);
    case "ollama":
    case "openai-compatible":
      return compatible(p).embeddingModel(model);
    case "anthropic":
      throw new UnsupportedError(
        "Anthropic 没有 Embedding 接口，请另选 OpenAI / Gemini / Ollama / local 做 Embedding",
      );
    default:
      throw new UnsupportedError(`provider 类型 ${p.kind} 不支持 Embedding`);
  }
}

export function imageModel(p: ProviderRuntime, model: string): ImageModel {
  switch (p.kind) {
    case "openai":
      return openai(p).image(model);
    case "google":
      return google(p).image(model);
    case "openai-compatible":
      return compatible(p).imageModel(model);
    default:
      throw new UnsupportedError(`provider 类型 ${p.kind} 不能通过 AI SDK 生成图像`);
  }
}

export function speechModel(p: ProviderRuntime, model: string): SpeechModel {
  switch (p.kind) {
    case "openai":
      return openai(p).speech(model);
    case "google":
      return google(p).speech(model);
    default:
      throw new UnsupportedError(`provider 类型 ${p.kind} 不能通过 AI SDK 合成语音`);
  }
}

export function transcriptionModel(p: ProviderRuntime, model: string): TranscriptionModel {
  switch (p.kind) {
    case "openai":
      return openai(p).transcription(model);
    case "google":
      return google(p).transcription(model);
    default:
      throw new UnsupportedError(`provider 类型 ${p.kind} 不支持语音转写`);
  }
}

export function videoModel(p: ProviderRuntime, model: string) {
  if (p.kind === "google") return google(p).video(model);
  throw new UnsupportedError(`provider 类型 ${p.kind} 不能通过 AI SDK 生成视频`);
}

/** 把 SDK / 网络错误转成简短可读的信息。 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const anyErr = err as Error & { statusCode?: number; responseBody?: string; cause?: unknown };
    let msg = anyErr.message;
    if (anyErr.statusCode) msg = `HTTP ${anyErr.statusCode}: ${msg}`;
    if (anyErr.responseBody) {
      try {
        const body = JSON.parse(anyErr.responseBody) as { error?: { message?: string } | string };
        const inner = typeof body.error === "string" ? body.error : body.error?.message;
        if (inner && !msg.includes(inner)) msg = `${msg} — ${inner}`;
      } catch {
        /* 非 JSON 响应体 */
      }
    }
    return msg.slice(0, 500);
  }
  return String(err).slice(0, 500);
}
