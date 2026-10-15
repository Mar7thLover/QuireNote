/** Provider 管理：Key 加密入库，对外只暴露 hasKey / keyHint。 */
import { readFileSync } from "node:fs";
import { defaultModel, LOCAL_PROVIDER_ID, supportsCapability } from "@folio/ai";
import {
  type Capability,
  type ModelAssignment,
  newId,
  nowIso,
  type ProviderConfig,
  type ProviderInput,
  type ProviderKind,
} from "@folio/core";
import type { AppContext } from "../context";
import { keyHint } from "../crypto";
import { badRequest, notFound } from "../errors";
import { DEFAULT_ASSIGNMENTS } from "../models";
import type { ProviderRecord } from "../store/types";

export function publicProvider(p: ProviderRecord): ProviderConfig {
  return {
    id: p.id,
    kind: p.kind,
    name: p.name,
    baseUrl: p.baseUrl,
    hasKey: !!p.keyEnc,
    keyHint: p.keyEnc ? p.keyHint : null,
    enabled: p.enabled,
    createdAt: p.createdAt,
  };
}

export async function createProvider(ctx: AppContext, input: ProviderInput): Promise<ProviderRecord> {
  const ts = nowIso();
  const key = input.apiKey?.trim();
  const rec: ProviderRecord = {
    id: newId("prov"),
    kind: input.kind,
    name: input.name.trim(),
    baseUrl: input.baseUrl?.trim() || null,
    keyEnc: key ? ctx.cipher.encrypt(key) : null,
    keyHint: key ? keyHint(key) : null,
    enabled: input.enabled ?? true,
    createdAt: ts,
    updatedAt: ts,
  };
  if (rec.kind === "openai-compatible" && !rec.baseUrl) throw badRequest("OpenAI 兼容接口需要填写 baseUrl");
  await ctx.store.providers.insert(rec);
  return rec;
}

export async function updateProvider(
  ctx: AppContext,
  id: string,
  patch: { name?: string; baseUrl?: string | null; apiKey?: string | null; enabled?: boolean },
): Promise<ProviderRecord> {
  const cur = await ctx.store.providers.get(id);
  if (!cur) throw notFound("Provider");
  const next: Partial<ProviderRecord> = {};
  if (patch.name !== undefined) next.name = patch.name.trim() || cur.name;
  if (patch.baseUrl !== undefined) next.baseUrl = patch.baseUrl?.trim() || null;
  if (patch.enabled !== undefined) next.enabled = patch.enabled;
  if (patch.apiKey !== undefined) {
    const key = patch.apiKey?.trim();
    // 空字符串或 null 表示清除 Key。
    next.keyEnc = key ? ctx.cipher.encrypt(key) : null;
    next.keyHint = key ? keyHint(key) : null;
  }
  return (await ctx.store.providers.update(id, next))!;
}

export async function deleteProvider(ctx: AppContext, id: string): Promise<boolean> {
  const ok = await ctx.store.providers.delete(id);
  if (ok) {
    // 引用该 provider 的分配回退为默认值。
    for (const a of await ctx.store.assignments.list())
      if (a.providerId === id) await ctx.store.assignments.delete(a.capability);
  }
  return ok;
}

/** 当前生效的分配（含 chat / embedding 的默认 local）。 */
export async function effectiveAssignments(ctx: AppContext): Promise<ModelAssignment[]> {
  const stored = await ctx.store.assignments.list();
  const caps = new Set(stored.map((a) => a.capability));
  const defaults = Object.values(DEFAULT_ASSIGNMENTS).filter(
    (a): a is ModelAssignment => !!a && !caps.has(a.capability),
  );
  const order: Capability[] = ["chat", "embedding", "search", "tts", "stt", "image", "video"];
  return [...stored, ...defaults].sort((a, b) => order.indexOf(a.capability) - order.indexOf(b.capability));
}

export async function validateAssignment(ctx: AppContext, a: ModelAssignment): Promise<void> {
  if (!a.model.trim()) throw badRequest("model 不能为空");
  if (a.providerId === LOCAL_PROVIDER_ID) {
    if (!supportsCapability("local", a.capability)) throw badRequest(`local provider 不支持 ${a.capability}`);
    return;
  }
  const p = await ctx.store.providers.get(a.providerId);
  if (!p) throw badRequest(`provider ${a.providerId} 不存在`);
  if (!supportsCapability(p.kind, a.capability))
    throw badRequest(`${p.name}（${p.kind}）不支持 ${a.capability} 能力`);
}

// ───────────── 从环境变量引导 provider ─────────────

const ENV_PROVIDERS: { env: string; kind: ProviderKind; name: string }[] = [
  { env: "ANTHROPIC_API_KEY", kind: "anthropic", name: "Anthropic" },
  { env: "OPENAI_API_KEY", kind: "openai", name: "OpenAI" },
  { env: "GOOGLE_GENERATIVE_AI_API_KEY", kind: "google", name: "Google Gemini" },
  { env: "TAVILY_API_KEY", kind: "tavily", name: "Tavily" },
  { env: "BRAVE_API_KEY", kind: "brave", name: "Brave Search" },
];

export const BOOTSTRAP_ENV_VARS = ENV_PROVIDERS.flatMap((p) => [p.env, `${p.env}_FILE`]);

/** 读取 `NAME` 或 `NAME_FILE`（Docker secrets：文件路径，读取内容并 trim）。出错时不回显内容。 */
export function readEnvSecret(
  env: NodeJS.ProcessEnv,
  name: string,
  log: (msg: string) => void = () => {},
): string | null {
  const file = env[`${name}_FILE`]?.trim();
  if (file) {
    try {
      const v = readFileSync(file, "utf8").trim();
      return v || null;
    } catch (err) {
      log(`无法读取 ${name}_FILE 指向的文件（${(err as NodeJS.ErrnoException).code ?? "error"}），已忽略`);
      return null;
    }
  }
  return env[name]?.trim() || null;
}

/**
 * 启动时从环境变量创建 provider（该 kind 尚无 provider 时）。
 * chat 仍为 local 时改用 Anthropic claude-sonnet-5-5（没有 Anthropic Key 时依次尝试 OpenAI / Gemini）；
 * search 未分配时用 Tavily / Brave。日志只输出 keyHint。
 */
export async function bootstrapProvidersFromEnv(
  ctx: AppContext,
  env: NodeJS.ProcessEnv,
  log: (msg: string) => void = () => {},
): Promise<string[]> {
  const created: string[] = [];
  const existing = await ctx.store.providers.list();
  const byKind = new Map<ProviderKind, ProviderRecord>();
  for (const p of existing) if (!byKind.has(p.kind)) byKind.set(p.kind, p);
  for (const spec of ENV_PROVIDERS) {
    const key = readEnvSecret(env, spec.env, log);
    if (!key) continue;
    if (byKind.has(spec.kind)) continue;
    const rec = await createProvider(ctx, {
      kind: spec.kind,
      name: `${spec.name}（环境变量）`,
      apiKey: key,
      enabled: true,
    });
    byKind.set(spec.kind, rec);
    created.push(rec.id);
    log(`已从环境变量 ${spec.env} 创建 provider「${rec.name}」（Key ${rec.keyHint}）`);
  }
  const usable = (kind: ProviderKind) => {
    const p = byKind.get(kind);
    return p?.enabled && p.keyEnc ? p : null;
  };
  const chat = await ctx.store.assignments.get("chat");
  if (!chat || chat.providerId === LOCAL_PROVIDER_ID) {
    const pick = (["anthropic", "openai", "google"] as const).map((k) => usable(k)).find((p) => p);
    if (pick) {
      const model = pick.kind === "anthropic" ? "claude-sonnet-5-5" : (defaultModel(pick.kind, "chat") ?? "");
      await ctx.store.assignments.set({ capability: "chat", providerId: pick.id, model });
      log(`对话模型已分配为 ${pick.name} / ${model}`);
    }
  }
  if (!(await ctx.store.assignments.get("search"))) {
    const pick = usable("tavily") ?? usable("brave");
    if (pick) {
      await ctx.store.assignments.set({
        capability: "search",
        providerId: pick.id,
        model: defaultModel(pick.kind, "search") ?? "",
      });
      log(`联网搜索已分配为 ${pick.name}`);
    }
  }
  return created;
}
