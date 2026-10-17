/** Notebook 整本导出 / 导入（zip），以及全量备份 / 恢复。 */
import {
  type Artifact,
  type Asset,
  type Chunk,
  type Conversation,
  type DbView,
  type Element,
  type LoreEntry,
  type Message,
  type Note,
  newId,
  nowIso,
  type PropertyDef,
  type Source,
} from "@quirenote/core";
import { strFromU8, strToU8, unzipSync, type Zippable, zipSync } from "fflate";
import { VERSION } from "../config";
import type { AppContext } from "../context";
import { ApiError, badRequest, notFound } from "../errors";
import { safeName } from "../files";
import { sourceFileDir } from "../ingest/pipeline";
import type { Highlight, NotebookRecord, ReviewCardRecord, ReviewLog, SourceText } from "../store/types";
import { ASSET_DIR } from "./assets";
import { withStats } from "./notebooks";
import { originalTextPath } from "./source-edit";
import { MEDIA_DIR } from "./studio";

export interface NotebookExport {
  format: "quirenote-notebook";
  version: 1;
  app: string;
  exportedAt: string;
  notebook: NotebookRecord;
  sources: Source[];
  contents: SourceText[];
  chunks: Chunk[];
  highlights: Highlight[];
  notes: Note[];
  artifacts: Artifact[];
  elements: Element[];
  cards: ReviewCardRecord[];
  reviewLogs: ReviewLog[];
  views: DbView[];
  properties: PropertyDef[];
  conversations: Conversation[];
  messages: Message[];
  /** 知识书条目与笔记资源（较早的导出没有这两项）。 */
  lore?: LoreEntry[];
  assets?: Asset[];
}

function slug(s: string, i: number): string {
  return `${String(i + 1).padStart(2, "0")}-${safeName(s).replace(/\s+/g, "-").slice(0, 60) || "untitled"}`;
}

function mediaNames(artifacts: Artifact[]): string[] {
  const out: string[] = [];
  for (const a of artifacts) {
    const d = a.data;
    const url =
      d?.kind === "audio"
        ? d.audioUrl
        : d?.kind === "image"
          ? d.imageUrl
          : d?.kind === "video"
            ? d.videoUrl
            : null;
    if (url?.startsWith("/api/files/")) out.push(decodeURIComponent(url.slice("/api/files/".length)));
  }
  return out;
}

export async function exportNotebook(
  ctx: AppContext,
  notebookId: string,
): Promise<{ zip: Uint8Array; filename: string }> {
  const { store } = ctx;
  const notebook = await store.notebooks.get(notebookId);
  if (!notebook) throw notFound("Notebook");
  const f = { notebookId };
  const sources = await store.sources.list(f);
  const contents: SourceText[] = [];
  for (const s of sources) {
    const c = await store.contents.get(s.id);
    if (c) contents.push(c);
  }
  const conversations = await store.conversations.list(f);
  const messages: Message[] = [];
  for (const c of conversations) messages.push(...(await store.messages.list({ refId: c.id })));
  const data: NotebookExport = {
    format: "quirenote-notebook",
    version: 1,
    app: `quirenote ${VERSION}`,
    exportedAt: nowIso(),
    notebook,
    sources,
    contents,
    chunks: await store.chunks.listByNotebook(notebookId),
    highlights: await store.highlights.list(f),
    notes: await store.notes.list(f),
    artifacts: await store.artifacts.list(f),
    elements: await store.elements.list(f),
    cards: await store.cards.list(f),
    reviewLogs: await store.reviewLogs.list(f),
    views: await store.views.list(f),
    properties: await store.properties.list(f),
    conversations,
    messages,
    lore: await store.lore.list(f),
    assets: await store.assets.list(f),
  };
  const zip: Zippable = { "notebook.json": strToU8(JSON.stringify(data, null, 2)) };
  zip["README.md"] = strToU8(
    `# ${notebook.title}\n\n${notebook.description}\n\n由 QuireNote 导出于 ${data.exportedAt}。\n\n- notebook.json：完整元数据（可用 POST /api/import 导入）\n- markdown/：笔记、资料全文与文本类生成物的 Markdown\n- files/：原始资料文件与生成的媒体\n`,
  );
  data.notes.forEach((n, i) => {
    zip[`markdown/notes/${slug(n.title, i)}.md`] = strToU8(`# ${n.title}\n\n${n.markdown}\n`);
  });
  sources.forEach((s, i) => {
    const c = contents.find((x) => x.sourceId === s.id);
    if (c)
      zip[`markdown/sources/${slug(s.title, i)}.md`] = strToU8(
        `# ${s.title}\n\n${s.url ? `<${s.url}>\n\n` : ""}${c.text}\n`,
      );
  });
  data.artifacts.forEach((a, i) => {
    if (a.data?.kind === "markdown")
      zip[`markdown/artifacts/${slug(a.title, i)}.md`] = strToU8(`${a.data.markdown}\n`);
  });
  for (const s of sources) {
    for (const path of await ctx.files.list(sourceFileDir(s.id))) {
      const bytes = await ctx.files.get(path);
      if (bytes) zip[`files/${path}`] = bytes;
    }
    // 编辑过的资料：带上编辑前的原文，导入后仍可恢复。
    const original = await ctx.files.get(originalTextPath(s.id));
    if (original) zip[`files/${originalTextPath(s.id)}`] = original;
  }
  for (const a of data.assets ?? []) {
    const bytes = await ctx.files.get(`${ASSET_DIR}/${a.id}`);
    if (bytes) zip[`files/${ASSET_DIR}/${a.id}`] = bytes;
  }
  for (const name of mediaNames(data.artifacts)) {
    const bytes = await ctx.files.get(`${MEDIA_DIR}/${name}`);
    if (bytes) zip[`files/${MEDIA_DIR}/${name}`] = bytes;
  }
  const filename = `${safeName(notebook.title).replace(/\s+/g, "-") || "notebook"}.quirenote.zip`;
  return { zip: zipSync(zip, { level: 6 }), filename };
}

/** 收集导出数据中的全部 id，导入时整体替换为新 id（引用随之更新）。 */
function collectIds(data: NotebookExport): string[] {
  const ids = [
    data.notebook.id,
    ...data.sources.map((x) => x.id),
    ...data.chunks.map((x) => x.id),
    ...data.highlights.map((x) => x.id),
    ...data.notes.map((x) => x.id),
    ...data.artifacts.map((x) => x.id),
    ...data.elements.map((x) => x.id),
    ...data.cards.map((x) => x.id),
    ...data.reviewLogs.map((x) => x.id),
    ...data.views.map((x) => x.id),
    ...data.properties.map((x) => x.id),
    ...data.conversations.map((x) => x.id),
    ...data.messages.map((x) => x.id),
    ...(data.lore ?? []).map((x) => x.id),
  ];
  return [...new Set(ids.filter((x) => typeof x === "string" && x.length >= 6))];
}

function remapIds(raw: string, ids: string[]): { text: string; map: Map<string, string> } {
  const map = new Map<string, string>();
  for (const id of ids) {
    const prefix = /^([a-z]+)_/.exec(id)?.[1] ?? "id";
    map.set(id, newId(prefix));
  }
  if (!ids.length) return { text: raw, map };
  const sorted = [...ids]
    .sort((a, b) => b.length - a.length)
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(sorted.join("|"), "g");
  return { text: raw.replace(re, (m) => map.get(m) ?? m), map };
}

export async function importNotebook(
  ctx: AppContext,
  zipBytes: Uint8Array,
): Promise<import("@quirenote/core").Notebook> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zipBytes);
  } catch {
    throw badRequest("不是有效的 zip 文件");
  }
  const meta = files["notebook.json"];
  if (!meta) throw badRequest("zip 中缺少 notebook.json");
  const raw = strFromU8(meta);
  let parsed: NotebookExport;
  try {
    parsed = JSON.parse(raw) as NotebookExport;
  } catch {
    throw badRequest("notebook.json 不是合法 JSON");
  }
  if (parsed.format !== "quirenote-notebook") throw badRequest("不是 QuireNote 导出的 Notebook");
  const remapped = remapIds(raw, collectIds(parsed));
  const { map } = remapped;
  // 资源 id 带扩展名（决定显示方式），单独换新 id 并保留扩展名。
  const assetMap = new Map(
    (parsed.assets ?? []).map((a) => [a.id, `${newId("ast")}.${a.id.split(".").pop() ?? "bin"}`]),
  );
  let text = remapped.text;
  for (const [from, to] of assetMap) text = text.split(from).join(to);
  const data = JSON.parse(text) as NotebookExport;
  const { store } = ctx;
  const owner = store.ownerId;
  const ts = nowIso();
  const nb: NotebookRecord = { ...data.notebook, ownerId: owner, updatedAt: ts };
  await store.notebooks.insert(nb);
  for (const s of data.sources) await store.sources.insert({ ...s, ownerId: owner });
  for (const c of data.contents) await store.contents.put(c);
  await store.chunks.insertMany(data.chunks ?? []);
  for (const h of data.highlights ?? []) await store.highlights.insert(h);
  for (const n of data.notes ?? []) await store.notes.insert({ ...n, ownerId: owner });
  for (const a of data.artifacts ?? [])
    await store.artifacts.insert({
      ...a,
      ownerId: owner,
      status: a.status === "generating" || a.status === "pending" ? "error" : a.status,
    });
  for (const e of data.elements ?? []) await store.elements.insert({ ...e, ownerId: owner });
  for (const c of data.cards ?? []) await store.cards.insert(c);
  for (const l of data.reviewLogs ?? []) await store.reviewLogs.insert(l);
  for (const v of data.views ?? []) await store.views.insert(v);
  for (const p of data.properties ?? []) await store.properties.insert(p);
  for (const c of data.conversations ?? []) await store.conversations.insert({ ...c, ownerId: owner });
  for (const m of data.messages ?? []) await store.messages.insert(m);
  for (const l of data.lore ?? []) await store.lore.insert(l);
  for (const a of data.assets ?? []) await store.assets.insert(a);
  // 文件：路径里的旧 id 同样替换。
  const idRe = map.size
    ? new RegExp([...map.keys()].map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g")
    : null;
  for (const [path, bytes] of Object.entries(files)) {
    if (!path.startsWith("files/") || path.endsWith("/")) continue;
    const rel = path.slice("files/".length);
    if (rel.startsWith(`${ASSET_DIR}/`)) {
      const id = rel.slice(ASSET_DIR.length + 1);
      if (assetMap.has(id)) await ctx.files.put(`${ASSET_DIR}/${assetMap.get(id)}`, bytes);
      continue;
    }
    if (!rel.startsWith("sources/") && !rel.startsWith("source-edits/") && !rel.startsWith(`${MEDIA_DIR}/`))
      continue;
    await ctx.files.put(idRe ? rel.replace(idRe, (m) => map.get(m) ?? m) : rel, bytes);
  }
  // 原来的向量不随导出，导入后按当前 Embedding 模型重建。
  await ctx.jobs.enqueue(
    "reindex",
    { notebookId: nb.id, clear: false },
    { notebookId: nb.id, refId: nb.id, message: "为导入的 Notebook 建立索引" },
  );
  return withStats(ctx, nb);
}

// ───────────── 全量备份 / 恢复 ─────────────

export async function backupAll(ctx: AppContext): Promise<{ zip: Uint8Array; filename: string }> {
  const zip: Zippable = {
    "backup.json": strToU8(
      JSON.stringify(
        { format: "quirenote-backup", version: 1, app: `quirenote ${VERSION}`, createdAt: nowIso() },
        null,
        2,
      ),
    ),
    "quirenote.db": await ctx.store.snapshot(),
  };
  for (const path of await ctx.files.list()) {
    const bytes = await ctx.files.get(path);
    if (bytes) zip[`files/${path}`] = bytes;
  }
  const stamp = nowIso().replace(/[:.]/g, "-");
  return { zip: zipSync(zip, { level: 6 }), filename: `quirenote-backup-${stamp}.zip` };
}

export async function restoreAll(
  ctx: AppContext,
  zipBytes: Uint8Array,
): Promise<{ ok: true; files: number }> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zipBytes);
  } catch {
    throw badRequest("不是有效的 zip 文件");
  }
  const meta = files["backup.json"];
  const db = files["quirenote.db"];
  if (!meta || !db) throw badRequest("不是 QuireNote 全量备份（缺少 backup.json 或 quirenote.db）");
  try {
    if ((JSON.parse(strFromU8(meta)) as { format?: string }).format !== "quirenote-backup") throw new Error();
  } catch {
    throw badRequest("backup.json 无效");
  }
  if (ctx.jobs.pending > 0) throw new ApiError(409, "busy", "还有后台任务在运行，请稍后再恢复");
  await ctx.store.restore(db);
  await ctx.files.clear();
  let n = 0;
  for (const [path, bytes] of Object.entries(files)) {
    if (!path.startsWith("files/") || path.endsWith("/")) continue;
    await ctx.files.put(path.slice("files/".length), bytes);
    n++;
  }
  await ctx.jobs.resume();
  return { ok: true, files: n };
}
