/** 知识书：每本 Notebook 一本，设置存在 Notebook 上，条目单独存储。触发规则见 @quirenote/card 的 activateLore。 */
import { activateLore, type LoreActivation, riskyLoreKeys } from "@quirenote/card";
import {
  type CardLorebook,
  DEFAULT_LOREBOOK,
  type LorebookSettings,
  type LoreEntry,
  LoreEntryFields,
  LoreEntryInput,
  type Message,
  newId,
  nowIso,
  type UsedLore,
} from "@quirenote/core";
import type { AppContext } from "../context";
import { notFound } from "../errors";
import { currentLang, parseLang } from "../lang";
import { getPreset } from "./presets";

export async function lorebookSettings(ctx: AppContext, notebookId: string): Promise<LorebookSettings> {
  const nb = await ctx.store.notebooks.get(notebookId);
  if (!nb) throw notFound("notebook");
  return { ...DEFAULT_LOREBOOK, ...(nb.lorebook ?? {}) };
}

export async function listLore(ctx: AppContext, notebookId: string): Promise<LoreEntry[]> {
  const list = await ctx.store.lore.list({ notebookId });
  return list.sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
}

export async function updateLorebookSettings(
  ctx: AppContext,
  notebookId: string,
  patch: Partial<LorebookSettings>,
): Promise<LorebookSettings> {
  const next = { ...(await lorebookSettings(ctx, notebookId)), ...patch };
  await ctx.store.notebooks.update(notebookId, { lorebook: next, updatedAt: nowIso() });
  return next;
}

export async function createLoreEntry(
  ctx: AppContext,
  notebookId: string,
  input: LoreEntryInput,
): Promise<LoreEntry> {
  const ts = nowIso();
  const entry: LoreEntry = {
    ...LoreEntryFields.parse(input),
    id: newId("lore"),
    notebookId,
    createdAt: ts,
    updatedAt: ts,
  };
  await ctx.store.lore.insert(entry);
  return entry;
}

export async function updateLoreEntry(
  ctx: AppContext,
  id: string,
  patch: LoreEntryInput,
): Promise<LoreEntry> {
  const cur = await ctx.store.lore.get(id);
  if (!cur) throw notFound("loreEntry");
  const next = { ...cur, ...LoreEntryInput.parse(patch), updatedAt: nowIso() };
  return (await ctx.store.lore.update(id, next))!;
}

/** 把整本知识书导出成卡片格式。 */
export async function exportLorebook(ctx: AppContext, notebookId: string): Promise<CardLorebook> {
  const settings = await lorebookSettings(ctx, notebookId);
  const entries = (await listLore(ctx, notebookId)).map(
    ({ notebookId: _n, createdAt: _c, updatedAt: _u, ...e }) => e,
  );
  return { ...settings, entries };
}

const en = (lang?: string) => (parseLang(lang) ?? currentLang()) === "en";

/** 导入卡片里的知识书：条目重新编号，有回溯风险的正则键所在条目导入为停用。返回导入条数与停用条数。 */
export async function importLorebook(
  ctx: AppContext,
  notebookId: string,
  book: CardLorebook,
  { replaceSettings, lang }: { replaceSettings: boolean; lang?: string },
): Promise<{ created: number; disabled: number }> {
  const why = en(lang)
    ? "Turned off on import: the regex keywords are invalid or could freeze the page."
    : "导入时停用：正则关键词无效或有卡死风险。";
  const risky = new Set(riskyLoreKeys(book.entries).map((r) => r.id));
  if (replaceSettings) {
    const { entries: _e, ...settings } = book;
    await updateLorebookSettings(ctx, notebookId, settings);
  }
  for (const e of book.entries) {
    const { id: _id, ...fields } = e;
    await createLoreEntry(ctx, notebookId, {
      ...fields,
      enabled: fields.enabled && !risky.has(e.id),
      comment: risky.has(e.id)
        ? `${fields.comment}${fields.comment ? "\n" : ""}${why}`.trim()
        : fields.comment,
    });
  }
  return { created: book.entries.length, disabled: risky.size };
}

/** 从元素生成条目：名称和别名作关键词，定义作正文；同名条目已存在时跳过。 */
export async function loreFromElements(
  ctx: AppContext,
  notebookId: string,
  lang?: string,
): Promise<{ created: number }> {
  const [elements, existing] = await Promise.all([
    ctx.store.elements.list({ notebookId }),
    listLore(ctx, notebookId),
  ]);
  const names = new Set(existing.map((e) => e.name.trim().toLowerCase()));
  let created = 0;
  for (const el of elements) {
    if (!el.definition.trim() || names.has(el.name.trim().toLowerCase())) continue;
    await createLoreEntry(ctx, notebookId, {
      name: el.name,
      keys: [el.name, ...el.aliases].filter((k) => k.trim()),
      content: `${el.name}${en(lang) ? ": " : "："}${el.definition.trim()}`,
      comment: en(lang) ? "Generated from an element" : "从元素生成",
    });
    created++;
  }
  return { created };
}

/**
 * 对话用：按历史消息与本次提问触发知识书。
 * history 为从根到上一条的消息路径；助手消息上记着当时用到的条目，用来算 sticky / cooldown。
 */
export async function loreForChat(
  ctx: AppContext,
  notebookId: string,
  history: Message[],
  question: string,
): Promise<LoreActivation & { used: UsedLore[] }> {
  const settings = await lorebookSettings(ctx, notebookId);
  const entries = settings.enabled ? (await listLore(ctx, notebookId)).filter((e) => e.enabled) : [];
  if (!entries.length)
    return { entries: [], trimmed: [], before: "", after: "", atDepth: [], tokens: 0, used: [] };
  const msgs = history.filter((m) => m.role !== "system" && m.content.trim());
  const lastUsed = new Map<string, number>();
  const answers = msgs.filter((m) => m.role === "assistant");
  answers.forEach((m, i) => {
    const ago = answers.length - 1 - i;
    for (const l of m.lore ?? [])
      if (l.trigger !== "sticky") lastUsed.set(l.id, Math.min(lastUsed.get(l.id) ?? ago, ago));
  });
  const act = activateLore({
    settings,
    entries,
    messages: [...msgs.map((m) => m.content), question],
    lastUsed,
    turnCount: msgs.length,
  });
  return {
    ...act,
    used: act.entries.map((a) => ({
      id: a.entry.id,
      name: a.entry.name || a.entry.keys[0] || "",
      trigger: a.trigger,
    })),
  };
}

/** Studio 生成用：扫描生成要求和资料标题，返回 Notebook 说明与触发的条目。 */
export async function notebookContextFor(
  ctx: AppContext,
  notebookId: string,
  text: string,
): Promise<{
  instructions?: string;
  loreBefore?: string;
  loreAfter?: string;
  style?: { instructions?: string; format?: string };
}> {
  const nb = await ctx.store.notebooks.get(notebookId);
  const preset = nb?.defaultPresetId ? await getPreset(ctx, nb.defaultPresetId) : null;
  const settings = { ...DEFAULT_LOREBOOK, ...(nb?.lorebook ?? {}) };
  const entries = settings.enabled ? (await listLore(ctx, notebookId)).filter((e) => e.enabled) : [];
  const act = entries.length ? activateLore({ settings, entries, messages: [text] }) : null;
  return {
    ...(nb?.aiInstructions?.trim() ? { instructions: nb.aiInstructions } : {}),
    ...(preset && (preset.instructions.trim() || preset.format.trim())
      ? { style: { instructions: preset.instructions, format: preset.format } }
      : {}),
    ...(act?.before ? { loreBefore: act.before } : {}),
    ...(act
      ? { loreAfter: [act.after, ...act.atDepth.map((d) => d.content)].filter(Boolean).join("\n\n") }
      : {}),
  };
}

/** 测试面板：输入一段话，看会触发哪些条目（不记录、不受计时影响）。 */
export async function testLore(ctx: AppContext, notebookId: string, text: string): Promise<LoreActivation> {
  const settings = { ...(await lorebookSettings(ctx, notebookId)), enabled: true };
  const entries = await listLore(ctx, notebookId);
  return activateLore({ settings, entries, messages: [text], random: () => 0 });
}
