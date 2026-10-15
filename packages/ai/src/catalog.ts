import type { Capability } from "@folio/core";
import type { CatalogEntry, ProviderKindOrLocal } from "./types";

export const LOCAL_PROVIDER_ID = "local";
export const LOCAL_CHAT_MODEL = "extractive";
export const LOCAL_EMBEDDING_MODEL = "hash-384";

/**
 * 各 provider 类型的能力、默认地址、示例模型与说明。
 * 模型名取自 @ai-sdk/* 类型定义中最新的条目；用户可以填任意模型名。
 */
export const PROVIDER_CATALOG: Record<ProviderKindOrLocal, CatalogEntry> = {
  local: {
    kind: "local",
    label: "Local（内置）",
    capabilities: ["chat", "embedding"],
    defaultBaseUrl: null,
    baseUrlRequired: false,
    requiresKey: false,
    models: { chat: [LOCAL_CHAT_MODEL], embedding: [LOCAL_EMBEDDING_MODEL] },
    notes:
      "内置离线 provider，无需 Key：Embedding 为确定性的哈希字符 n-gram 向量（384 维）；对话为抽取式回答，直接摘录资料原句并带 [n] 引用；结构化生成使用启发式规则。适合离线演示与测试，效果远不如真实模型。",
    docsUrl: null,
  },
  anthropic: {
    kind: "anthropic",
    label: "Anthropic Claude",
    capabilities: ["chat"],
    defaultBaseUrl: "https://api.anthropic.com/v1",
    baseUrlRequired: false,
    requiresKey: true,
    models: { chat: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"] },
    notes:
      "Anthropic 没有 Embedding 接口，请另选 OpenAI / Gemini / Ollama / local 做 Embedding。Claude 支持图片输入，可用于图片 OCR。",
    docsUrl: "https://docs.anthropic.com/en/docs/about-claude/models",
  },
  openai: {
    kind: "openai",
    label: "OpenAI",
    capabilities: ["chat", "embedding", "tts", "stt", "image"],
    defaultBaseUrl: "https://api.openai.com/v1",
    baseUrlRequired: false,
    requiresKey: true,
    models: {
      chat: ["gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna", "gpt-5.5", "gpt-5.4-mini"],
      embedding: ["text-embedding-3-small", "text-embedding-3-large"],
      tts: ["gpt-4o-mini-tts", "tts-1-hd", "tts-1"],
      stt: ["gpt-4o-transcribe", "gpt-4o-mini-transcribe", "whisper-1"],
      image: ["gpt-image-2", "gpt-image-2.5-sunburst", "gpt-image-2.5-flare", "gpt-image-1.5"],
    },
    voices: {
      A: "onyx",
      B: "nova",
      options: [
        "alloy",
        "ash",
        "ballad",
        "coral",
        "echo",
        "fable",
        "onyx",
        "nova",
        "sage",
        "shimmer",
        "verse",
      ],
    },
    notes: "对话、Embedding、TTS、Whisper 转写、图像生成均可用。",
    docsUrl: "https://platform.openai.com/docs/models",
  },
  google: {
    kind: "google",
    label: "Google Gemini",
    capabilities: ["chat", "embedding", "tts", "stt", "image", "video"],
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    baseUrlRequired: false,
    requiresKey: true,
    models: {
      chat: ["gemini-4-argon", "gemini-3.8-flash", "gemini-3.1-pro-preview", "gemini-flash-latest"],
      embedding: ["gemini-embedding-2", "gemini-embedding-001"],
      tts: ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts", "gemini-2.5-flash-preview-tts"],
      stt: ["gemini-3.5-transcribe"],
      image: ["gemini-nano-banana-2.1", "gemini-3.1-flash-image-preview", "gemini-3-pro-image-preview"],
      video: ["veo-3.1-generate", "veo-3.1-fast-generate-preview"],
    },
    voices: {
      A: "Puck",
      B: "Kore",
      options: ["Puck", "Kore", "Charon", "Fenrir", "Aoede", "Leda", "Orus", "Zephyr"],
    },
    notes: "Gemini 全能力：对话、Embedding、TTS、转写、图像（Nano Banana）、视频（Veo）。",
    docsUrl: "https://ai.google.dev/gemini-api/docs/models",
  },
  ollama: {
    kind: "ollama",
    label: "Ollama（本地）",
    capabilities: ["chat", "embedding"],
    defaultBaseUrl: "http://localhost:11434/v1",
    baseUrlRequired: false,
    requiresKey: false,
    models: {
      chat: ["qwen3", "llama3.3", "gemma3", "deepseek-r1"],
      embedding: ["bge-m3", "nomic-embed-text", "mxbai-embed-large"],
    },
    notes: "通过 OpenAI 兼容接口访问本机 Ollama（默认 http://localhost:11434/v1）。模型需先 `ollama pull`。",
    docsUrl: "https://ollama.com/library",
  },
  "openai-compatible": {
    kind: "openai-compatible",
    label: "OpenAI 兼容接口",
    capabilities: ["chat", "embedding", "image"],
    defaultBaseUrl: null,
    baseUrlRequired: true,
    requiresKey: false,
    models: { chat: ["deepseek-chat", "moonshot-v1-8k"], embedding: ["text-embedding-3-small"] },
    notes:
      "DeepSeek、Moonshot、OpenRouter、vLLM、LM Studio 等任何兼容 /v1/chat/completions 的服务。baseUrl 需包含 /v1。",
    docsUrl: null,
  },
  tavily: {
    kind: "tavily",
    label: "Tavily 搜索",
    capabilities: ["search"],
    defaultBaseUrl: "https://api.tavily.com",
    baseUrlRequired: false,
    requiresKey: true,
    models: { search: ["basic", "advanced"] },
    notes: "面向 LLM 的搜索 API，可直接返回正文。模型名填 basic / advanced（搜索深度）。",
    docsUrl: "https://docs.tavily.com",
  },
  brave: {
    kind: "brave",
    label: "Brave Search",
    capabilities: ["search"],
    defaultBaseUrl: "https://api.search.brave.com/res/v1",
    baseUrlRequired: false,
    requiresKey: true,
    models: { search: ["web"] },
    notes: "Brave Web Search API，只返回摘要；深度研究时服务端会再抓取正文。",
    docsUrl: "https://api-dashboard.search.brave.com/app/documentation",
  },
  searxng: {
    kind: "searxng",
    label: "SearXNG（自托管）",
    capabilities: ["search"],
    defaultBaseUrl: "http://localhost:8888",
    baseUrlRequired: true,
    requiresKey: false,
    models: { search: ["general"] },
    notes:
      "自托管元搜索引擎。需在 settings.yml 的 search.formats 中启用 json。模型名填类别（general / science / news）。",
    docsUrl: "https://docs.searxng.org",
  },
  elevenlabs: {
    kind: "elevenlabs",
    label: "ElevenLabs",
    capabilities: ["tts"],
    defaultBaseUrl: "https://api.elevenlabs.io",
    baseUrlRequired: false,
    requiresKey: true,
    models: { tts: ["eleven_multilingual_v2", "eleven_flash_v2_5", "eleven_v3"] },
    voices: {
      A: "pNInz6obpgDQGcFmaJgB",
      B: "21m00Tcm4TlvDq8ikWAM",
      options: [
        "pNInz6obpgDQGcFmaJgB",
        "21m00Tcm4TlvDq8ikWAM",
        "EXAVITQu4vr4xnSDxMaL",
        "ErXwobaYiN019PkySvjV",
      ],
    },
    notes: "高质量多语种 TTS。音色填 voice_id。",
    docsUrl: "https://elevenlabs.io/docs/api-reference/text-to-speech",
  },
  "edge-tts": {
    kind: "edge-tts",
    label: "Edge TTS",
    capabilities: ["tts"],
    defaultBaseUrl: null,
    baseUrlRequired: false,
    requiresKey: false,
    models: { tts: ["zh-CN-XiaoxiaoNeural", "zh-CN-YunxiNeural"] },
    notes:
      "暂不支持：Edge 在线 TTS 需要 WebSocket 与动态签名令牌，协议不公开且经常变动。请改用 OpenAI / Gemini / ElevenLabs，或自建一个兼容 OpenAI /v1/audio/speech 的 Edge TTS 代理并以 openai 类型接入。",
    docsUrl: null,
  },
  fal: {
    kind: "fal",
    label: "fal.ai",
    capabilities: ["image", "video"],
    defaultBaseUrl: "https://fal.run",
    baseUrlRequired: false,
    requiresKey: true,
    models: {
      image: ["fal-ai/flux/schnell", "fal-ai/flux-pro/v1.1", "fal-ai/flux/dev"],
      video: ["fal-ai/kling-video/v2/master/text-to-video"],
    },
    notes: "Flux 等图像模型与视频模型。模型名即 fal 应用路径。",
    docsUrl: "https://fal.ai/models",
  },
  replicate: {
    kind: "replicate",
    label: "Replicate",
    capabilities: ["image", "video"],
    defaultBaseUrl: "https://api.replicate.com/v1",
    baseUrlRequired: false,
    requiresKey: true,
    models: {
      image: ["black-forest-labs/flux-schnell", "black-forest-labs/flux-1.1-pro"],
      video: ["minimax/video-01"],
    },
    notes: "模型名为 owner/name（官方模型）。",
    docsUrl: "https://replicate.com/explore",
  },
  comfyui: {
    kind: "comfyui",
    label: "ComfyUI（本地）",
    capabilities: ["image"],
    defaultBaseUrl: "http://127.0.0.1:8188",
    baseUrlRequired: true,
    requiresKey: false,
    models: { image: ["sd_xl_base_1.0.safetensors", "flux1-schnell-fp8.safetensors"] },
    notes: "使用内置的最小文生图工作流，模型名填 checkpoint 文件名（models/checkpoints 下）。",
    docsUrl: "https://docs.comfy.org",
  },
};

export function catalogEntry(kind: ProviderKindOrLocal): CatalogEntry {
  return PROVIDER_CATALOG[kind];
}

export function supportsCapability(kind: ProviderKindOrLocal, cap: Capability): boolean {
  return PROVIDER_CATALOG[kind].capabilities.includes(cap);
}

export function defaultModel(kind: ProviderKindOrLocal, cap: Capability): string | null {
  return PROVIDER_CATALOG[kind].models[cap]?.[0] ?? null;
}

export function defaultBaseUrl(kind: ProviderKindOrLocal): string | null {
  return PROVIDER_CATALOG[kind].defaultBaseUrl;
}

/** 目录数组，按固定顺序，供 GET /providers/catalog 返回。 */
export function listCatalog(): CatalogEntry[] {
  return Object.values(PROVIDER_CATALOG);
}
