/** 插件开关。 */
import type { Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "../context";
import { BUILTIN_PLUGINS, pluginStates, setPluginEnabled } from "../plugins";
import { readJson } from "./util";

export function pluginRoutes(api: Hono, ctx: AppContext): void {
  const list = async () => {
    const states = await pluginStates(ctx);
    return BUILTIN_PLUGINS.map((p) => ({
      id: p.id,
      version: p.version,
      builtin: true,
      enabled: states[p.id] === true,
    }));
  };

  api.get("/plugins", async (c) => c.json(await list()));

  api.put("/plugins/:id", async (c) => {
    const { enabled } = await readJson(c, z.object({ enabled: z.boolean() }));
    await setPluginEnabled(ctx, c.req.param("id"), enabled);
    return c.json(await list());
  });
}
