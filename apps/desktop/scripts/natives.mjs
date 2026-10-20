/**
 * 准备 Electron ABI 的原生模块：在 apps/desktop/native/ 下独立安装
 * better-sqlite3 / sqlite-vec，并用 @electron/rebuild 针对 Electron 重编译。
 * 独立目录是为了不污染 workspace 里按系统 Node ABI 构建的同名包。
 */
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { rebuild } from "@electron/rebuild";

const desktopDir = resolve(dirname(new URL(import.meta.url).pathname), "..");
const nativeDir = join(desktopDir, "native");
const require = createRequire(import.meta.url);

const electronVersion = JSON.parse(
  readFileSync(require.resolve("electron/package.json", { paths: [desktopDir] }), "utf8"),
).version;

if (!existsSync(join(nativeDir, "node_modules/better-sqlite3"))) {
  console.log(`[natives] 安装原生依赖（better-sqlite3 / sqlite-vec）…`);
  execSync("npm install --omit=dev --no-audit --no-fund", { cwd: nativeDir, stdio: "inherit" });
}

console.log(`[natives] 针对 Electron ${electronVersion} 重编译 better-sqlite3…`);
await rebuild({
  buildPath: nativeDir,
  electronVersion,
  arch: process.arch,
  force: true,
  onlyModules: ["better-sqlite3"],
});

// 只导出运行时真正需要的两个二进制，打包时随 dist/bin 进 .app（不进 node_modules）
const binDir = join(nativeDir, "bin");
mkdirSync(binDir, { recursive: true });
copyFileSync(
  join(nativeDir, `node_modules/better-sqlite3/prebuilds/${process.platform}-${process.arch}.node`),
  join(binDir, "better_sqlite3.node"),
);
copyFileSync(
  join(nativeDir, `node_modules/sqlite-vec-${process.platform}-${process.arch}/vec0.dylib`),
  join(binDir, "vec0.dylib"),
);
console.log(`[natives] 完成，二进制在 ${binDir}`);
