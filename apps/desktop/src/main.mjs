/**
 * QuireNote 桌面端（macOS）主进程：内嵌服务端 + 内置 Web 界面。
 * 数据保存在 userData/data，与自托管部署同构但开箱即用。
 */
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, shell } from "electron";

app.setName("QuireNote");

const here = dirname(new URL(import.meta.url).pathname);
// 打包后资源在 resources/app/server/（files 配置），开发态在 apps/desktop/dist/
const resourceBase = app.isPackaged ? join(process.resourcesPath, "app", "server") : join(here, "..", "dist");
const serverBundle = join(resourceBase, "server.mjs");
const webDist = join(resourceBase, "web");
const binDir = join(resourceBase, "bin");

let closing = false;
let closeServer = async () => {};

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function startServer() {
  const port = await freePort();
  process.env.PORT = String(port);
  process.env.QUIRENOTE_DATA_DIR = join(app.getPath("userData"), "data");
  process.env.QUIRENOTE_WEB_DIST = webDist;
  process.env.QUIRENOTE_SQLITE3_BINDING = join(binDir, "better_sqlite3.node");
  process.env.QUIRENOTE_SQLITE_VEC_EXT = join(binDir, "vec0.dylib");
  // 桌面端默认关闭种子数据可通过 QUIREENOTE_SEED=0；保持默认与 Docker 一致。
  const mod = await import(pathToFileURL(serverBundle).href);
  closeServer = mod.close;
  return port;
}

async function waitForHealth(port, timeoutMs = 30000) {
  const url = `http://127.0.0.1:${port}/api/health`;
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      lastErr = new Error(`health ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw lastErr ?? new Error("server did not become healthy");
}

async function createMainWindow(port) {
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 600,
    title: "QuireNote",
    backgroundColor: "#141311",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  // 外链交给系统浏览器，应用内只导航本机地址
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  await win.loadURL(`http://127.0.0.1:${port}`);
}

app.whenReady().then(async () => {
  try {
    const port = await startServer();
    await waitForHealth(port);
    await createMainWindow(port);
  } catch (err) {
    console.error(err);
    dialog.showErrorBox("QuireNote 启动失败", String(err?.stack ?? err));
    app.exit(1);
  }
});

app.on("window-all-closed", () => app.quit());

app.on("before-quit", (e) => {
  if (closing) return;
  e.preventDefault();
  closing = true;
  closeServer()
    .catch(() => {})
    .finally(() => app.quit());
});
