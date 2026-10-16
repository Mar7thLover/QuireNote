/** 模型分配解析：capability → provider（解密 Key）+ 模型名。默认 chat / embedding 使用内置 local。 */
import {
  LOCAL_CHAT_MODEL,
  LOCAL_EMBEDDING_MODEL,
  LOCAL_PROVIDER_ID,
  type ModelRef,
  type ProviderRuntime,
} from "@quirenote/ai";
import type { Capability, ModelAssignment } from "@quirenote/core";
import type { KeyCipher } from "./crypto";
import { ApiError } from "./errors";
import type { Store } from "./store/types";

export const DEFAULT_ASSIGNMENTS: Partial<Record<Capability, ModelAssignment>> = {
  chat: { capability: "chat", providerId: LOCAL_PROVIDER_ID, model: LOCAL_CHAT_MODEL },
  embedding: { capability: "embedding", providerId: LOCAL_PROVIDER_ID, model: LOCAL_EMBEDDING_MODEL },
};

const CAP_LABEL: Record<Capability, string> = {
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

  async runtime(providerId: string): Promise<ProviderRuntime> {
    if (providerId === LOCAL_PROVIDER_ID) return { id: LOCAL_PROVIDER_ID, kind: "local" };
    const p = await this.store.providers.get(providerId);
    if (!p) throw new ApiError(400, "provider_not_found", `provider ${providerId} 不存在`);
    if (!p.enabled) throw new ApiError(400, "provider_disabled", `provider「${p.name}」已停用`);
    let apiKey: string | null = null;
    if (p.keyEnc) {
      try {
        apiKey = this.cipher.decrypt(p.keyEnc);
      } catch {
        throw new ApiError(
          500,
          "key_decrypt_failed",
          `provider「${p.name}」的 Key 无法解密（QUIRENOTE_SECRET 或 secret.key 可能已变更），请重新填写`,
        );
      }
    }
    return {
      id: p.id,
      kind: p.kind,
      baseUrl: p.baseUrl,
      apiKey,
      ...(this.fetchImpl ? { fetch: this.fetchImpl } : {}),
    };
  }

  async assignment(cap: Capability): Promise<ModelAssignment | null> {
    return (await this.store.assignments.get(cap)) ?? DEFAULT_ASSIGNMENTS[cap] ?? null;
  }

  /** 解析能力对应的模型；未分配时返回 null（chat / embedding 永远有默认值）。 */
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
        `${purpose ? `${purpose}需要` : ""}${CAP_LABEL[cap]}模型：请在「设置 → 模型」中添加 provider 并为「${CAP_LABEL[cap]}」分配模型`,
      );
    }
    return ref;
  }

  chat(): Promise<ModelRef> {
    return this.require("chat");
  }

  embedding(): Promise<ModelRef> {
    return this.require("embedding");
  }

  /** 当前 embedding 模型的唯一键（providerId:model）。 */
  async embeddingKey(): Promise<string> {
    const a = (await this.assignment("embedding"))!;
    return `${a.providerId}:${a.model}`;
  }
}
