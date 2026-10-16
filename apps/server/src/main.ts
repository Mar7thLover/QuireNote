import { serve } from "@hono/node-server";
import { boot } from "./boot";
import { loadConfig, VERSION } from "./config";

const config = loadConfig();
const log = (msg: string) => console.log(msg);

const server = await boot(config, { env: process.env, log });

const http = serve({ fetch: server.app.fetch, port: config.port }, (info) => {
  log(`[quirenote] server ${VERSION} listening on http://localhost:${info.port}  (data: ${config.dataDir})`);
});

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  log(`[quirenote] ${signal}，正在关闭…`);
  http.close();
  await server.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
