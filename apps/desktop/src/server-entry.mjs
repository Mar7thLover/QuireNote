/**
 * 桌面端内嵌服务端入口：与 apps/server/src/main.ts 等价，但把 HTTP 句柄暴露给
 * Electron 主进程，退出时优雅关闭。打包时由 scripts/bundle.mjs 用 esbuild 打成单文件。
 */
import { serve } from "@hono/node-server";
import { boot } from "../../server/src/boot";
import { loadConfig, VERSION } from "../../server/src/config";
import { bootLang, setDefaultLang } from "../../server/src/lang";

setDefaultLang(bootLang(process.env));
const config = loadConfig();
const log = (msg) => console.log(msg);

const server = await boot(config, { env: process.env, log });

// 桌面版只监听回环地址：数据属于本机，不暴露到局域网。
const http = serve({ fetch: server.app.fetch, port: config.port, hostname: "127.0.0.1" }, (info) => {
  log(
    `[quirenote] desktop server ${VERSION} listening on http://127.0.0.1:${info.port}  (data: ${config.dataDir})`,
  );
});

export async function close() {
  http.close();
  await server.close();
}
