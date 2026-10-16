import type { Capability, ProviderKind } from "@quirenote/core";

/** 调用某个 provider 所需的运行时信息（Key 已解密，只在服务端内存中存在）。 */
export interface ProviderRuntime {
  id: string;
  kind: ProviderKind;
  baseUrl?: string | null;
  apiKey?: string | null;
  /** 用户自定义的请求头，附加到该 provider 的每个请求上。 */
  headers?: Record<string, string> | null;
  /** 可注入的 fetch，测试时用来 mock。 */
  fetch?: typeof fetch;
}

/** 某个能力的模型分配：provider + 模型名。 */
export interface ModelRef {
  provider: ProviderRuntime;
  model: string;
}

/** 送给模型的编号片段。n 从 1 开始，对应回答里的 [n]。 */
export interface Passage {
  n: number;
  text: string;
  title?: string;
  sourceId?: string;
  chunkId?: string;
  heading?: string | null;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export class AiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code = "ai_error", status = 502) {
    super(message);
    this.name = "AiError";
    this.code = code;
    this.status = status;
  }
}

export class UnsupportedError extends AiError {
  constructor(message: string) {
    super(message, "unsupported", 400);
    this.name = "UnsupportedError";
  }
}

export interface CatalogEntry {
  kind: ProviderKind;
  label: string;
  capabilities: Capability[];
  defaultBaseUrl: string | null;
  /** baseUrl 是否必须由用户填写（openai-compatible）。 */
  baseUrlRequired: boolean;
  requiresKey: boolean;
  /** 各能力的示例模型，第一个为默认值。 */
  models: Partial<Record<Capability, string[]>>;
  /** TTS 双人播客默认音色（A / B）。 */
  voices?: { A: string; B: string; options: string[] };
  notes: string;
  docsUrl: string | null;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  content?: string;
}

export interface ConnectionResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
  models?: string[];
}

export interface BinaryResult {
  data: Uint8Array;
  mediaType: string;
}
