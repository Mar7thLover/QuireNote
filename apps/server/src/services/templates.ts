/** Notebook 模板：内置的在核心包里，自定义的（从已有 Notebook 存的）存在设置 `notebookTemplates` 里。 */
import {
  builtinNotebookTemplates,
  fillTemplate,
  type Notebook,
  type NotebookTemplate,
  type NotebookTemplateInfo,
  newId,
  QuireCard,
} from "@quirenote/core";
import type { AppContext } from "../context";
import { badRequest, notFound } from "../errors";
import { msg } from "../messages";
import { exportNotebookCard, importCard } from "./cards";
import { withStats } from "./notebooks";

const KEY = "notebookTemplates";
/** 自定义模板里的卡片 JSON 上限（图片会内联进去）。 */
const MAX_TEMPLATE_BYTES = 5 * 1024 * 1024;

async function custom(ctx: AppContext): Promise<NotebookTemplate[]> {
  return (await ctx.store.settings.get<NotebookTemplate[]>(KEY)) ?? [];
}

const info = ({ card: _c, ...rest }: NotebookTemplate): NotebookTemplateInfo => rest;

export async function listNotebookTemplates(ctx: AppContext, lang?: string): Promise<NotebookTemplateInfo[]> {
  return [...builtinNotebookTemplates(lang), ...(await custom(ctx))].map(info);
}

/** 从模板新建 Notebook：按卡片导入流程建好笔记、知识书、AI 说明、预设与稿件，再套上用户填的标题和外观。 */
export async function createFromTemplate(
  ctx: AppContext,
  input: {
    templateId: string;
    title?: string;
    description?: string;
    icon?: string;
    color?: string;
    lang?: string;
  },
): Promise<Notebook> {
  const tpl = [...builtinNotebookTemplates(input.lang), ...(await custom(ctx))].find(
    (t) => t.id === input.templateId,
  );
  if (!tpl) throw notFound("template");
  const card = QuireCard.parse(structuredClone(tpl.card));
  // 内置模板里的占位符（日期等）在新建时填上
  for (const n of card.data.notes)
    n.markdown = fillTemplate(n.markdown, { title: n.title, lang: input.lang });
  if (card.data.notebook) {
    card.data.notebook.title = input.title?.trim() || card.data.notebook.title;
    card.data.notebook.description = input.description ?? card.data.notebook.description;
    card.data.notebook.icon = input.icon || card.data.notebook.icon;
    card.data.notebook.color = input.color || card.data.notebook.color;
  }
  const r = await importCard(
    ctx,
    { format: "quire-json", importer: null, card, files: new Map(), warnings: [] },
    { lang: input.lang },
  );
  const nb = await ctx.store.notebooks.get(r.notebookId);
  return withStats(ctx, nb!);
}

/** 把一本 Notebook 存成模板：笔记、知识书、AI 说明、渲染规则、预设与稿件结构，不带资料和对话。 */
export async function saveAsTemplate(
  ctx: AppContext,
  notebookId: string,
  input: { name?: string; description?: string },
): Promise<NotebookTemplateInfo> {
  const nb = await ctx.store.notebooks.get(notebookId);
  if (!nb) throw notFound("notebook");
  const { card } = await exportNotebookCard(ctx, notebookId, { format: "json", sources: false });
  if (JSON.stringify(card).length > MAX_TEMPLATE_BYTES) throw badRequest(msg().templateTooBig);
  const tpl: NotebookTemplate = {
    id: newId("tpl"),
    name: input.name?.trim() || nb.title,
    description: input.description ?? nb.description,
    icon: nb.icon,
    color: nb.color,
    builtin: false,
    card,
  };
  const list = await custom(ctx);
  if (list.length >= 100) throw badRequest(msg().templateLimit);
  await ctx.store.settings.set(KEY, [...list, tpl]);
  return info(tpl);
}

export async function renameNotebookTemplate(
  ctx: AppContext,
  id: string,
  patch: { name?: string; description?: string },
): Promise<NotebookTemplateInfo> {
  const list = await custom(ctx);
  const cur = list.find((t) => t.id === id);
  if (!cur) throw notFound("template");
  const next = {
    ...cur,
    ...(patch.name?.trim() ? { name: patch.name.trim() } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
  };
  await ctx.store.settings.set(
    KEY,
    list.map((t) => (t.id === id ? next : t)),
  );
  return info(next);
}

export async function deleteNotebookTemplate(ctx: AppContext, id: string): Promise<void> {
  if (id.startsWith("builtin.")) throw badRequest(msg().builtinTemplateDelete);
  const list = await custom(ctx);
  if (!list.some((t) => t.id === id)) throw notFound("template");
  await ctx.store.settings.set(
    KEY,
    list.filter((t) => t.id !== id),
  );
}
