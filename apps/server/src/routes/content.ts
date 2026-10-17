/** 笔记资源、链接预览、知识书、Quire 卡的导入导出。 */
import { CardError, cardToZip, lorebookToWorldInfo, parseCardFile } from "@quirenote/card";
import { LorebookSettingsPatch, LoreEntryInput } from "@quirenote/core";
import type { Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "../context";
import { ApiError, badRequest } from "../errors";
import { readAsset, saveAsset } from "../services/assets";
import {
  assertJsonSize,
  exportNotebookCard,
  exportNoteCard,
  importCard,
  previewCard,
} from "../services/cards";
import { linkPreview } from "../services/links";
import {
  createLoreEntry,
  exportLorebook,
  listLore,
  lorebookSettings,
  loreFromElements,
  testLore,
  updateLorebookSettings,
  updateLoreEntry,
} from "../services/lorebook";
import { download, fileResponse, must, readJson, readUpload, safeFilename } from "./util";

const flag = (v: string | undefined, d: boolean) => (v === undefined ? d : v === "1" || v === "true");

/** 解析上传的卡片文件；格式错误统一转成 400。 */
async function parseUpload(c: Parameters<typeof readUpload>[0]) {
  const { file, form } = await readUpload(c);
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    return { parsed: parseCardFile(bytes, file.name, { lang: String(form.lang ?? "zh") }), form };
  } catch (e) {
    if (e instanceof CardError) throw new ApiError(400, e.code, e.message);
    throw e;
  }
}

export function contentRoutes(api: Hono, ctx: AppContext): void {
  const { store } = ctx;
  const notebook = async (id: string) => must(await store.notebooks.get(id), "Notebook");

  // ───── 资源 ─────
  api.post("/notebooks/:nb/assets", async (c) => {
    await notebook(c.req.param("nb"));
    const { file } = await readUpload(c);
    const asset = await saveAsset(
      ctx,
      c.req.param("nb"),
      new Uint8Array(await file.arrayBuffer()),
      file.name,
    );
    return c.json(asset, 201);
  });

  api.get("/assets/:id", async (c) => {
    const hit = must(await readAsset(ctx, c.req.param("id")), "资源");
    return fileResponse(c, hit.data, hit.asset.mime);
  });

  // ───── 链接预览 ─────
  api.get("/link-preview", async (c) => {
    const url = c.req.query("url");
    if (!url) throw badRequest("缺少 url");
    return c.json(await linkPreview(ctx, url));
  });

  // ───── 知识书 ─────
  api.get("/notebooks/:nb/lorebook", async (c) => {
    const nb = c.req.param("nb");
    await notebook(nb);
    const [settings, entries] = await Promise.all([lorebookSettings(ctx, nb), listLore(ctx, nb)]);
    return c.json({ settings, entries });
  });

  api.patch("/notebooks/:nb/lorebook", async (c) => {
    const nb = c.req.param("nb");
    await notebook(nb);
    const patch = await readJson(c, LorebookSettingsPatch);
    return c.json(await updateLorebookSettings(ctx, nb, patch));
  });

  api.post("/notebooks/:nb/lorebook/entries", async (c) => {
    const nb = c.req.param("nb");
    await notebook(nb);
    return c.json(await createLoreEntry(ctx, nb, await readJson(c, LoreEntryInput)), 201);
  });

  api.patch("/lorebook/entries/:id", async (c) =>
    c.json(await updateLoreEntry(ctx, c.req.param("id"), await readJson(c, LoreEntryInput))),
  );

  api.delete("/lorebook/entries/:id", async (c) => {
    must(await store.lore.get(c.req.param("id")), "知识书条目");
    await store.lore.delete(c.req.param("id"));
    return c.json({ ok: true });
  });

  api.post("/notebooks/:nb/lorebook/test", async (c) => {
    const nb = c.req.param("nb");
    await notebook(nb);
    const { text } = await readJson(c, z.object({ text: z.string().max(20_000) }));
    const act = await testLore(ctx, nb, text);
    const pick = (list: typeof act.entries) =>
      list.map((a) => ({
        id: a.entry.id,
        name: a.entry.name,
        trigger: a.trigger,
        tokens: a.tokens,
        position: a.entry.position,
      }));
    return c.json({ entries: pick(act.entries), trimmed: pick(act.trimmed), tokens: act.tokens });
  });

  api.post("/notebooks/:nb/lorebook/from-elements", async (c) => {
    const nb = c.req.param("nb");
    await notebook(nb);
    return c.json(await loreFromElements(ctx, nb, c.req.query("lang")));
  });

  api.get("/notebooks/:nb/lorebook/export", async (c) => {
    const nb = await notebook(c.req.param("nb"));
    const book = await exportLorebook(ctx, nb.id);
    const st = c.req.query("format") === "sillytavern";
    const json = JSON.stringify(st ? lorebookToWorldInfo(book) : book, null, 2);
    return download(
      new TextEncoder().encode(json),
      safeFilename(`${nb.title} 知识书${st ? "（酒馆世界书）" : ""}`, ".json"),
      "application/json",
    );
  });

  // ───── Quire 卡 ─────
  const exportOpts = (c: { req: { query: (k: string) => string | undefined } }) => ({
    format: (c.req.query("format") === "quire" ? "zip" : "json") as "zip" | "json",
    render: flag(c.req.query("render"), true),
    lorebook: flag(c.req.query("lorebook"), true),
    sources: flag(c.req.query("sources"), false),
    instructions: flag(c.req.query("instructions"), true),
    creator: (c.req.query("creator") ?? "").slice(0, 200),
  });

  const respond = (out: Awaited<ReturnType<typeof exportNoteCard>>, zip: boolean, name: string) => {
    if (zip) return download(cardToZip(out.card, out.files), safeFilename(name, ".quire"), "application/zip");
    const json = JSON.stringify(out.card);
    assertJsonSize(json);
    return download(new TextEncoder().encode(json), safeFilename(name, ".quire.json"), "application/json");
  };

  api.get("/notes/:id/card", async (c) => {
    const opts = exportOpts(c);
    const out = await exportNoteCard(ctx, c.req.param("id"), opts);
    return respond(out, opts.format === "zip", out.card.data.name);
  });

  api.get("/notebooks/:nb/card", async (c) => {
    const opts = exportOpts(c);
    const out = await exportNotebookCard(ctx, c.req.param("nb"), opts);
    return respond(out, opts.format === "zip", out.card.data.name);
  });

  api.post("/cards/preview", async (c) => {
    const { parsed, form } = await parseUpload(c);
    return c.json(previewCard(parsed, String(form.lang ?? "zh")));
  });

  api.post("/cards/import", async (c) => {
    const { parsed, form } = await parseUpload(c);
    const target = typeof form.notebookId === "string" && form.notebookId ? form.notebookId : null;
    return c.json(
      await importCard(ctx, parsed, { notebookId: target, lang: String(form.lang ?? "zh") }),
      201,
    );
  });
}
