/** 对话预设：内置的在代码里，自定义的存在设置 `presets` 里。 */
import {
  builtinPresets,
  type ChatPreset,
  ChatPresetFields,
  type ChatPresetInput,
  type ChatPresetPatch,
  type Conversation,
  newId,
  PRESET_FILE_FORMAT,
  PresetFile,
} from "@quirenote/core";
import {
  isStPreset,
  presetToStPreset,
  PLUGIN_ID as ST,
  stPresetToPreset,
} from "@quirenote/plugin-sillytavern";
import type { AppContext } from "../context";
import { ApiError, badRequest, notFound } from "../errors";
import { requirePlugin } from "../plugins";

const KEY = "presets";

async function custom(ctx: AppContext): Promise<ChatPreset[]> {
  return (await ctx.store.settings.get<ChatPreset[]>(KEY)) ?? [];
}

export async function listPresets(ctx: AppContext, lang?: string): Promise<ChatPreset[]> {
  return [...builtinPresets(lang), ...(await custom(ctx))];
}

export async function getPreset(ctx: AppContext, id: string, lang?: string): Promise<ChatPreset | null> {
  return (await listPresets(ctx, lang)).find((p) => p.id === id) ?? null;
}

export async function createPreset(ctx: AppContext, input: ChatPresetInput): Promise<ChatPreset> {
  const preset: ChatPreset = { ...ChatPresetFields.parse(input), id: newId("preset"), builtin: false };
  const list = await custom(ctx);
  if (list.length >= 200) throw badRequest("自定义预设最多 200 个");
  await ctx.store.settings.set(KEY, [...list, preset]);
  return preset;
}

export async function updatePreset(ctx: AppContext, id: string, patch: ChatPresetPatch): Promise<ChatPreset> {
  if (id.startsWith("builtin.")) throw badRequest("内置预设不能修改，可以复制一份再改");
  const list = await custom(ctx);
  const cur = list.find((p) => p.id === id);
  if (!cur) throw notFound("预设");
  const next: ChatPreset = { ...cur, ...patch, id, builtin: false };
  await ctx.store.settings.set(
    KEY,
    list.map((p) => (p.id === id ? next : p)),
  );
  return next;
}

export async function deletePreset(ctx: AppContext, id: string): Promise<void> {
  if (id.startsWith("builtin.")) throw badRequest("内置预设不能删除");
  const list = await custom(ctx);
  if (!list.some((p) => p.id === id)) throw notFound("预设");
  await ctx.store.settings.set(
    KEY,
    list.filter((p) => p.id !== id),
  );
  // 用到它的 Notebook 默认值与对话回到默认风格
  for (const nb of await ctx.store.notebooks.list())
    if (nb.defaultPresetId === id) await ctx.store.notebooks.update(nb.id, { defaultPresetId: null });
}

/** 这一轮对话用哪个预设：对话自己选的，否则 Notebook 的默认。找不到（已删除）时为 null。 */
export async function presetFor(
  ctx: AppContext,
  conv: Pick<Conversation, "presetId" | "notebookId">,
): Promise<ChatPreset | null> {
  const nb = await ctx.store.notebooks.get(conv.notebookId);
  const id = conv.presetId ?? nb?.defaultPresetId ?? null;
  return id ? getPreset(ctx, id) : null;
}

/** 导入预设文件：QuireNote 预设，或（启用插件时）酒馆预设。 */
export async function importPresetFile(
  ctx: AppContext,
  bytes: Uint8Array,
  filename: string,
  lang?: string,
): Promise<{ preset: ChatPreset; warnings: string[] }> {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes).replace(/^﻿/, ""));
  } catch {
    throw badRequest("文件不是有效的 JSON", "invalid_json");
  }
  const own = PresetFile.safeParse(value);
  if (own.success) return { preset: await createPreset(ctx, own.data.preset), warnings: [] };
  if (isStPreset(value)) {
    await requirePlugin(ctx, ST, lang);
    const { preset, warnings } = stPresetToPreset(value, { filename, lang });
    return { preset: await createPreset(ctx, preset), warnings };
  }
  throw new ApiError(400, "unknown_format", "认不出这个预设文件");
}

export async function exportPreset(
  ctx: AppContext,
  id: string,
  format: "quire" | "sillytavern",
  lang?: string,
): Promise<{ json: unknown; name: string }> {
  const p = await getPreset(ctx, id, lang);
  if (!p) throw notFound("预设");
  const { id: _id, builtin: _b, ...fields } = p;
  if (format === "sillytavern") {
    await requirePlugin(ctx, ST, lang);
    return { json: presetToStPreset(fields), name: p.name };
  }
  return { json: { format: PRESET_FILE_FORMAT, version: 1, preset: fields }, name: p.name };
}
