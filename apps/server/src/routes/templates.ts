/** Notebook 模板：列表、从模板新建、把 Notebook 存成模板。笔记模板在前端，存在设置 `noteTemplates` 里。 */
import type { Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "../context";
import {
  createFromTemplate,
  deleteNotebookTemplate,
  listNotebookTemplates,
  renameNotebookTemplate,
  saveAsTemplate,
} from "../services/templates";
import { must, readJson } from "./util";

export function templateRoutes(api: Hono, ctx: AppContext): void {
  api.get("/notebook-templates", async (c) => c.json(await listNotebookTemplates(ctx, c.req.query("lang"))));

  api.post("/notebooks/from-template", async (c) => {
    const input = await readJson(
      c,
      z.object({
        templateId: z.string().min(1),
        title: z.string().max(200).optional(),
        description: z.string().max(5000).optional(),
        icon: z.string().max(20).optional(),
        color: z.string().max(40).optional(),
        lang: z.string().max(20).optional(),
      }),
    );
    return c.json(await createFromTemplate(ctx, input), 201);
  });

  api.post("/notebooks/:nb/save-template", async (c) => {
    must(await ctx.store.notebooks.get(c.req.param("nb")), "notebook");
    const input = await readJson(
      c,
      z.object({ name: z.string().max(200).optional(), description: z.string().max(5000).optional() }),
    );
    return c.json(await saveAsTemplate(ctx, c.req.param("nb"), input), 201);
  });

  api.patch("/notebook-templates/:id", async (c) => {
    const input = await readJson(
      c,
      z.object({ name: z.string().max(200).optional(), description: z.string().max(5000).optional() }),
    );
    return c.json(await renameNotebookTemplate(ctx, c.req.param("id"), input));
  });

  api.delete("/notebook-templates/:id", async (c) => {
    await deleteNotebookTemplate(ctx, c.req.param("id"));
    return c.json({ ok: true });
  });
}
