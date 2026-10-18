/** 模型分配解析：capability → provider（解密 Key 与自定义请求头）+ 模型名。没有内置模型，未分配即未配置。 */
import { type ModelRef, type ProviderRuntime, supportsCapability } from "@quirenote/ai";
import type { Capability, ModelAssignment, ModelChoice } from "@quirenote/core";
import type { KeyCipher } from "./crypto";
import { ApiError } from "./errors";
import { msg, type ServerMessages } from "./messages";
import type { ProviderRecord, Store } from "./store/types";

/** 早期版本内置的离线 provider id；遗留的分配一律视为未配置。 */
export const LEGACY_LOCAL_PROVIDER_ID = "local";

/** 本地日期 YYYY-MM-DD（用量按用户所在时区的自然日统计）。 */
export function localDay(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 能力名（按界面语言）。 */
export const capLabel = (cap: Capability): string => msg().cap[cap];

export class ModelResolver {
  constructor(
    private readonly store: Store,
    private readonly cipher: KeyCipher,
    /** 测试时注入给所有 provider 的 fetch。 */
    private readonly fetchImpl?: typeof fetch,
  ) {}

  private decrypt(p: ProviderRecord, enc: string, what: "key" | "headers"): string {
    try {
      return this.cipher.decrypt(enc);
    } catch {
      throw new ApiError(500, "key_decrypt_failed", msg().keyDecryptFailed(p.name, what));
    }
  }

  async runtime(providerId: string): Promise<ProviderRuntime> {
    const p = await this.store.providers.get(providerId);
    if (!p) throw new ApiError(400, "provider_not_found", msg().providerNotFound(providerId));
    if (!p.enabled) throw new ApiError(400, "provider_disabled", msg().providerDisabled(p.name));
    const apiKey = p.keyEnc ? this.decrypt(p, p.keyEnc, "key") : null;
    const headers = p.headersEnc
      ? (JSON.parse(this.decrypt(p, p.headersEnc, "headers")) as Record<string, string>)
      : null;
    return {
      id: p.id,
      kind: p.kind,
      baseUrl: p.baseUrl,
      apiKey,
      headers,
      onUsage: (e) => {
        void this.store.usage.add({ ...e, day: localDay() }).catch(() => {});
      },
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

  async require(cap: Capability, purpose?: keyof ServerMessages["purpose"]): Promise<ModelRef> {
    const ref = await this.resolve(cap);
    if (!ref) {
      const m = msg();
      throw new ApiError(
        400,
        "model_not_configured",
        m.modelRequired(m.cap[cap], purpose && m.purpose[purpose]),
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

  /** 检索用的模型：有 Embedding 用向量；没有时用对话模型扩展检索词（都没有就只做关键词检索）。 */
  async retrieval(): Promise<{ embedding: ModelRef | null; expand: ModelRef | null }> {
    const embedding = await this.embedding();
    if (embedding) return { embedding, expand: null };
    return { embedding: null, expand: await this.resolve("chat").catch(() => null) };
  }

  /** 当前 embedding 模型的唯一键（providerId:model），未配置时为 null。 */
  async embeddingKey(): Promise<string | null> {
    const a = await this.assignment("embedding");
    return a ? `${a.providerId}:${a.model}` : null;
  }
}
