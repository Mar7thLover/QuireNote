/** Provider 管理：Key 与自定义请求头加密入库，对外只暴露 hasKey / keyHint / headerNames。 */
import { readFileSync } from "node:fs";
import { catalogEntry, catalogModels, defaultModel, supportsCapability } from "@quirenote/ai";
import {
  type Capability,
  type ModelAssignment,
  newId,
  nowIso,
  type ProviderConfig,
  type ProviderHeaders,
  type ProviderHeadersPatch,
  type ProviderInput,
  type ProviderKind,
  type ProviderModel,
} from "@quirenote/core";
import type { AppContext } from "../context";
import { keyHint } from "../crypto";
import { badRequest, notFound } from "../errors";
import { CAP_LABEL, LEGACY_LOCAL_PROVIDER_ID } from "../models";
import type { ProviderRecord } from "../store/types";

const CAP_ORDER: Capability[] = ["chat", "embedding", "search", "tts", "stt", "image", "video"];

/** 登记的模型；早期记录没有 models 字段时用目录里的示例模型。 */
export function providerModels(p: ProviderRecord): ProviderModel[] {
  return p.models ?? catalogModels(p.kind);
}

export function publicProvider(p: ProviderRecord): ProviderConfig {
  return {
    id: p.id,
    kind: p.kind,
    name: p.name,
    baseUrl: p.baseUrl,
    hasKey: !!p.keyEnc,
    keyHint: p.keyEnc ? p.keyHint : null,
    headerNames: p.headersEnc ? (p.headerNames ?? []) : [],
    models: providerModels(p),
    enabled: p.enabled,
    createdAt: p.createdAt,
  };
}

/** 去重（同 ID 合并能力）、去掉该类型不支持的能力；能力为空的模型视为错误。 */
export function normalizeModels(kind: ProviderKind, models: ProviderModel[]): ProviderModel[] {
  const byId = new Map<string, ProviderModel>();
  for (const m of models) {
    const id = m.id.trim();
    const caps = m.capabilities.filter((c) => supportsCapability(kind, c));
    if (!caps.length) {
      throw badRequest(
        `模型 ${id} 的用途（${m.capabilities.map((c) => CAP_LABEL[c]).join("、")}）不是 ${catalogEntry(kind).label} 支持的能力`,
      );
    }
    const cur = byId.get(id);
    if (cur) cur.capabilities = [...new Set([...cur.capabilities, ...caps])];
    else byId.set(id, { id, label: m.label?.trim() || null, capabilities: [...new Set(caps)] });
  }
  for (const m of byId.values()) m.capabilities.sort((a, b) => CAP_ORDER.indexOf(a) - CAP_ORDER.indexOf(b));
  return [...byId.values()];
}

function encodeHeaders(
  ctx: AppContext,
  headers: ProviderHeaders | null | undefined,
): Pick<ProviderRecord, "headersEnc" | "headerNames"> {
  const entries = Object.entries(headers ?? {})
    .map(([k, v]) => [k.trim(), v.trim()] as const)
    .filter(([k]) => k);
  if (!entries.length) return { headersEnc: null, headerNames: [] };
  return {
    headersEnc: ctx.cipher.encrypt(JSON.stringify(Object.fromEntries(entries))),
    headerNames: entries.map(([k]) => k),
  };
}

function decodeHeaders(ctx: AppContext, p: ProviderRecord): ProviderHeaders {
  return p.headersEnc ? (JSON.parse(ctx.cipher.decrypt(p.headersEnc)) as ProviderHeaders) : {};
}

function checkBaseUrl(kind: ProviderKind, baseUrl: string | null): void {
  const entry = catalogEntry(kind);
  if (entry.baseUrlRequired && !entry.defaultBaseUrl && !baseUrl)
    throw badRequest(`${entry.label}需要填写 baseUrl`);
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
    ...encodeHeaders(ctx, input.headers),
    models: normalizeModels(input.kind, input.models ?? catalogModels(input.kind)),
    enabled: input.enabled ?? true,
    createdAt: ts,
    updatedAt: ts,
  };
  checkBaseUrl(rec.kind, rec.baseUrl);
  await ctx.store.providers.insert(rec);
  return rec;
}

export interface ProviderPatch {
  name?: string;
  baseUrl?: string | null;
  apiKey?: string | null;
  enabled?: boolean;
  models?: ProviderModel[];
  /** 按名称合并（值为 null 删除该项）；整个字段为 null 表示清除全部自定义请求头。 */
  headers?: ProviderHeadersPatch | null;
}

export async function updateProvider(
  ctx: AppContext,
  id: string,
  patch: ProviderPatch,
): Promise<ProviderRecord> {
  const cur = await ctx.store.providers.get(id);
  if (!cur) throw notFound("Provider");
  const next: Partial<ProviderRecord> = {};
  if (patch.name !== undefined) next.name = patch.name.trim() || cur.name;
  if (patch.baseUrl !== undefined) {
    next.baseUrl = patch.baseUrl?.trim() || null;
    checkBaseUrl(cur.kind, next.baseUrl);
  }
  if (patch.enabled !== undefined) next.enabled = patch.enabled;
  if (patch.apiKey !== undefined) {
    const key = patch.apiKey?.trim();
    // 空字符串或 null 表示清除 Key。
    next.keyEnc = key ? ctx.cipher.encrypt(key) : null;
    next.keyHint = key ? keyHint(key) : null;
  }
  if (patch.models !== undefined) next.models = normalizeModels(cur.kind, patch.models);
  if (patch.headers !== undefined) {
    const merged: ProviderHeaders = patch.headers === null ? {} : decodeHeaders(ctx, cur);
    for (const [k, v] of Object.entries(patch.headers ?? {})) {
      // 名称大小写不敏感：同名的旧值先删掉。
      for (const old of Object.keys(merged)) if (old.toLowerCase() === k.toLowerCase()) delete merged[old];
      if (v !== null) merged[k] = v;
    }
    Object.assign(next, encodeHeaders(ctx, merged));
  }
  return (await ctx.store.providers.update(id, next))!;
}

export async function deleteProvider(ctx: AppContext, id: string): Promise<boolean> {
  const ok = await ctx.store.providers.delete(id);
  if (ok) {
    // 引用该 provider 的分配一并清除（该能力回到未配置）。
    for (const a of await ctx.store.assignments.list())
      if (a.providerId === id) await ctx.store.assignments.delete(a.capability);
  }
  return ok;
}

/** 当前生效的分配（未分配的能力不出现）。 */
export async function effectiveAssignments(ctx: AppContext): Promise<ModelAssignment[]> {
  return (await ctx.store.assignments.list())
    .filter((a) => a.providerId !== LEGACY_LOCAL_PROVIDER_ID)
    .sort((a, b) => CAP_ORDER.indexOf(a.capability) - CAP_ORDER.indexOf(b.capability));
}

/** 校验「某 provider + 模型」可用于某能力。 */
export async function validateModelChoice(
  ctx: AppContext,
  cap: Capability,
  providerId: string,
  model: string,
): Promise<void> {
  if (!model.trim()) throw badRequest("model 不能为空");
  const p = await ctx.store.providers.get(providerId);
  if (!p) throw badRequest(`provider ${providerId} 不存在`);
  if (!supportsCapability(p.kind, cap)) throw badRequest(`${p.name}（${p.kind}）不支持${CAP_LABEL[cap]}`);
}

export function validateAssignment(ctx: AppContext, a: ModelAssignment): Promise<void> {
  return validateModelChoice(ctx, a.capability, a.providerId, a.model);
}

/**
 * 早期版本内置的 local provider 已移除：删掉指向它的分配和它生成的向量
 * （它是未分配时的默认值，所以即使没有分配记录，也可能留有向量）。返回是否做了清理。
 */
export async function removeLegacyLocal(ctx: AppContext): Promise<boolean> {
  const prefix = `${LEGACY_LOCAL_PROVIDER_ID}:`;
  const legacy = (await ctx.store.assignments.list()).filter(
    (a) => a.providerId === LEGACY_LOCAL_PROVIDER_ID,
  );
  for (const a of legacy) await ctx.store.assignments.delete(a.capability);
  const vectors = await ctx.store.chunks.embeddedCount({ modelPrefix: prefix });
  if (vectors) await ctx.store.chunks.clearEmbeddings({ modelPrefix: prefix });
  return legacy.length > 0 || vectors > 0;
}

/**
 * 自动补位的能力：只有用到时才产生费用、换模型也没有副作用的这几种。
 * Embedding 会触发重建索引、TTS / STT 会产生合成费用，仍由用户自己分配。
 */
const AUTO_FILL: Capability[] = ["chat", "search", "image"];

/** 新加（或刚升级）的提供方支持、但还没分配模型的能力，直接用它的默认模型补上。返回补上的能力。 */
export async function fillUnassigned(ctx: AppContext, p: ProviderRecord): Promise<Capability[]> {
  if (!p.enabled) return [];
  const filled: Capability[] = [];
  const models = providerModels(p);
  for (const cap of AUTO_FILL) {
    if (!supportsCapability(p.kind, cap) || (await ctx.models.assignment(cap))) continue;
    const preferred = defaultModel(p.kind, cap);
    const model =
      models.find((m) => m.id === preferred && m.capabilities.includes(cap))?.id ??
      models.find((m) => m.capabilities.includes(cap))?.id;
    if (!model) continue;
    await ctx.store.assignments.set({ capability: cap, providerId: p.id, model });
    filled.push(cap);
  }
  return filled;
}

/** 目录升级的版本号：2 = Anthropic 增加了联网搜索与矢量插图；3 = 新能力自动补上分配。 */
const CATALOG_UPGRADE = 3;

/**
 * 目录给某类提供方增加了能力时，把新能力补到已登记的同名示例模型上；
 * 该能力一个模型都没有时，再补上目录里的默认模型。每个版本只做一次，不覆盖用户之后的改动。
 */
export async function upgradeProviderModels(ctx: AppContext): Promise<number> {
  const done = (await ctx.store.settings.get<number>("providerCatalogUpgrade")) ?? 0;
  if (done >= CATALOG_UPGRADE) return 0;
  let changed = 0;
  for (const p of await ctx.store.providers.list()) {
    if (!p.models) continue;
    const catalog = catalogModels(p.kind);
    const models = p.models.map((m) => {
      const known = catalog.find((c) => c.id === m.id);
      return known ? { ...m, capabilities: [...new Set([...m.capabilities, ...known.capabilities])] } : m;
    });
    for (const cap of catalogEntry(p.kind).capabilities) {
      if (models.some((m) => m.capabilities.includes(cap))) continue;
      const id = defaultModel(p.kind, cap);
      if (id) models.push({ id, label: null, capabilities: [cap] });
    }
    const next = normalizeModels(p.kind, models);
    let current = p;
    if (JSON.stringify(next) !== JSON.stringify(p.models)) {
      current = (await ctx.store.providers.update(p.id, { models: next, updatedAt: nowIso() })) ?? p;
      changed++;
    }
    if (current.keyEnc || !catalogEntry(current.kind).requiresKey)
      changed += (await fillUnassigned(ctx, current)).length;
  }
  await ctx.store.settings.set("providerCatalogUpgrade", CATALOG_UPGRADE);
  return changed;
}

// ───────────── 从环境变量引导 provider ─────────────

const ENV_PROVIDERS: { env: string; kind: ProviderKind; name: string }[] = [
  { env: "ANTHROPIC_API_KEY", kind: "anthropic", name: "Anthropic" },
  { env: "OPENAI_API_KEY", kind: "openai", name: "OpenAI" },
  { env: "GOOGLE_GENERATIVE_AI_API_KEY", kind: "google", name: "Google Gemini" },
  { env: "TAVILY_API_KEY", kind: "tavily", name: "Tavily" },
  { env: "BRAVE_API_KEY", kind: "brave", name: "Brave Search" },
];

/** OpenAI 兼容接口：以 BASE_URL 为准（Key 可选），模型名分别指定。 */
const COMPAT_ENV = {
  baseUrl: "OPENAI_COMPATIBLE_BASE_URL",
  key: "OPENAI_COMPATIBLE_API_KEY",
  chat: "OPENAI_COMPATIBLE_CHAT_MODEL",
  embedding: "OPENAI_COMPATIBLE_EMBEDDING_MODEL",
};

export const BOOTSTRAP_ENV_VARS = [
  ...ENV_PROVIDERS.flatMap((p) => [p.env, `${p.env}_FILE`]),
  COMPAT_ENV.baseUrl,
  COMPAT_ENV.key,
  `${COMPAT_ENV.key}_FILE`,
  COMPAT_ENV.chat,
  COMPAT_ENV.embedding,
];

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

async function bootstrapCompatible(
  ctx: AppContext,
  env: NodeJS.ProcessEnv,
  existing: ProviderRecord[],
  log: (msg: string) => void,
): Promise<ProviderRecord | null> {
  const baseUrl = env[COMPAT_ENV.baseUrl]?.trim().replace(/\/+$/, "");
  if (!baseUrl) return null;
  const found = existing.find(
    (p) => p.kind === "openai-compatible" && p.baseUrl?.replace(/\/+$/, "") === baseUrl,
  );
  if (found) return found;
  const chat = env[COMPAT_ENV.chat]?.trim();
  const embedding = env[COMPAT_ENV.embedding]?.trim();
  const models: ProviderModel[] = [
    ...(chat ? [{ id: chat, label: null, capabilities: ["chat" as const] }] : []),
    ...(embedding ? [{ id: embedding, label: null, capabilities: ["embedding" as const] }] : []),
  ];
  const key = readEnvSecret(env, COMPAT_ENV.key, log);
  const rec = await createProvider(ctx, {
    kind: "openai-compatible",
    name: "OpenAI 兼容接口（环境变量）",
    baseUrl,
    ...(key ? { apiKey: key } : {}),
    ...(models.length ? { models } : {}),
    enabled: true,
  });
  log(`已从环境变量 ${COMPAT_ENV.baseUrl} 创建 provider「${rec.name}」（${baseUrl}）`);
  return rec;
}

/**
 * 启动时从环境变量创建 provider（该 kind 尚无 provider 时），并为未分配的能力补上分配：
 * 对话依次用 Anthropic claude-sonnet-5-5 / OpenAI / Gemini / OpenAI 兼容接口；
 * Embedding 用 OpenAI / Gemini / 指定了 Embedding 模型的 OpenAI 兼容接口；
 * 联网搜索用 Tavily / Brave。日志只输出 keyHint。
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
  const compat = await bootstrapCompatible(ctx, env, existing, log);
  if (compat && !existing.includes(compat)) created.push(compat.id);

  const usable = (kind: ProviderKind) => {
    const p = byKind.get(kind);
    return p?.enabled && p.keyEnc ? p : null;
  };
  // 只用环境变量明确指定的模型，不拿目录示例模型去猜。
  const compatModel = (cap: "chat" | "embedding") =>
    compat?.enabled ? env[cap === "chat" ? COMPAT_ENV.chat : COMPAT_ENV.embedding]?.trim() || null : null;
  const assign = async (cap: Capability, p: ProviderRecord, model: string) => {
    await ctx.store.assignments.set({ capability: cap, providerId: p.id, model });
    log(`${CAP_LABEL[cap]}模型已分配为 ${p.name} / ${model}`);
  };

  if (!(await ctx.models.assignment("chat"))) {
    const pick = (["anthropic", "openai", "google"] as const).map((k) => usable(k)).find((p) => p);
    if (pick)
      await assign(
        "chat",
        pick,
        pick.kind === "anthropic" ? "claude-sonnet-5-5" : (defaultModel(pick.kind, "chat") ?? ""),
      );
    else if (compat && compatModel("chat")) await assign("chat", compat, compatModel("chat")!);
  }
  if (!(await ctx.models.assignment("embedding"))) {
    const pick = (["openai", "google"] as const).map((k) => usable(k)).find((p) => p);
    if (pick) await assign("embedding", pick, defaultModel(pick.kind, "embedding") ?? "");
    else if (compat && compatModel("embedding")) await assign("embedding", compat, compatModel("embedding")!);
  }
  if (!(await ctx.models.assignment("search"))) {
    const pick = usable("tavily") ?? usable("brave");
    if (pick) await assign("search", pick, defaultModel(pick.kind, "search") ?? "");
  }
  // Claude 也能联网搜索、画插图：上面没补上的，用 Anthropic 补。
  const claude = usable("anthropic");
  if (claude)
    for (const cap of await fillUnassigned(ctx, claude)) log(`${CAP_LABEL[cap]}模型已分配为 ${claude.name}`);
  return created;
}
