/** 笔记资源、链接预览、知识书、Quire 卡的导入导出。 */
import { CardError, cardToZip, parseCardFile } from "@quirenote/card";
import { LorebookSettingsPatch, LoreEntryInput } from "@quirenote/core";
import {
  characterToPreset,
  isCharacterFormat,
  lorebookToWorldInfo,
  PLUGIN_ID as ST,
} from "@quirenote/plugin-sillytavern";
import type { Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "../context";
import { ApiError, badRequest } from "../errors";
import { msg } from "../messages";
import { cardImporters, requirePlugin } from "../plugins";
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
import { createPreset } from "../services/presets";
import { download, fileResponse, must, readJson, readUpload, safeFilename } from "./util";

const flag = (v: string | undefined, d: boolean) => (v === undefined ? d : v === "1" || v === "true");

/** 解析上传的卡片文件；格式错误统一转成 400。插件格式要求插件已启用。 */
async function parseUpload(ctx: AppContext, c: Parameters<typeof readUpload>[0]) {
  const { file, form } = await readUpload(c);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const lang = String(form.lang ?? "zh");
  let parsed: ReturnType<typeof parseCardFile>;
  try {
    parsed = parseCardFile(bytes, file.name, { lang, importers: cardImporters });
  } catch (e) {
    if (e instanceof CardError) throw new ApiError(400, e.code, e.message);
    throw e;
  }
  if (parsed.importer) await requirePlugin(ctx, parsed.importer, lang);
  return { parsed, form };
}

export function contentRoutes(api: Hono, ctx: AppContext): void {
  const { store } = ctx;
  const notebook = async (id: string) => must(await store.notebooks.get(id), "notebook");

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
    const hit = must(await readAsset(ctx, c.req.param("id")), "asset");
    return fileResponse(c, hit.data, hit.asset.mime);
  });

  // ───── 链接预览 ─────
  api.get("/link-preview", async (c) => {
    const url = c.req.query("url");
    if (!url) throw badRequest(msg().missingUrl);
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
    must(await store.lore.get(c.req.param("id")), "loreEntry");
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
    if (st) await requirePlugin(ctx, ST, c.req.query("lang"));
    const json = JSON.stringify(st ? lorebookToWorldInfo(book) : book, null, 2);
    return download(
      new TextEncoder().encode(json),
      safeFilename(msg().loreExportName(nb.title, st), ".json"),
      "application/json",
    );
  });

  // ───── Quire 卡 ─────
  const exportOpts = (c: { req: { query: (k: string) => string | undefined } }) => ({
    format: (c.req.query("format") === "quire" ? "zip" : "json") as "zip" | "json",
    render: flag(c.req.query("render"), true),
    lorebook: flag(c.req.query("lorebook"), true),
    sources: flag(c.req.query("sources"), true),
    artifacts: flag(c.req.query("artifacts"), true),
    elements: flag(c.req.query("elements"), true),
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
    const { parsed, form } = await parseUpload(ctx, c);
    return c.json(previewCard(parsed, String(form.lang ?? "zh")));
  });

  api.post("/cards/import", async (c) => {
    const { parsed, form } = await parseUpload(ctx, c);
    // 角色卡也可以导入为问答风格（对话预设），在任何 Notebook 的对话里切换使用
    if (form.as === "preset") {
      if (parsed.importer !== ST || !isCharacterFormat(parsed.format))
        throw badRequest(msg().notCharacter, "not_character");
      const raw = parsed.card.data.extensions.sillytavern as Record<string, unknown>;
      const preset = await createPreset(ctx, characterToPreset(raw, String(form.lang ?? "zh")));
      return c.json({ preset, warnings: parsed.warnings }, 201);
    }
    const target = typeof form.notebookId === "string" && form.notebookId ? form.notebookId : null;
    return c.json(
      await importCard(ctx, parsed, { notebookId: target, lang: String(form.lang ?? "zh") }),
      201,
    );
  });
}
