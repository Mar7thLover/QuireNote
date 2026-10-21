# 桌面端（macOS / Electron）

`apps/desktop` 是 Electron 壳：主进程在应用内直接启动 QuireNote 服务端（Hono + better-sqlite3 + sqlite-vec），窗口加载内嵌的 `apps/web` 构建产物。不需要单独部署服务器，数据保存在 `~/Library/Application Support/QuireNote/data`。

与移动端（连接自托管服务器）不同，桌面端是「服务器 + 界面」一体的单机应用。

## 结构

| 部分 | 说明 |
| --- | --- |
| `src/main.mjs` | Electron 主进程：随机空闲端口起服务、等 `/api/health` 就绪后开 `BrowserWindow`；外部链接交给系统浏览器；退出时先关闭内嵌服务 |
| `src/server-entry.mjs` | 在 Electron 的 Node 侧启动服务端的入口（等价于 `apps/server` 的 `main.ts`） |
| `scripts/bundle.mjs` | esbuild 把服务端及其依赖打成单文件 `dist/server.mjs`（原生模块与 `.dylib` 保持 external），并拷贝 `apps/web/dist` → `dist/web` |
| `scripts/natives.mjs` | 用 `@electron/rebuild` 为 Electron ABI 重编译 better-sqlite3，并把 `sqlite-vec` 的 `vec0.dylib` 一起放进 `native/bin/` |
| `native/` | 只用于编译原生模块的隔离目录（避免污染 workspace 的 Node ABI 构建） |
| `electron-builder.yml` | 打包配置：不签名（`identity: null`）、不开 asar（`better_sqlite3.node` 需按路径加载） |

原生模块不在产物里走 `node_modules` 查找：esbuild 把它们标为 external，运行时由 `QUIRENOTE_SQLITE3_BINDING` / `QUIRENOTE_SQLITE_VEC_EXT` 指向 `Resources/app/server/bin/` 下的两个二进制（见 `apps/server/src/store/sqlite.ts` 的 `openDatabase` / `loadVec`）。

## 构建

```bash
pnpm --filter @quirenote/web build    # 先构建 web 产物
cd apps/desktop
pnpm install                          # 首次
pnpm setup                            # = natives（重编译原生模块）+ bundle
pnpm dist                             # 产出 release/QuireNote-<ver>-arm64-mac.zip
```

开发时可用 `pnpm dev`：复用已有的 `native/bin` 与 `dist`，直接 `electron .`。

需要 Xcode Command Line Tools（`@electron/rebuild` 调用 clang 编译 better-sqlite3）。产物未签名，首次打开需在「系统设置 → 隐私与安全性」放行，或 `xattr -dr com.apple.quarantine QuireNote.app`。

## macOS 适配

- 应用名与菜单栏：`app.setName("QuireNote")`，⌘Q / ⌘W 等默认菜单生效
- 快捷键展示：web 端统一走 `Shortcut`/`SHORTCUTS`（`apps/web/src/lib/hotkeys.ts`），`Mod` 在 Mac 上即 ⌘；手册中的 `Ctrl` 文案在 Mac 下显示为 ⌘
- 新窗口链接一律交给系统默认浏览器，不在应用内开第二个窗口
