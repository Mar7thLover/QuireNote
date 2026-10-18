import type { Capability, ProviderKind, ProviderModel } from "@quirenote/core";
import type { CatalogEntry } from "./types";

/**
 * 各 provider 类型的能力、默认地址、示例模型与说明。
 * 模型名取自 @ai-sdk/* 类型定义中最新的条目；用户可以填任意模型名。
 */
export const PROVIDER_CATALOG: Record<ProviderKind, CatalogEntry> = {
  anthropic: {
    kind: "anthropic",
    label: "Anthropic Claude",
    labelEn: "Anthropic Claude",
    capabilities: ["chat", "search", "image"],
    defaultBaseUrl: "https://api.anthropic.com/v1",
    baseUrlRequired: false,
    requiresKey: true,
    models: {
      chat: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5", "claude-fable-5-1"],
      search: ["claude-haiku-5-5", "claude-sonnet-5-5"],
      image: ["claude-sonnet-5-5", "claude-opus-5-5"],
    },
    notes:
      "对话、联网搜索（Claude 自带的 web search，每千次约 10 美元）、矢量插图（Claude 绘制 SVG）。图片资料由 Claude 直接读图识别。没有 Embedding 接口时，资料不多就整份交给 Claude 阅读，资料多时由 Claude 扩展检索词再检索。",
    docsUrl: "https://docs.anthropic.com/en/docs/about-claude/models",
  },
  "anthropic-compatible": {
    kind: "anthropic-compatible",
    label: "Anthropic 兼容接口",
    labelEn: "Anthropic-compatible API",
    capabilities: ["chat", "image"],
    defaultBaseUrl: null,
    baseUrlRequired: true,
    requiresKey: false,
    models: { chat: ["claude-sonnet-5-5"], image: ["claude-sonnet-5-5"] },
    notes:
      "兼容 Anthropic Messages API（/v1/messages）的服务：Claude 中转、DeepSeek / Kimi / GLM 等提供的 Anthropic 端点。baseUrl 需包含 /v1。Key 以 x-api-key 发送；服务要求 Authorization: Bearer 时，在自定义请求头里添加。",
    docsUrl: null,
  },
  openai: {
    kind: "openai",
    label: "OpenAI",
    labelEn: "OpenAI",
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
    labelEn: "Google Gemini",
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
    labelEn: "Ollama (local)",
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
    labelEn: "OpenAI-compatible API",
    capabilities: ["chat", "embedding", "tts", "stt", "image"],
    defaultBaseUrl: null,
    baseUrlRequired: true,
    requiresKey: false,
    models: {
      chat: ["deepseek-chat", "moonshot-v1-8k"],
      embedding: ["text-embedding-3-small"],
      tts: ["tts-1"],
      stt: ["whisper-1"],
    },
    voices: { A: "alloy", B: "nova", options: ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] },
    notes:
      "DeepSeek、Moonshot、OpenRouter、硅基流动、vLLM、LM Studio 等任何兼容 /v1/chat/completions 的服务；语音合成 / 转写走 /v1/audio/speech 与 /v1/audio/transcriptions。baseUrl 需包含 /v1。",
    docsUrl: null,
  },
  tavily: {
    kind: "tavily",
    label: "Tavily 搜索",
    labelEn: "Tavily Search",
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
    labelEn: "Brave Search",
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
    labelEn: "SearXNG (self-hosted)",
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
    labelEn: "ElevenLabs",
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
    labelEn: "Edge TTS",
    capabilities: ["tts"],
    defaultBaseUrl: null,
    baseUrlRequired: false,
    requiresKey: false,
    models: { tts: ["zh-CN-XiaoxiaoNeural", "zh-CN-YunxiNeural"] },
    notes:
      "暂不支持：Edge 在线 TTS 需要 WebSocket 与动态签名令牌，协议不公开且经常变动。请改用 OpenAI / Gemini / ElevenLabs，或自建一个兼容 OpenAI /v1/audio/speech 的 Edge TTS 代理并以「OpenAI 兼容接口」接入。",
    docsUrl: null,
  },
  fal: {
    kind: "fal",
    label: "fal.ai",
    labelEn: "fal.ai",
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
    labelEn: "Replicate",
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
    labelEn: "ComfyUI (local)",
    capabilities: ["image"],
    defaultBaseUrl: "http://127.0.0.1:8188",
    baseUrlRequired: true,
    requiresKey: false,
    models: { image: ["sd_xl_base_1.0.safetensors", "flux1-schnell-fp8.safetensors"] },
    notes: "使用内置的最小文生图工作流，模型名填 checkpoint 文件名（models/checkpoints 下）。",
    docsUrl: "https://docs.comfy.org",
  },
};

export function catalogEntry(kind: ProviderKind): CatalogEntry {
  return PROVIDER_CATALOG[kind];
}

export function supportsCapability(kind: ProviderKind, cap: Capability): boolean {
  return PROVIDER_CATALOG[kind].capabilities.includes(cap);
}

export function defaultModel(kind: ProviderKind, cap: Capability): string | null {
  return PROVIDER_CATALOG[kind].models[cap]?.[0] ?? null;
}

export function defaultBaseUrl(kind: ProviderKind): string | null {
  return PROVIDER_CATALOG[kind].defaultBaseUrl;
}

/** 目录数组，按固定顺序，供 GET /providers/catalog 返回。 */
export function listCatalog(): CatalogEntry[] {
  return Object.values(PROVIDER_CATALOG);
}

/** 新建 provider 时预置的模型列表：目录里的示例模型，同名模型合并能力。 */
export function catalogModels(kind: ProviderKind): ProviderModel[] {
  const byId = new Map<string, ProviderModel>();
  for (const [cap, ids] of Object.entries(PROVIDER_CATALOG[kind].models) as [Capability, string[]][]) {
    for (const id of ids) {
      const m = byId.get(id);
      if (m) m.capabilities.push(cap);
      else byId.set(id, { id, label: null, capabilities: [cap] });
    }
  }
  return [...byId.values()];
}

const CAP_PATTERNS: [Capability, RegExp][] = [
  ["embedding", /embed|bge|e5-|gte-|m3e/i],
  ["stt", /whisper|transcri|asr|paraformer|sensevoice/i],
  ["tts", /tts|speech|voice|eleven_/i],
  ["video", /veo|video|kling|sora|wan-?2|hunyuan-?video/i],
  ["image", /image|dall-?e|flux|imagen|stable-?diffusion|sdxl|nano-?banana|kolors|seedream/i],
];

/** 根据模型 ID 推测用途（从服务拉取模型列表时预填），只返回该 provider 类型支持的能力。 */
export function guessCapabilities(kind: ProviderKind, modelId: string): Capability[] {
  const supported = PROVIDER_CATALOG[kind].capabilities;
  const known = catalogModels(kind).find((m) => m.id === modelId);
  if (known) return known.capabilities;
  const hit = CAP_PATTERNS.find(([cap, re]) => supported.includes(cap) && re.test(modelId));
  if (hit) return [hit[0]];
  if (supported.includes("chat")) return ["chat"];
  return [supported[0]!];
}
