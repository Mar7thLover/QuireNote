/** 模型分配解析：capability → provider（解密 Key 与自定义请求头）+ 模型名。没有内置模型，未分配即未配置。 */
import { type ModelRef, type ProviderRuntime, supportsCapability } from "@quirenote/ai";
import type { Capability, ModelAssignment, ModelChoice } from "@quirenote/core";
import type { KeyCipher } from "./crypto";
import { ApiError } from "./errors";
import type { ProviderRecord, Store } from "./store/types";

/** 早期版本内置的离线 provider id；遗留的分配一律视为未配置。 */
export const LEGACY_LOCAL_PROVIDER_ID = "local";

export const CAP_LABEL: Record<Capability, string> = {
  chat: "对话",
  embedding: "Embedding",
  search: "联网搜索",
  tts: "语音合成（TTS）",
  stt: "语音转写（STT）",
  image: "图像生成",
  video: "视频生成",
};

export class ModelResolver {
  constructor(
    private readonly store: Store,
    private readonly cipher: KeyCipher,
    /** 测试时注入给所有 provider 的 fetch。 */
    private readonly fetchImpl?: typeof fetch,
  ) {}

  private decrypt(p: ProviderRecord, enc: string, what: string): string {
    try {
      return this.cipher.decrypt(enc);
    } catch {
      throw new ApiError(
        500,
        "key_decrypt_failed",
        `provider「${p.name}」的${what}无法解密（QUIRENOTE_SECRET 或 secret.key 可能已变更），请重新填写`,
      );
    }
  }

  async runtime(providerId: string): Promise<ProviderRuntime> {
    const p = await this.store.providers.get(providerId);
    if (!p) throw new ApiError(400, "provider_not_found", `provider ${providerId} 不存在`);
    if (!p.enabled) throw new ApiError(400, "provider_disabled", `provider「${p.name}」已停用`);
    const apiKey = p.keyEnc ? this.decrypt(p, p.keyEnc, " Key ") : null;
    const headers = p.headersEnc
      ? (JSON.parse(this.decrypt(p, p.headersEnc, "自定义请求头")) as Record<string, string>)
      : null;
    return {
      id: p.id,
      kind: p.kind,
      baseUrl: p.baseUrl,
      apiKey,
      headers,
      ...(this.fetchImpl ? { fetch: this.fetchImpl } : {}),
    };
  }

  async assignment(cap: Capability): Promise<ModelAssignment | null> {
    const a = await this.store.assignments.get(cap);
    return a && a.providerId !== LEGACY_LOCAL_PROVIDER_ID ? a : null;
  }

  /** 解析能力对应的模型；未分配时返回 null。 */
  async resolve(cap: Capability): Promise<ModelRef | null> {
    const a = await this.assignment(cap);
    if (!a) return null;
    return { provider: await this.runtime(a.providerId), model: a.model };
  }

  async require(cap: Capability, purpose?: string): Promise<ModelRef> {
    const ref = await this.resolve(cap);
    if (!ref) {
      throw new ApiError(
        400,
        "model_not_configured",
        `${purpose ? `${purpose}需要` : "需要"}${CAP_LABEL[cap]}模型：请在「设置 → 模型」中添加提供方，并为「${CAP_LABEL[cap]}」分配模型`,
      );
    }
    return ref;
  }

  /** 对话模型。choice 为对话里选定的模型；它所在的 provider 被删除或停用时退回全局分配。 */
  async chat(choice?: ModelChoice | null): Promise<ModelRef> {
    if (choice) {
      const p = await this.store.providers.get(choice.providerId);
      if (p?.enabled && supportsCapability(p.kind, "chat"))
        return { provider: await this.runtime(p.id), model: choice.model };
    }
    return this.require("chat");
  }

  /** Embedding 模型；未配置时返回 null，检索只用关键词。 */
  embedding(): Promise<ModelRef | null> {
    return this.resolve("embedding");
  }

  /** 当前 embedding 模型的唯一键（providerId:model），未配置时为 null。 */
  async embeddingKey(): Promise<string | null> {
    const a = await this.assignment("embedding");
    return a ? `${a.providerId}:${a.model}` : null;
  }
}
