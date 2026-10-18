import { topicOf } from "@quirenote/ai";
import type { Job, Notebook, ProviderConfig, Source } from "@quirenote/core";
import { afterEach, describe, expect, it } from "vitest";
import { parseLang, setDefaultLang, withLang } from "../lang";
import { makeServer, type TestServer } from "./helpers";

const servers: TestServer[] = [];
async function server(opts: Parameters<typeof makeServer>[0] = {}) {
  const s = await makeServer(opts);
  servers.push(s);
  return s;
}

afterEach(async () => {
  setDefaultLang("zh");
  for (const s of servers.splice(0)) await s.dispose();
});

const en = { headers: { "accept-language": "en-US,en;q=0.9" } };
const errorOf = async (res: Response) =>
  ((await res.json()) as { error: { code: string; message: string } }).error;

describe("界面语言", () => {
  it("parseLang：zh 开头为中文，其他语言为英文，没给出时为 null", () => {
    expect(parseLang("zh-CN,zh;q=0.9")).toBe("zh");
    expect(parseLang("zh-TW")).toBe("zh");
    expect(parseLang("en-US,en;q=0.9")).toBe("en");
    expect(parseLang("fr-FR,fr;q=0.9,en;q=0.8")).toBe("en");
    expect(parseLang("")).toBeNull();
    expect(parseLang("*")).toBeNull();
    expect(parseLang(undefined)).toBeNull();
  });

  it("错误提示按 Accept-Language 或 ?lang= 返回；没有时为中文", async () => {
    const s = await server({ fakeAi: false });
    expect((await errorOf(await s.request("/notes/missing"))).message).toBe("笔记不存在");
    expect((await errorOf(await s.request("/notes/missing", en))).message).toBe("Note not found");
    expect((await errorOf(await s.request("/notes/missing?lang=en"))).message).toBe("Note not found");
    // ?lang= 优先于请求头（下载链接只能带查询参数）
    expect((await errorOf(await s.request("/notes/missing?lang=zh", en))).message).toBe("笔记不存在");
    expect((await errorOf(await s.request("/nope", en))).message).toBe("No such endpoint: GET /api/nope");

    const nb = await s.json<Notebook>("/notebooks", { method: "POST", json: { title: "n" } });
    const res = await s.request(`/notebooks/${nb.id}/research`, {
      method: "POST",
      json: { question: "q" },
      ...en,
    });
    expect(res.status).toBe(400);
    const err = await errorOf(res);
    expect(err.code).toBe("model_not_configured");
    expect(err.message).toBe(
      "Deep research needs a web search model: add a provider in Settings → Models and assign a model to “web search”",
    );
  });

  it("后台任务的进度和结果用入队时的语言写", async () => {
    const s = await server();
    const nb = await s.json<Notebook>("/notebooks", { method: "POST", json: { title: "n" } });
    const add = (headers: Record<string, string>) =>
      s.json<Source>(`/notebooks/${nb.id}/sources`, {
        method: "POST",
        json: { kind: "text", title: "Turing", text: "Alan Turing proposed the imitation game in 1950." },
        headers,
      });
    const srcEn = await add(en.headers);
    const srcZh = await add({ "accept-language": "zh-CN" });
    await s.ctx.jobs.idle();
    const jobs = await s.json<Job[]>("/jobs");
    const ingest = (refId: string) => jobs.find((j) => j.type === "ingest" && j.refId === refId);
    expect(ingest(srcEn.id)?.message).toBe("“Turing” is ready");
    expect(ingest(srcZh.id)?.message).toBe("「Turing」已就绪");
  });

  it("@quirenote/ai 的兜底文字跟着同一个语言", () => {
    const passages = [
      { n: 1, text: "a", title: "A" },
      { n: 2, text: "b", title: "B" },
    ];
    expect(withLang("en", () => topicOf(passages))).toBe("A and 1 more");
    expect(withLang("zh", () => topicOf(passages))).toBe("A 等 2 份资料");
  });

  it("启动时创建的 provider 名称用默认语言", async () => {
    setDefaultLang("en");
    const s = await server();
    const providers = await s.json<ProviderConfig[]>("/providers");
    expect(providers.map((p) => p.name)).toEqual(["OpenAI-compatible API (env)"]);
  });
});
