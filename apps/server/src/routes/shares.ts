/** 分享链接：主人管理链接的接口，以及只读页用的公开接口（/api/public/…，只认令牌）。 */
import { cardToZip } from "@quirenote/card";
import type { Hono } from "hono";
import type { AppContext } from "../context";
import { notFound } from "../errors";
import { assertJsonSize } from "../services/cards";
import {
  createShare,
  listShares,
  publicShare,
  publicShareAsset,
  publicShareCard,
  revokeShare,
  ShareInput,
} from "../services/shares";
import { download, fileResponse, readJson, safeFilename } from "./util";

/** 公开响应：不缓存（撤销立即生效），不进搜索引擎。 */
function publicHeaders(res: Response): Response {
  res.headers.set("cache-control", "no-store");
  res.headers.set("x-robots-tag", "noindex, nofollow");
  res.headers.set("referrer-policy", "no-referrer");
  return res;
}

export function shareRoutes(api: Hono, ctx: AppContext): void {
  api.post("/shares", async (c) => {
    const input = await readJson(c, ShareInput);
    const { share, created } = await createShare(ctx, input);
    return c.json(share, created ? 201 : 200);
  });

  api.get("/shares", async (c) => c.json(await listShares(ctx)));

  api.delete("/shares/:token", async (c) => {
    if (!(await revokeShare(ctx, c.req.param("token")))) throw notFound("分享链接");
    return c.json({ ok: true });
  });

  // ───── 公开接口（只读页） ─────
  api.get("/public/shares/:token", async (c) =>
    publicHeaders(c.json(await publicShare(ctx, c.req.param("token")))),
  );

  api.get("/public/shares/:token/card", async (c) => {
    const zip = c.req.query("format") === "quire";
    const out = await publicShareCard(ctx, c.req.param("token"), zip ? "zip" : "json");
    const name = out.card.data.name;
    if (zip)
      return publicHeaders(
        download(cardToZip(out.card, out.files), safeFilename(name, ".quire"), "application/zip"),
      );
    const json = JSON.stringify(out.card);
    assertJsonSize(json);
    return publicHeaders(
      download(new TextEncoder().encode(json), safeFilename(name, ".quire.json"), "application/json"),
    );
  });

  api.get("/public/shares/:token/assets/:id", async (c) => {
    const hit = await publicShareAsset(ctx, c.req.param("token"), c.req.param("id"));
    const res = fileResponse(c, hit.data, hit.asset.mime);
    res.headers.set("x-content-type-options", "nosniff");
    return publicHeaders(res);
  });
}
