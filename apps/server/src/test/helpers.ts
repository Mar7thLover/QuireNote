/** 测试工具：临时数据目录的服务实例、SSE 解析、内存中的 PDF / DOCX / EPUB 样例。 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFakeOpenAI,
  FAKE_BASE_URL,
  FAKE_CHAT_MODEL,
  FAKE_EMBEDDING_MODEL,
} from "@quirenote/ai/testing";
import { strToU8, zipSync } from "fflate";
import { boot, type Server } from "../boot";
import type { ServerConfig } from "../config";

export interface TestServer extends Server {
  dir: string;
  request(path: string, init?: RequestInit & { json?: unknown }): Promise<Response>;
  json<T = unknown>(path: string, init?: RequestInit & { json?: unknown }): Promise<T>;
  dispose(): Promise<void>;
}

/** 让测试服务通过环境变量引导出假 OpenAI 兼容 provider，并分配为对话与 Embedding 模型。 */
export const FAKE_AI_ENV: NodeJS.ProcessEnv = {
  OPENAI_COMPATIBLE_BASE_URL: FAKE_BASE_URL,
  OPENAI_COMPATIBLE_CHAT_MODEL: FAKE_CHAT_MODEL,
  OPENAI_COMPATIBLE_EMBEDDING_MODEL: FAKE_EMBEDDING_MODEL,
};

const fakeOpenAI = createFakeOpenAI();

/** 发往假模型地址的请求交给假模型，其余交给测试自己的 mock（没有时报错，避免误连外网）。 */
function routeAiFetch(custom?: typeof fetch, spy?: (url: string, body: unknown) => void): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(FAKE_BASE_URL)) {
      if (spy && typeof init?.body === "string") spy(url, JSON.parse(init.body));
      return fakeOpenAI(input, init);
    }
    if (custom) return custom(input, init);
    return Promise.reject(new TypeError(`测试中不允许访问 ${url}`));
  }) as typeof fetch;
}

export async function makeServer(
  opts: {
    seed?: boolean;
    /** 测试自己的 AI 请求 mock；发往假模型的请求不经过它。 */
    aiFetch?: typeof fetch;
    /** 记录发往假模型的请求体（检查提示词）。 */
    aiSpy?: (url: string, body: unknown) => void;
    fetch?: typeof fetch;
    /** 额外的环境变量（与 FAKE_AI_ENV 合并）。 */
    env?: NodeJS.ProcessEnv;
    /** false：不配置任何模型，用于测试未配置时的行为。 */
    fakeAi?: boolean;
    dir?: string;
  } = {},
): Promise<TestServer> {
  const dir = opts.dir ?? mkdtempSync(join(tmpdir(), "quirenote-test-"));
  const config: ServerConfig = {
    port: 0,
    dataDir: dir,
    secret: "unit-test-secret",
    resetData: false,
    jobConcurrency: 2,
    seed: opts.seed ?? false,
  };
  const env = { ...(opts.fakeAi === false ? {} : FAKE_AI_ENV), ...opts.env };
  const server = await boot(config, {
    aiFetch: routeAiFetch(opts.aiFetch, opts.aiSpy),
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
    env,
  });
  const request = (path: string, init: RequestInit & { json?: unknown } = {}) => {
    const { json, ...rest } = init;
    const headers = new Headers(rest.headers);
    if (json !== undefined) headers.set("content-type", "application/json");
    return Promise.resolve(
      server.app.request(`/api${path}`, {
        ...rest,
        headers,
        ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
      }),
    );
  };
  return {
    ...server,
    dir,
    request,
    async json<T>(path: string, init?: RequestInit & { json?: unknown }) {
      const res = await request(path, init);
      const text = await res.text();
      if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status} ${text}`);
      return JSON.parse(text) as T;
    },
    async dispose() {
      await server.ctx.jobs.idle();
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export interface SseEvent {
  event: string;
  data: unknown;
}

export function parseSse(text: string): SseEvent[] {
  const out: SseEvent[] = [];
  for (const block of text.split(/\n\n/)) {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (data.length) out.push({ event, data: JSON.parse(data.join("\n")) });
  }
  return out;
}

export async function readSse(res: Response): Promise<SseEvent[]> {
  return parseSse(await res.text());
}

/** 手写的最小 PDF：每页一行 Helvetica 文本（仅 ASCII）。 */
export function makePdf(pages: string[]): Uint8Array<ArrayBuffer> {
  const objs: string[] = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((t, i) => {
    const content = `BT /F1 14 Tf 72 720 Td (${t.replace(/[()\\]/g, "\\$&")}) Tj ET`;
    objs[4 + i * 2] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`;
    objs[5 + i * 2] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(strToU8(out));
}

export function makeDocx(paragraphs: string[]): Uint8Array<ArrayBuffer> {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return new Uint8Array(
    zipSync({
      "[Content_Types].xml": strToU8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      "_rels/.rels": strToU8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
      "word/document.xml": strToU8(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs
          .map((p) => `<w:p><w:r><w:t>${esc(p)}</w:t></w:r></w:p>`)
          .join("")}</w:body></w:document>`,
      ),
    }),
  );
}

export function makeEpub(title: string, chapters: { title: string; html: string }[]): Uint8Array {
  const files: Record<string, Uint8Array> = {
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(
      '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
    "OEBPS/content.opf": strToU8(
      `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title></metadata><manifest>${chapters
        .map((_, i) => `<item id="c${i}" href="text/ch${i}.xhtml" media-type="application/xhtml+xml"/>`)
        .join(
          "",
        )}</manifest><spine>${chapters.map((_, i) => `<itemref idref="c${i}"/>`).join("")}</spine></package>`,
    ),
  };
  chapters.forEach((c, i) => {
    files[`OEBPS/text/ch${i}.xhtml`] = strToU8(
      `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${c.title}</title></head><body>${c.html}</body></html>`,
    );
  });
  return zipSync(files);
}

export function cleanupDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
