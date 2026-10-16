/** E2E 用的假 OpenAI 兼容服务：把 HTTP 请求转给 @quirenote/ai 的假模型。端口取 PORT（默认 8798）。 */
import { createServer } from "node:http";
import { createFakeOpenAI } from "../packages/ai/src/testing";

const port = Number(process.env.PORT) || 8798;
const fake = createFakeOpenAI();

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  const out = await fake(`http://localhost:${port}${req.url ?? "/"}`, {
    method: req.method ?? "GET",
    headers,
    ...(body && req.method !== "GET" ? { body } : {}),
  });
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(Buffer.from(await out.arrayBuffer()));
}).listen(port, () => console.log(`[fake-llm] listening on http://localhost:${port}/v1`));
