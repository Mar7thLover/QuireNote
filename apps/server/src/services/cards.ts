/**
 * Quire 卡的导出与导入（规格见 docs/CARD_SPEC.md）。
 * 导出：笔记或整本 Notebook → card.json + 资源；JSON / PNG 把资源内联成 data: URL，.quire 压缩包放进 assets/。
 * 导入：任意卡片文件（含酒馆格式）→ 新建或合并到 Notebook，资源存进本地，正文里的 asset:// 改成新 id。
 */
import { base64ToBytes, bytesToBase64, type ParsedCard } from "@quirenote/card";
import {
  type CardAsset,
  type CardNote,
  type CardTemplate,
  markdownExcerpt,
  mediaKindOf,
  type Note,
  newId,
  nowIso,
  QUIRE_CARD_SPEC,
  QUIRE_CARD_VERSION,
  type QuireCard,
  type QuireCardData,
  type RenderPack,
  type RenderRule,
} from "@quirenote/core";
import { analyzePattern } from "@quirenote/render";
import type { AppContext } from "../context";
import { badRequest, notFound } from "../errors";
import { fetchWithTimeout, UA } from "../ingest/parsers";
import { ASSET_MAX_BYTES, assetIdsIn, readAsset, saveAsset } from "./assets";
import { exportLorebook, importLorebook } from "./lorebook";
import { createNotebook } from "./notebooks";
import { createJsonSource } from "./sources";

export interface ExportOptions {
  /** json：资源内联；zip：资源放进压缩包。PNG 由前端用 json 结果加封面生成。 */
  format: "json" | "zip";
  render?: boolean;
  lorebook?: boolean;
  sources?: boolean;
  instructions?: boolean;
  creator?: string;
}

export interface ExportedCard {
  card: QuireCard;
  /** zip 格式下压缩包里的资源：路径 → 内容。 */
  files: Map<string, Uint8Array>;
}

const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000) || 0;

/** 只打包正文里实际匹配到的用户规则（以及它们用到的模板）；有回溯风险的规则不在服务端运行，直接带上。 */
function usedRender(pack: RenderPack, texts: string[]): RenderPack | undefined {
  const joined = texts.join("\n").slice(0, 500_000);
  const rules = pack.rules.filter((r) => {
    const a = analyzePattern(r.pattern, r.flags);
    if (!a.valid) return false;
    if (a.risk === "danger") return true;
    try {
      return new RegExp(r.pattern, r.flags.replace(/[gy]/g, "")).test(joined);
    } catch {
      return false;
    }
  });
  const ids = new Set(rules.map((r) => r.templateId).filter(Boolean));
  const templates = pack.templates.filter((t) => ids.has(t.id) && !t.builtin);
  if (!rules.length && !templates.length) return undefined;
  return { rules, templates, ...(pack.theme ? { theme: pack.theme } : {}) };
}

/** Notebook 自己的渲染包 + 用户的全局规则与模板（内置的每个 QuireNote 都有，不打包）。 */
async function renderSources(ctx: AppContext, notebookId: string): Promise<RenderPack> {
  const nb = await ctx.store.notebooks.get(notebookId);
  const [rules, templates] = await Promise.all([
    ctx.store.settings.get<RenderRule[]>("rules"),
    ctx.store.settings.get<CardTemplate[]>("templates"),
  ]);
  return {
    rules: [...(nb?.render?.rules ?? []), ...(rules ?? [])],
    templates: [...(nb?.render?.templates ?? []), ...(templates ?? [])],
    ...(nb?.render?.theme ? { theme: nb.render.theme } : {}),
  };
}

/** 收集正文引用的资源，按格式写成 data: URL 或压缩包内路径。 */
async function collectAssets(
  ctx: AppContext,
  notes: CardNote[],
  format: ExportOptions["format"],
): Promise<{ assets: CardAsset[]; files: Map<string, Uint8Array> }> {
  const assets: CardAsset[] = [];
  const files = new Map<string, Uint8Array>();
  for (const id of new Set(notes.flatMap((n) => assetIdsIn(n.markdown)))) {
    const hit = await readAsset(ctx, id);
    if (!hit) continue;
    const type = mediaKindOf(id) ?? (id.endsWith(".woff2") ? "font" : "x_file");
    const base = {
      id,
      type,
      name: hit.asset.name,
      mime: hit.asset.mime,
      size: hit.asset.size,
      sha256: hit.asset.sha256,
    };
    if (format === "zip") {
      const path = `assets/${type}/${id}`;
      files.set(path, hit.data);
      assets.push({ ...base, uri: `embedded://${path}` });
    } else {
      assets.push({ ...base, uri: `data:${hit.asset.mime};base64,${bytesToBase64(hit.data)}` });
    }
  }
  return { assets, files };
}

function toCardNote(n: Note): CardNote {
  return { id: n.id, title: n.title, markdown: n.markdown, tags: n.tags, kind: n.kind };
}

function wrap(data: QuireCardData): QuireCard {
  return { spec: QUIRE_CARD_SPEC, spec_version: QUIRE_CARD_VERSION, data };
}

export async function exportNoteCard(
  ctx: AppContext,
  noteId: string,
  opts: ExportOptions,
): Promise<ExportedCard> {
  const note = await ctx.store.notes.get(noteId);
  if (!note) throw notFound("笔记");
  const notes = [toCardNote(note)];
  const { assets, files } = await collectAssets(ctx, notes, opts.format);
  const render =
    opts.render === false
      ? undefined
      : usedRender(await renderSources(ctx, note.notebookId), [note.markdown]);
  return {
    card: wrap({
      kind: "note",
      name: note.title || "未命名笔记",
      summary: markdownExcerpt(note.markdown, 140),
      creator: opts.creator ?? "",
      creator_notes: "",
      version: "",
      tags: note.tags,
      created_at: unix(note.createdAt),
      modified_at: unix(note.updatedAt),
      source: [],
      notes,
      sources: [],
      ai_instructions: "",
      ...(render ? { render } : {}),
      assets,
      extensions: {},
    }),
    files,
  };
}

export async function exportNotebookCard(
  ctx: AppContext,
  notebookId: string,
  opts: ExportOptions,
): Promise<ExportedCard> {
  const nb = await ctx.store.notebooks.get(notebookId);
  if (!nb) throw notFound("Notebook");
  const notes = (await ctx.store.notes.list({ notebookId }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(toCardNote);
  const { assets, files } = await collectAssets(ctx, notes, opts.format);
  const sources: QuireCardData["sources"] = [];
  if (opts.sources) {
    for (const s of await ctx.store.sources.list({ notebookId })) {
      const content = await ctx.store.contents.get(s.id);
      if (s.status === "ready" && content?.text.trim())
        sources.push({ id: s.id, title: s.title, kind: s.kind, url: s.url, text: content.text });
    }
  }
  const pack = await renderSources(ctx, notebookId);
  const render =
    opts.render === false
      ? undefined
      : usedRender(
          pack,
          notes.map((n) => n.markdown),
        );
  // Notebook 自己的渲染包整包带上（可能用于对话），全局规则只带用到的。
  const merged = nb.render?.rules.length
    ? {
        rules: [
          ...nb.render.rules,
          ...(render?.rules ?? []).filter((r) => !nb.render!.rules.some((x) => x.id === r.id)),
        ],
        templates: [
          ...nb.render.templates,
          ...(render?.templates ?? []).filter((t) => !nb.render!.templates.some((x) => x.id === t.id)),
        ],
        ...(nb.render.theme ? { theme: nb.render.theme } : {}),
      }
    : render;
  const lorebook = opts.lorebook === false ? undefined : await exportLorebook(ctx, notebookId);
  return {
    card: wrap({
      kind: "notebook",
      name: nb.title,
      summary: nb.description.slice(0, 140),
      creator: opts.creator ?? "",
      creator_notes: "",
      version: "",
      tags: [],
      created_at: unix(nb.createdAt),
      modified_at: unix(nb.updatedAt),
      source: [],
      notebook: { title: nb.title, description: nb.description, icon: nb.icon, color: nb.color },
      notes,
      sources,
      ai_instructions: opts.instructions === false ? "" : (nb.aiInstructions ?? ""),
      ...(opts.render === false || !merged ? {} : { render: merged }),
      ...(lorebook?.entries.length ? { lorebook } : {}),
      assets,
      extensions: {},
    }),
    files,
  };
}

// ───────────── 导入 ─────────────

/** 导入时给用户看的文字，跟随界面语言。 */
const IMPORT_TEXT = {
  zh: {
    untitled: "未命名",
    importedCard: "导入的卡片",
    assetUnreadable: (n: string) => `资源「${n}」无法读取，已跳过`,
    assetFailed: (n: string, why: string) => `资源「${n}」未导入：${why}`,
    sourceFailed: (n: string, why: string) => `资料「${n}」未导入：${why}`,
    rulesDisabled: (n: number) => `${n} 条规则无效或有卡死风险，已停用`,
    loreDisabled: (n: number) => `${n} 条知识书条目的正则关键词无效或有卡死风险，已停用`,
    keptInstructions: "这本 Notebook 已有 AI 说明，卡片里的说明没有覆盖它",
  },
  en: {
    untitled: "Untitled",
    importedCard: "Imported card",
    assetUnreadable: (n: string) => `Couldn't read asset "${n}"; skipped`,
    assetFailed: (n: string, why: string) => `Asset "${n}" wasn't imported: ${why}`,
    sourceFailed: (n: string, why: string) => `Source "${n}" wasn't imported: ${why}`,
    rulesDisabled: (n: number) => `${n} rules were invalid or could freeze the page, so they're turned off`,
    loreDisabled: (n: number) =>
      `${n} lorebook entries had invalid or risky regex keywords, so they're turned off`,
    keptInstructions:
      "This notebook already has AI instructions; the card's instructions didn't replace them",
  },
};
const importText = (lang?: string) =>
  lang?.toLowerCase().startsWith("en") ? IMPORT_TEXT.en : IMPORT_TEXT.zh;

export interface CardPreview {
  format: ParsedCard["format"];
  kind: QuireCardData["kind"];
  name: string;
  summary: string;
  creator: string;
  creatorNotes: string;
  version: string;
  tags: string[];
  /** 封面（不超过 2 MB 时以 data: URL 给前端预览）。 */
  cover: string | null;
  notes: { title: string; chars: number }[];
  sources: number;
  lore: { total: number; constant: { name: string; content: string }[] };
  rules: { total: number; disabled: string[] };
  templates: number;
  assets: number;
  aiInstructions: string;
  warnings: string[];
}

function coverOf(parsed: ParsedCard): string | null {
  const a = parsed.card.data.assets.find((x) => x.type === "cover");
  if (!a) return null;
  if (a.uri.startsWith("data:")) return a.uri.length < 2_800_000 ? a.uri : null;
  const bytes = parsed.files.get(a.uri.replace(/^embedd?ed:\/\//, ""));
  return bytes && bytes.length < 2 * 1024 * 1024
    ? `data:${a.mime || "image/png"};base64,${bytesToBase64(bytes)}`
    : null;
}

/** 规则会不会被停用：无效或有灾难性回溯风险。 */
function riskyRule(r: RenderRule): boolean {
  const a = analyzePattern(r.pattern, r.flags);
  return !a.valid || a.risk === "danger";
}

export function previewCard(parsed: ParsedCard, lang?: string): CardPreview {
  const T = importText(lang);
  const d = parsed.card.data;
  const rules = d.render?.rules ?? [];
  return {
    format: parsed.format,
    kind: d.kind,
    name: d.name,
    summary: d.summary,
    creator: d.creator,
    creatorNotes: d.creator_notes,
    version: d.version,
    tags: d.tags,
    cover: coverOf(parsed),
    notes: d.notes.map((n) => ({ title: n.title, chars: n.markdown.length })),
    sources: d.sources.length,
    lore: {
      total: d.lorebook?.entries.length ?? 0,
      constant: (d.lorebook?.entries ?? [])
        .filter((e) => e.constant && e.enabled)
        .map((e) => ({ name: e.name || e.keys[0] || T.untitled, content: e.content.slice(0, 300) })),
    },
    rules: {
      total: rules.length,
      disabled: rules.filter((r) => !r.enabled || riskyRule(r)).map((r) => r.name),
    },
    templates: d.render?.templates.length ?? 0,
    assets: d.assets.filter((a) => a.type !== "cover").length,
    aiInstructions: d.ai_instructions,
    warnings: parsed.warnings,
  };
}

/** 资源内容：data: URL、压缩包内文件，或 https 外链（下载，失败返回 null）。 */
async function assetBytes(
  ctx: AppContext,
  a: CardAsset,
  files: Map<string, Uint8Array>,
): Promise<Uint8Array | null> {
  if (a.uri.startsWith("data:")) {
    const m = /^data:[^;,]*(;base64)?,(.*)$/s.exec(a.uri);
    if (!m) return null;
    return m[1] ? base64ToBytes(m[2]!) : new TextEncoder().encode(decodeURIComponent(m[2]!));
  }
  if (/^embedd?ed:\/\//.test(a.uri)) return files.get(a.uri.replace(/^embedd?ed:\/\//, "")) ?? null;
  if (/^https?:\/\//.test(a.uri)) return download(ctx, a.uri);
  return null;
}

async function download(ctx: AppContext, url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetchWithTimeout(ctx.fetch, url, { headers: { "user-agent": UA } }, 20_000);
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > ASSET_MAX_BYTES) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.byteLength > ASSET_MAX_BYTES ? null : buf;
  } catch {
    return null;
  }
}

/** 模板 id 与 Notebook 里已有的重名时改名，并同步规则里的引用。 */
function mergeRender(
  existing: RenderPack | undefined,
  incoming: RenderPack,
): { pack: RenderPack; disabled: number } {
  const cur = existing ?? { rules: [], templates: [] };
  const taken = new Set(cur.templates.map((t) => t.id));
  const rename = new Map<string, string>();
  const templates = incoming.templates.map((t) => {
    let id = t.id.startsWith("builtin.") ? `card.${t.id}` : t.id;
    for (let i = 2; taken.has(id); i++) id = `${t.id}-${i}`;
    taken.add(id);
    if (id !== t.id) rename.set(t.id, id);
    return { ...t, id, builtin: false };
  });
  const ruleIds = new Set(cur.rules.map((r) => r.id));
  let disabled = 0;
  const rules = incoming.rules.map((r) => {
    let id = r.id;
    for (let i = 2; ruleIds.has(id); i++) id = `${r.id}-${i}`;
    ruleIds.add(id);
    const risky = riskyRule(r);
    if (risky && r.enabled) disabled++;
    return {
      ...r,
      id,
      enabled: r.enabled && !risky,
      templateId: r.templateId ? (rename.get(r.templateId) ?? r.templateId) : null,
    };
  });
  return {
    pack: {
      rules: [...cur.rules, ...rules],
      templates: [...cur.templates, ...templates],
      ...((incoming.theme ?? cur.theme) ? { theme: incoming.theme ?? cur.theme } : {}),
    },
    disabled,
  };
}

export interface ImportResult {
  notebookId: string;
  created: boolean;
  notes: number;
  sources: number;
  lore: number;
  rules: number;
  assets: number;
  warnings: string[];
}

export async function importCard(
  ctx: AppContext,
  parsed: ParsedCard,
  opts: { notebookId?: string | null; lang?: string },
): Promise<ImportResult> {
  const T = importText(opts.lang);
  const d = parsed.card.data;
  const warnings = [...parsed.warnings];
  let notebookId = opts.notebookId ?? null;
  let created = false;
  if (notebookId) {
    if (!(await ctx.store.notebooks.get(notebookId))) throw notFound("Notebook");
  } else {
    const meta = d.notebook ?? { title: d.name, description: d.summary, icon: "📓", color: "indigo" };
    notebookId = (
      await createNotebook(ctx, {
        title: meta.title.slice(0, 200) || T.importedCard,
        description: meta.description,
        icon: meta.icon,
        color: meta.color,
      })
    ).id;
    created = true;
  }
  const nb = (await ctx.store.notebooks.get(notebookId))!;

  // 资源：存进本地，记下旧 id → 新 id
  const idMap = new Map<string, string>();
  let assetCount = 0;
  let coverId: string | null = null;
  for (const a of d.assets) {
    const bytes = await assetBytes(ctx, a, parsed.files);
    if (!bytes) {
      warnings.push(T.assetUnreadable(a.name || a.id));
      continue;
    }
    try {
      const saved = await saveAsset(ctx, notebookId, bytes, a.name || a.id);
      idMap.set(a.id, saved.id);
      if (a.type === "cover") coverId = saved.id;
      else assetCount++;
    } catch (e) {
      warnings.push(T.assetFailed(a.name || a.id, e instanceof Error ? e.message : String(e)));
    }
  }

  // 笔记：改写资源引用；外链图片下载成本地资源
  const extMap = new Map<string, string>();
  let noteCount = 0;
  const fromTavern = parsed.format.startsWith("st-");
  for (const [i, n] of d.notes.entries()) {
    let md = n.markdown.replace(/asset:\/\/([A-Za-z0-9_.-]+)/g, (m, id: string) =>
      idMap.has(id) ? `asset://${idMap.get(id)}` : m,
    );
    for (const m of md.matchAll(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)[^)]*\)/g)) {
      const url = m[1]!;
      if (extMap.has(url) || !mediaKindOf(url.split("?")[0]!.replace(/\/$/, "") || "x.png")) continue;
      const bytes = await download(ctx, url);
      if (!bytes) continue;
      try {
        extMap.set(url, (await saveAsset(ctx, notebookId, bytes, url.split("/").pop() ?? "image")).id);
      } catch {
        /* 不是图片：保留外链 */
      }
    }
    for (const [url, id] of extMap) md = md.split(`](${url}`).join(`](asset://${id}`);
    // 酒馆角色卡的头像放在角色设定的开头
    if (fromTavern && i === 0 && coverId) md = `![${d.name}](asset://${coverId})\n\n${md}`;
    const ts = nowIso();
    const note: Note = {
      id: newId("note"),
      ownerId: ctx.store.ownerId,
      notebookId,
      title: n.title || d.name,
      doc: null,
      markdown: md,
      kind: n.kind,
      tags: n.tags,
      pinned: false,
      origin: { type: "manual", refId: null, sourceId: null },
      props: { importedFrom: d.name },
      createdAt: ts,
      updatedAt: ts,
    };
    await ctx.store.notes.insert(note);
    noteCount++;
  }

  // 资料原文：作为 Markdown 资料重新解析、建索引
  for (const s of d.sources) {
    try {
      await createJsonSource(ctx, notebookId, {
        kind: "markdown",
        title: s.title,
        text: s.text,
        url: s.url ?? undefined,
      });
    } catch (e) {
      warnings.push(T.sourceFailed(s.title, e instanceof Error ? e.message : String(e)));
    }
  }

  // 渲染包（只对这本 Notebook 生效）
  let ruleCount = 0;
  if (d.render && (d.render.rules.length || d.render.templates.length)) {
    const { pack, disabled } = mergeRender(nb.render, d.render);
    await ctx.store.notebooks.update(notebookId, { render: pack, updatedAt: nowIso() });
    ruleCount = d.render.rules.length;
    if (disabled) warnings.push(T.rulesDisabled(disabled));
  }

  // 知识书
  let loreCount = 0;
  if (d.lorebook?.entries.length) {
    const r = await importLorebook(ctx, notebookId, d.lorebook, {
      replaceSettings: created,
      lang: opts.lang,
    });
    loreCount = r.created;
    if (r.disabled) warnings.push(T.loreDisabled(r.disabled));
  }

  // Notebook 说明：新建时直接用；合并时原来没有才写入
  if (d.ai_instructions.trim()) {
    if (created || !nb.aiInstructions?.trim())
      await ctx.store.notebooks.update(notebookId, {
        aiInstructions: d.ai_instructions,
        updatedAt: nowIso(),
      });
    else warnings.push(T.keptInstructions);
  }

  return {
    notebookId,
    created,
    notes: noteCount,
    sources: d.sources.length,
    lore: loreCount,
    rules: ruleCount,
    assets: assetCount,
    warnings,
  };
}

/** 卡片 JSON 体积检查（PNG / JSON 内联资源时）。 */
export function assertJsonSize(json: string): void {
  if (json.length > 20 * 1024 * 1024)
    throw badRequest("卡片太大（资源内联后超过 20 MB），请导出为 .quire 压缩包");
}
