/**
 * 打包内嵌资源：esbuild 把服务端（workspace TS 源码）打成单文件，
 * 复制 Web 构建产物与原生依赖到 dist/。结构：
 *   dist/server.mjs            服务端单文件（better-sqlite3 的 JS 也打进 bundle；
 *                              .node / .dylib 由外壳通过 QUIREENOTE_* env 指定路径）
 *   dist/bin/*                 Electron ABI 的原生二进制（由 scripts/natives.mjs 生成）
 *   dist/web/*                 apps/web 构建产物
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { build } from "esbuild";

const desktopDir = resolve(dirname(new URL(import.meta.url).pathname), "..");
const repoRoot = resolve(desktopDir, "../..");
const outDir = join(desktopDir, "dist");
const nativesBin = join(desktopDir, "native/bin");
const webDist = join(repoRoot, "apps/web/dist");

if (!existsSync(join(webDist, "index.html"))) {
  console.error("[bundle] 缺少 apps/web/dist，先运行 pnpm --filter @quirenote/web build");
  process.exit(1);
}
if (!existsSync(join(nativesBin, "better_sqlite3.node"))) {
  console.error("[bundle] 缺少 native/bin，先运行 pnpm --filter @quirenote/desktop natives");
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [join(desktopDir, "src/server-entry.mjs")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  outfile: join(outDir, "server.mjs"),
  // better-sqlite3 / sqlite-vec 的 JS 一并打包；.node / .dylib 二进制不进 bundle，
  // 运行时由 QUIREENOTE_SQLITE3_BINDING / QUIREENOTE_SQLITE_VEC_EXT 指定。
  external: ["*.node", "*.dylib"],
  // 服务端的依赖（hono、better-sqlite3 等）在 apps/server/node_modules 下解析
  nodePaths: [join(repoRoot, "apps/server/node_modules"), join(repoRoot, "node_modules")],
  banner: {
    // CJS 依赖里的 require()（含 node builtin）在 ESM 产物中需要真实 require；
    // 用别名避开 esbuild 在打包产物里自动注入的同名 import。
    js: 'import { createRequire as __cr } from "node:module";\nconst require = __cr(import.meta.url);',
  },
});

cpSync(webDist, join(outDir, "web"), { recursive: true });
cpSync(nativesBin, join(outDir, "bin"), { recursive: true });

console.log(`[bundle] server + web + natives → ${outDir}`);
