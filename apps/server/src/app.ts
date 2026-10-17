import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppContext } from "./context";
import { toApiError } from "./errors";
import { aiRoutes } from "./routes/ai";
import { chatRoutes } from "./routes/chat";
import { contentRoutes } from "./routes/content";
import { notebookRoutes } from "./routes/notebooks";
import { pluginRoutes } from "./routes/plugins";
import { shareRoutes } from "./routes/shares";
import { studioRoutes } from "./routes/studio";
import { systemRoutes } from "./routes/system";
import { shareMeta } from "./services/shares";

/** 只允许本机来源：http(s)://localhost / 127.0.0.1 / [::1]（任意端口）与 Capacitor。 */
export function isAllowedOrigin(origin: string | undefined | null): boolean {
  if (!origin) return false;
  if (origin === "capacitor://localhost" || origin === "ionic://localhost") return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i.test(origin);
}

export function createApp(
  ctx: AppContext,
  opts: { log?: (msg: string) => void; webDist?: string } = {},
): Hono {
  const log = opts.log ?? ((m: string) => console.error(m));
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: (origin) => (isAllowedOrigin(origin) ? origin : null),
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "Range", "Last-Event-ID"],
      exposeHeaders: ["Content-Disposition", "Content-Range", "Accept-Ranges"],
      credentials: true,
      maxAge: 600,
    }),
  );

  app.onError((err, c) => {
    const e = toApiError(err);
    if (e.status >= 500) log(`[quirenote] ${c.req.method} ${c.req.path} → ${e.status} ${e.message}`);
    return c.json({ error: { code: e.code, message: e.message, ...(e.details ?? {}) } }, e.status as 400);
  });

  app.notFound((c) =>
    c.json({ error: { code: "not_found", message: `接口不存在：${c.req.method} ${c.req.path}` } }, 404),
  );

  const api = new Hono();
  systemRoutes(api, ctx);
  notebookRoutes(api, ctx);
  chatRoutes(api, ctx);
  studioRoutes(api, ctx);
  aiRoutes(api, ctx);
  contentRoutes(api, ctx);
  pluginRoutes(api, ctx);
  shareRoutes(api, ctx);
  app.route("/api", api);

  // 一体化部署：托管前端构建产物，非 API 路径回退到 index.html（SPA 路由）
  const dist = opts.webDist ? resolve(opts.webDist) : null;
  if (dist && existsSync(join(dist, "index.html"))) {
    const indexHtml = readFileSync(join(dist, "index.html"), "utf8");
    app.use("/assets/*", async (c, next) => {
      await next();
      if (c.res.ok) c.header("Cache-Control", "public, max-age=31536000, immutable");
    });
    // 分享链接的只读页：标题和介绍写进 meta（聊天软件贴链接时显示），不进搜索引擎、不带 Referer
    app.get("/share/:token", async (c) => {
      const meta = await shareMeta(ctx, c.req.param("token"));
      c.header("cache-control", "no-store");
      c.header("x-robots-tag", "noindex, nofollow");
      c.header("referrer-policy", "no-referrer");
      return c.html(shareHtml(indexHtml, meta), meta ? 200 : 404);
    });
    app.use("*", serveStatic({ root: dist }));
    app.get("*", (c) => (c.req.path.startsWith("/api/") ? c.notFound() : c.html(indexHtml)));
  } else {
    app.get("/", (c) => c.json({ name: "quirenote-server", api: "/api", health: "/api/health" }));
  }
  return app;
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!,
  );

/** 把分享内容的标题与介绍写进 index.html 的 head。 */
export function shareHtml(indexHtml: string, meta: { title: string; description: string } | null): string {
  const head = [
    '<meta name="robots" content="noindex, nofollow" />',
    '<meta name="referrer" content="no-referrer" />',
    ...(meta
      ? [
          `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
          `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
          `<meta name="description" content="${escapeHtml(meta.description)}" />`,
        ]
      : []),
  ].join("\n    ");
  const title = meta ? `${escapeHtml(meta.title)} · QuireNote` : "QuireNote";
  return indexHtml
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace("</head>", `  ${head}\n  </head>`);
}
