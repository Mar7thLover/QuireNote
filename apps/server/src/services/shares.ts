/**
 * 分享链接：在自己的服务器上生成只读页 `/share/<token>`，对方在浏览器里阅读一条笔记或一整本 Notebook，
 * 并能下载卡片。链接显示的是当前内容（笔记改了，页面跟着变）；带哪些部分（渲染包、知识书、AI 说明、
 * 资料原文、作者署名）在创建时定下。
 *
 * 公开接口只认令牌：令牌不存在、已撤销、指向的内容已删除，一律返回同一个 404，不透露别的数据；
 * 资源只给分享的笔记正文里引用到的那些。
 */
import { randomBytes } from "node:crypto";
import { type Asset, markdownExcerpt } from "@quirenote/core";
import { z } from "zod";
import type { AppContext } from "../context";
import { ApiError, notFound } from "../errors";
import { msg } from "../messages";
import type { ShareOptions, ShareRecord } from "../store/types";
import { assetIdsIn, readAsset } from "./assets";
import { type ExportedCard, type ExportOptions, exportNotebookCard, exportNoteCard } from "./cards";

export const ShareInput = z.object({
  kind: z.enum(["note", "notebook"]),
  id: z.string().min(1).max(200),
  render: z.boolean().optional(),
  lorebook: z.boolean().optional(),
  instructions: z.boolean().optional(),
  sources: z.boolean().optional(),
  artifacts: z.boolean().optional(),
  elements: z.boolean().optional(),
  creator: z.string().max(200).optional(),
});
export type ShareInput = z.infer<typeof ShareInput>;

/** 给主人看的分享记录（设置里的列表、生成链接后的结果）。 */
export interface ShareView {
  token: string;
  kind: ShareRecord["kind"];
  targetId: string;
  notebookId: string;
  /** 当前标题；内容已删除时为 null（公开页随之 404）。 */
  title: string | null;
  notebookTitle: string | null;
  options: ShareOptions;
  /** 只读页路径，前端拼上公开访问地址。 */
  path: string;
  createdAt: string;
}

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** 144 位随机数，base64url 编码后 24 个字符。 */
export function newShareToken(): string {
  return randomBytes(18).toString("base64url");
}

export const sharePath = (token: string) => `/share/${token}`;
export const publicAssetPath = (token: string, id: string) =>
  `/api/public/shares/${token}/assets/${encodeURIComponent(id)}`;

/** 公开接口统一的 404：不区分令牌错误、已撤销和内容已删除。 */
const gone = () => new ApiError(404, "not_found", msg().shareGone);

function normalizeOptions(input: ShareInput): ShareOptions {
  const notebook = input.kind === "notebook";
  return {
    render: input.render ?? true,
    lorebook: notebook && (input.lorebook ?? true),
    instructions: notebook && (input.instructions ?? true),
    sources: notebook && (input.sources ?? true),
    artifacts: notebook && (input.artifacts ?? true),
    elements: notebook && (input.elements ?? true),
    creator: (input.creator ?? "").trim().slice(0, 200),
  };
}

const sameOptions = (a: ShareOptions, b: ShareOptions) =>
  a.render === b.render &&
  a.lorebook === b.lorebook &&
  a.instructions === b.instructions &&
  a.sources === b.sources &&
  (a.artifacts ?? true) === (b.artifacts ?? true) &&
  (a.elements ?? true) === (b.elements ?? true) &&
  a.creator === b.creator;

async function toView(ctx: AppContext, r: ShareRecord): Promise<ShareView> {
  const note = r.kind === "note" ? await ctx.store.notes.get(r.targetId) : null;
  // 笔记可能被移到别的 Notebook：以笔记当前所在的为准
  const notebookId = note?.notebookId ?? r.notebookId;
  const nb = await ctx.store.notebooks.get(notebookId);
  const title = r.kind === "note" ? (note ? note.title || msg().untitledNote : null) : (nb?.title ?? null);
  return {
    token: r.id,
    kind: r.kind,
    targetId: r.targetId,
    notebookId,
    title,
    notebookTitle: nb?.title ?? null,
    options: r.options,
    path: sharePath(r.id),
    createdAt: r.createdAt,
  };
}

/** 生成链接。同一内容、同样选项的有效链接已经存在时直接返回它（created: false），不重复生成。 */
export async function createShare(
  ctx: AppContext,
  input: ShareInput,
): Promise<{ share: ShareView; created: boolean }> {
  const { store } = ctx;
  let notebookId: string;
  if (input.kind === "note") {
    const note = await store.notes.get(input.id);
    if (!note) throw notFound("note");
    notebookId = note.notebookId;
  } else {
    if (!(await store.notebooks.get(input.id))) throw notFound("notebook");
    notebookId = input.id;
  }
  const options = normalizeOptions(input);
  const existing = (await store.shares.list({ refId: input.id })).find(
    (r) => r.kind === input.kind && !r.revokedAt && sameOptions(r.options, options),
  );
  if (existing) return { share: await toView(ctx, existing), created: false };
  const ts = new Date().toISOString();
  const rec: ShareRecord = {
    id: newShareToken(),
    kind: input.kind,
    targetId: input.id,
    notebookId,
    options,
    createdAt: ts,
    updatedAt: ts,
    revokedAt: null,
  };
  await store.shares.insert(rec);
  return { share: await toView(ctx, rec), created: true };
}

/** 有效的链接，新的在前。 */
export async function listShares(ctx: AppContext): Promise<ShareView[]> {
  const rows = (await ctx.store.shares.list()).filter((r) => !r.revokedAt);
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return Promise.all(rows.map((r) => toView(ctx, r)));
}

/** 撤销：记下时间，公开接口随即 404。重复撤销不报错；令牌不存在时返回 false。 */
export async function revokeShare(ctx: AppContext, token: string): Promise<boolean> {
  if (!TOKEN_RE.test(token)) return false;
  const rec = await ctx.store.shares.get(token);
  if (!rec) return false;
  if (!rec.revokedAt) await ctx.store.shares.update(token, { revokedAt: new Date().toISOString() });
  return true;
}

// ───────────── 公开接口 ─────────────

async function activeShare(ctx: AppContext, token: string): Promise<ShareRecord> {
  if (!TOKEN_RE.test(token)) throw gone();
  const rec = await ctx.store.shares.get(token);
  if (!rec || rec.revokedAt) throw gone();
  return rec;
}

async function exportShare(
  ctx: AppContext,
  rec: ShareRecord,
  extra: Pick<ExportOptions, "format" | "assetUrl">,
): Promise<ExportedCard> {
  const opts: ExportOptions = { ...rec.options, ...extra };
  try {
    return rec.kind === "note"
      ? await exportNoteCard(ctx, rec.targetId, opts)
      : await exportNotebookCard(ctx, rec.targetId, opts);
  } catch (e) {
    // 内容已删除：与令牌错误同一个 404
    if (e instanceof ApiError && e.status === 404) throw gone();
    throw e;
  }
}

/** 只读页用的卡片 JSON：资源不内联，指向公开的资源地址。 */
export async function publicShare(ctx: AppContext, token: string) {
  const rec = await activeShare(ctx, token);
  const { card } = await exportShare(ctx, rec, {
    format: "json",
    assetUrl: (id) => publicAssetPath(rec.id, id),
  });
  return { token: rec.id, kind: rec.kind, card };
}

/** 下载用的完整卡片（json 内联资源；zip 为 .quire 压缩包）。 */
export async function publicShareCard(
  ctx: AppContext,
  token: string,
  format: "json" | "zip",
): Promise<ExportedCard> {
  return exportShare(ctx, await activeShare(ctx, token), { format });
}

/** 分享内容引用到的资源；别的资源（哪怕在同一本 Notebook 里）一律 404。 */
export async function publicShareAsset(
  ctx: AppContext,
  token: string,
  assetId: string,
): Promise<{ asset: Asset; data: Uint8Array }> {
  const rec = await activeShare(ctx, token);
  const notes =
    rec.kind === "note"
      ? [await ctx.store.notes.get(rec.targetId)].filter((n) => n !== null)
      : (await ctx.store.notebooks.get(rec.targetId))
        ? await ctx.store.notes.list({ notebookId: rec.targetId })
        : [];
  if (!notes.length || !notes.some((n) => assetIdsIn(n.markdown).includes(assetId))) throw gone();
  const hit = await readAsset(ctx, assetId);
  if (!hit) throw gone();
  return hit;
}

/** 只读页的标题与介绍（服务端写进 HTML 的 meta，聊天软件里贴链接时显示）；无效时为 null。 */
export async function shareMeta(
  ctx: AppContext,
  token: string,
): Promise<{ title: string; description: string } | null> {
  try {
    const rec = await activeShare(ctx, token);
    if (rec.kind === "note") {
      const note = await ctx.store.notes.get(rec.targetId);
      if (!note) return null;
      return { title: note.title || msg().untitledNote, description: markdownExcerpt(note.markdown, 140) };
    }
    const nb = await ctx.store.notebooks.get(rec.targetId);
    return nb ? { title: nb.title, description: nb.description.slice(0, 140) } : null;
  } catch {
    return null;
  }
}
