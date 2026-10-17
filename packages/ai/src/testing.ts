/**
 * 测试用的假 OpenAI 兼容服务（不进生产路径）：服务端单测通过注入 fetch 使用，E2E 通过 e2e/fake-llm.ts 起成 HTTP 服务。
 * - GET  /models             → 两个假模型
 * - POST /embeddings         → 确定性的哈希向量
 * - POST /chat/completions   → 文本回答引用 [1]；带 json_schema 时按 schema 生成合法对象，字符串取自资料原句
 * 只看路径后缀，不关心 host。
 */
import { keywordOverlap, splitSentences, stripMarkdown } from "./text";
import { textVector } from "./vector";

export const FAKE_BASE_URL = "http://fake-llm.test/v1";
export const FAKE_CHAT_MODEL = "fake-chat";
export const FAKE_EMBEDDING_MODEL = "fake-embed";
export const FAKE_EMBEDDING_DIM = 64;

interface ChatBody {
  model: string;
  messages: { role: string; content: unknown }[];
  stream?: boolean;
  response_format?: { type: string; json_schema?: { schema?: JsonSchema } };
}

type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  enum?: unknown[];
  const?: unknown;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  definitions?: Record<string, JsonSchema>;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content.map((p) => (p && typeof p === "object" && "text" in p ? String(p.text) : "")).join("\n");
  return "";
}

/** 提示词里 `[n] 《标题》` 之后的资料正文（到下一个编号为止），按编号分组。 */
function passagesIn(prompt: string): Map<number, string> {
  const out = new Map<number, string>();
  let cur: number | null = null;
  for (const line of prompt.split("\n")) {
    const head = /^\[(\d+)\]/.exec(line);
    if (head) {
      cur = Number(head[1]);
      out.set(cur, "");
      continue;
    }
    if (cur !== null) out.set(cur, `${out.get(cur)}${line}\n`);
  }
  return out;
}

function sentencesOf(text: string): string[] {
  return splitSentences(text)
    .map((s) => s.text.trim())
    .filter((t) => stripMarkdown(t).length >= 4 && !t.startsWith("#"));
}

/** 可作为原文引用的句子（逐字取自资料片段）。 */
function sentencePool(prompt: string): string[] {
  return [...passagesIn(prompt).values()].flatMap(sentencesOf);
}

function answerText(prompt: string, question: string): string {
  const passages = passagesIn(prompt);
  // 像真实模型一样从最相关的片段作答（整份资料按原文顺序给出时，第一个片段未必相关）。
  const entries = [...passages.entries()];
  const first = entries.reduce<[number, string] | undefined>(
    (best, e) => (!best || keywordOverlap(question, e[1]) > keywordOverlap(question, best[1]) ? e : best),
    undefined,
  );
  if (!first) return `（测试模型）没有资料片段。问题：${question.slice(0, 60)}`;
  const sentence =
    sentencePool(`[${first[0]}]
${first[1]}`)[0] ?? first[1].trim();
  return `根据资料，${sentence} [${first[0]}]`;
}

function sampleFromSchema(
  schema: JsonSchema,
  root: JsonSchema,
  pool: string[],
  cursor: { i: number },
): unknown {
  if (schema.$ref) {
    const name = schema.$ref.split("/").pop()!;
    return sampleFromSchema(root.$defs?.[name] ?? root.definitions?.[name] ?? {}, root, pool, cursor);
  }
  if (schema.const !== undefined) return schema.const;
  if (schema.enum?.length) return schema.enum[0];
  const variants = schema.anyOf ?? schema.oneOf;
  if (variants?.length) {
    const pick = variants.find((v) => v.type !== "null") ?? variants[0]!;
    return sampleFromSchema(pick, root, pool, cursor);
  }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const type = types.find((t) => t && t !== "null") ?? types[0];
  switch (type) {
    case "object": {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(schema.properties ?? {}))
        out[k] = sampleFromSchema(v, root, pool, cursor);
      return out;
    }
    case "array": {
      const n = Math.min(schema.maxItems ?? 6, Math.max(schema.minItems ?? 0, 6));
      return Array.from({ length: n }, () => sampleFromSchema(schema.items ?? {}, root, pool, cursor));
    }
    case "integer":
    case "number":
      // 编号类字段（片段编号 passage 等）从 1 开始；1 同时也是合法的选项下标。
      return Math.max(schema.minimum ?? 1, Math.min(1, schema.maximum ?? 1));
    case "boolean":
      return false;
    case "null":
      return null;
    default: {
      const s = pool.length ? pool[cursor.i % pool.length]! : `示例 ${cursor.i + 1}`;
      cursor.i++;
      return s;
    }
  }
}

function streamResponse(model: string, content: string, promptChars: number): Response {
  const id = `chatcmpl-fake-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  const chunk = (delta: Record<string, unknown>, finish: string | null) =>
    `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  const parts = content.match(/[\s\S]{1,16}/g) ?? [""];
  // 和 OpenAI 一样，最后一个分片只带用量。
  const usage = `data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [],
    usage: { prompt_tokens: Math.ceil(promptChars / 4), completion_tokens: Math.ceil(content.length / 4) },
  })}\n\n`;
  const body =
    chunk({ role: "assistant", content: "" }, null) +
    parts.map((p) => chunk({ content: p }, null)).join("") +
    chunk({}, "stop") +
    usage +
    "data: [DONE]\n\n";
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

function chatCompletion(body: ChatBody): Response {
  const prompt = body.messages.map((m) => textOf(m.content)).join("\n\n");
  const lastUser = [...body.messages].reverse().find((m) => m.role === "user");
  // 资料片段在系统提示词里；只从这里找片段，避免把提问本身当成最后一个片段的正文。
  const systemText = body.messages
    .filter((m) => m.role === "system")
    .map((m) => textOf(m.content))
    .join("\n\n");
  const schema =
    body.response_format?.type === "json_schema" ? body.response_format.json_schema?.schema : null;
  // 没有编号片段时（自动标注等直接给全文），从用户消息里取句子。
  const pool = sentencePool(prompt);
  if (!pool.length) pool.push(...sentencesOf(textOf(lastUser?.content)));
  const content = schema
    ? JSON.stringify(sampleFromSchema(schema, schema, pool, { i: 0 }))
    : answerText(systemText || prompt, textOf(lastUser?.content));
  if (body.stream) return streamResponse(body.model, content, prompt.length);
  return json({
    id: `chatcmpl-fake-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: body.model,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: Math.ceil(prompt.length / 4), completion_tokens: Math.ceil(content.length / 4) },
  });
}

/** 返回一个实现假 OpenAI 兼容接口的 fetch。 */
export function createFakeOpenAI(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const path = new URL(req.url).pathname;
    if (req.method === "GET" && path.endsWith("/models")) {
      return json({
        object: "list",
        data: [FAKE_CHAT_MODEL, FAKE_EMBEDDING_MODEL].map((id) => ({ id, object: "model" })),
      });
    }
    if (req.method === "POST" && path.endsWith("/embeddings")) {
      const body = (await req.json()) as { input: string | string[]; model: string };
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      return json({
        object: "list",
        model: body.model,
        data: inputs.map((t, index) => ({
          object: "embedding",
          index,
          embedding: textVector(t, FAKE_EMBEDDING_DIM),
        })),
        usage: { prompt_tokens: 0, total_tokens: 0 },
      });
    }
    if (req.method === "POST" && path.endsWith("/chat/completions")) {
      return chatCompletion((await req.json()) as ChatBody);
    }
    return json({ error: { message: `fake-llm: no route for ${req.method} ${path}` } }, 404);
  }) as typeof fetch;
}
