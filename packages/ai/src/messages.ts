/**
 * 抛给界面的错误和兜底文字（资料主题名、缺省标题）。语言由宿主提供：服务端按当前请求的界面语言，
 * 没有设置时用中文。发给模型的提示词不在这里。
 */
import { PROVIDER_CATALOG } from "./catalog";

export type AiLang = "zh" | "en";

let langSource: () => AiLang = () => "zh";

/** 宿主告诉这个包当前的界面语言（服务端在启动时设置一次）。 */
export function setAiLangSource(fn: () => AiLang): void {
  langSource = fn;
}

const zh = {
  structuredFailed: (e: string) => `结构化生成失败：${e}`,
  visionFailed: (e: string) => `图片识别失败：${e}`,
  embeddingFailed: (e: string) => `Embedding 失败：${e}`,
  unreachable: (host: string, e: string) => `无法连接 ${host}：${e}`,
  http: (status: number, text: string) => `HTTP ${status}：${text}`,
  badJson: (url: string) => `响应不是合法 JSON：${url}`,
  replicateFailed: (e: string) => `Replicate 生成失败：${e}`,
  replicateTimeout: "Replicate 生成超时",
  replicateNoOutput: "Replicate 返回中没有输出文件地址",
  comfyTimeout: "ComfyUI 生成超时",
  imageFailed: (e: string) => `图像生成失败：${e}`,
  falNoImage: "fal 返回中没有图片地址",
  illustrationFailed: (e: string) => `插图生成失败：${e}`,
  illustrationNoSvg: "插图生成失败：模型没有返回 SVG",
  videoFailed: (e: string) => `视频生成失败：${e}`,
  falNoVideo: "fal 返回中没有视频地址",
  searchFailed: (e: string) => `Claude 联网搜索失败：${e}`,
  ttsFailed: (e: string) => `TTS 失败：${e}`,
  sttFailed: (e: string) => `转写失败：${e}`,
  missingBaseUrl: (id: string) => `provider ${id} 缺少 baseUrl`,
  missingKey: (id: string) => `provider「${id}」未配置 API Key`,
  noChat: (kind: string) => `provider 类型 ${kind} 不支持对话`,
  noEmbedding: (kind: string) => `provider 类型 ${kind} 不支持 Embedding`,
  anthropicNoEmbedding:
    "Anthropic 没有 Embedding 接口，请另选 OpenAI / Gemini / Ollama / OpenAI 兼容接口做 Embedding",
  noSearch: (kind: string) => `provider 类型 ${kind} 不支持联网搜索`,
  noTts: (kind: string) => `provider 类型 ${kind} 不支持 TTS`,
  noStt: (kind: string) => `provider 类型 ${kind} 不支持语音转写`,
  noSttHint: (kind: string) =>
    `provider 类型 ${kind} 不支持语音转写，请使用 OpenAI、OpenAI 兼容接口或 Gemini`,
  noImage: (kind: string) => `provider 类型 ${kind} 不支持图像生成`,
  noVideo: (kind: string) => `provider 类型 ${kind} 不支持视频生成`,
  sdkNoImage: (kind: string) => `provider 类型 ${kind} 不能通过 AI SDK 生成图像`,
  sdkNoSpeech: (kind: string) => `provider 类型 ${kind} 不能通过 AI SDK 合成语音`,
  sdkNoVideo: (kind: string) => `provider 类型 ${kind} 不能通过 AI SDK 生成视频`,
  edgeTts: () => `Edge TTS 暂不支持。${PROVIDER_CATALOG["edge-tts"].notes.replace(/^暂不支持：/, "")}`,
  topicMany: (first: string, count: number) => `${first} 等 ${count} 份资料`,
  topicFallback: "资料概览",
  mindmapRoot: "主题",
  newNote: "新笔记",
  table: "表格",
};

export type AiMessages = typeof zh;

const en: AiMessages = {
  structuredFailed: (e) => `Structured generation failed: ${e}`,
  visionFailed: (e) => `Image recognition failed: ${e}`,
  embeddingFailed: (e) => `Embedding failed: ${e}`,
  unreachable: (host, e) => `Couldn't connect to ${host}: ${e}`,
  http: (status, text) => `HTTP ${status}: ${text}`,
  badJson: (url) => `The response isn't valid JSON: ${url}`,
  replicateFailed: (e) => `Replicate generation failed: ${e}`,
  replicateTimeout: "Replicate generation timed out",
  replicateNoOutput: "Replicate's response has no output file URL",
  comfyTimeout: "ComfyUI generation timed out",
  imageFailed: (e) => `Image generation failed: ${e}`,
  falNoImage: "fal's response has no image URL",
  illustrationFailed: (e) => `Illustration failed: ${e}`,
  illustrationNoSvg: "Illustration failed: the model didn't return an SVG",
  videoFailed: (e) => `Video generation failed: ${e}`,
  falNoVideo: "fal's response has no video URL",
  searchFailed: (e) => `Claude web search failed: ${e}`,
  ttsFailed: (e) => `Text-to-speech failed: ${e}`,
  sttFailed: (e) => `Transcription failed: ${e}`,
  missingBaseUrl: (id) => `Provider ${id} has no base URL`,
  missingKey: (id) => `Provider “${id}” has no API key`,
  noChat: (kind) => `Provider type ${kind} doesn't support chat`,
  noEmbedding: (kind) => `Provider type ${kind} doesn't support embeddings`,
  anthropicNoEmbedding:
    "Anthropic has no embedding API. Use OpenAI, Gemini, Ollama or an OpenAI-compatible API for embeddings.",
  noSearch: (kind) => `Provider type ${kind} doesn't support web search`,
  noTts: (kind) => `Provider type ${kind} doesn't support text-to-speech`,
  noStt: (kind) => `Provider type ${kind} doesn't support speech-to-text`,
  noSttHint: (kind) =>
    `Provider type ${kind} doesn't support speech-to-text. Use OpenAI, an OpenAI-compatible API or Gemini.`,
  noImage: (kind) => `Provider type ${kind} doesn't support image generation`,
  noVideo: (kind) => `Provider type ${kind} doesn't support video generation`,
  sdkNoImage: (kind) => `Provider type ${kind} can't generate images through the AI SDK`,
  sdkNoSpeech: (kind) => `Provider type ${kind} can't synthesize speech through the AI SDK`,
  sdkNoVideo: (kind) => `Provider type ${kind} can't generate video through the AI SDK`,
  edgeTts: () =>
    "Edge TTS isn't supported yet: its online service needs a WebSocket and dynamically signed tokens, and the protocol is undocumented and changes often. Use OpenAI, Gemini or ElevenLabs instead, or run an Edge TTS proxy compatible with OpenAI's /v1/audio/speech and add it as an OpenAI-compatible API.",
  topicMany: (first, count) => `${first} and ${count - 1} more`,
  topicFallback: "Sources overview",
  mindmapRoot: "Topic",
  newNote: "New note",
  table: "Table",
};

/** 当前界面语言的文字。 */
export function aiText(): AiMessages {
  return langSource() === "en" ? en : zh;
}
