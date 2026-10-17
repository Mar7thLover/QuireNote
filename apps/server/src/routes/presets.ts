/** 对话预设的增删改查、导入导出。 */
import { ChatPresetInput, ChatPresetPatch } from "@quirenote/core";
import type { Hono } from "hono";
import type { AppContext } from "../context";
import {
  createPreset,
  deletePreset,
  exportPreset,
  importPresetFile,
  listPresets,
  updatePreset,
} from "../services/presets";
import { download, readJson, readUpload, safeFilename } from "./util";

export function presetRoutes(api: Hono, ctx: AppContext): void {
  api.get("/presets", async (c) => c.json(await listPresets(ctx, c.req.query("lang"))));

  api.post("/presets", async (c) => c.json(await createPreset(ctx, await readJson(c, ChatPresetInput)), 201));

  api.patch("/presets/:id", async (c) =>
    c.json(await updatePreset(ctx, c.req.param("id"), await readJson(c, ChatPresetPatch))),
  );

  api.delete("/presets/:id", async (c) => {
    await deletePreset(ctx, c.req.param("id"));
    return c.json({ ok: true });
  });

  api.post("/presets/import", async (c) => {
    const { file, form } = await readUpload(c);
    const lang = typeof form.lang === "string" ? form.lang : undefined;
    const r = await importPresetFile(ctx, new Uint8Array(await file.arrayBuffer()), file.name, lang);
    return c.json(r, 201);
  });

  api.get("/presets/:id/export", async (c) => {
    const format = c.req.query("format") === "sillytavern" ? "sillytavern" : "quire";
    const { json, name } = await exportPreset(ctx, c.req.param("id"), format, c.req.query("lang"));
    return download(
      new TextEncoder().encode(JSON.stringify(json, null, 2)),
      safeFilename(name, format === "sillytavern" ? ".json" : ".preset.json"),
      "application/json",
    );
  });
}
