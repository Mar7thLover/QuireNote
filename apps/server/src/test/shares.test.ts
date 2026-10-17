/** 分享链接：创建、公开读取、撤销后 404、不能越权读别的笔记和资源、只读页的 HTML。 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Asset, Note, Notebook, QuireCard } from "@quirenote/core";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupDir, makeServer, type TestServer } from "./helpers";

const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

interface ShareView {
  token: string;
  kind: "note" | "notebook";
  targetId: string;
  notebookId: string;
  title: string | null;
  notebookTitle: string | null;
  options: { render: boolean; lorebook: boolean; instructions: boolean; sources: boolean; creator: string };
  path: string;
  createdAt: string;
}

interface PublicShare {
  token: string;
  kind: "note" | "notebook";
  card: QuireCard;
}

let s: TestServer;
let webDir: string;
let nb: Notebook;
let other: Notebook;
let note: Note;
let second: Note;
let secret: Note;
let asset: Asset;
let secretAsset: Asset;

const upload = async (nbId: string, bytes: Uint8Array, name: string) => {
  const form = new FormData();
  form.append("file", new File([bytes as BlobPart], name));
  return (await (
    await s.request(`/notebooks/${nbId}/assets`, { method: "POST", body: form })
  ).json()) as Asset;
};
const share = (json: Record<string, unknown>) => s.request("/shares", { method: "POST", json });
const createShare = async (json: Record<string, unknown>) => {
  const res = await share(json);
  expect(res.status).toBe(201);
  return (await res.json()) as ShareView;
};
const ensureShare = async (json: Record<string, unknown>) => (await (await share(json)).json()) as ShareView;
const readPublic = (token: string) => s.request(`/public/shares/${token}`);

beforeAll(async () => {
  webDir = mkdtempSync(join(tmpdir(), "quirenote-web-"));
  writeFileSync(
    join(webDir, "index.html"),
    "<!doctype html><html><head><title>QuireNote</title></head><body><div id=root></div></body></html>",
  );
  s = await makeServer({ env: { QUIRENOTE_WEB_DIST: webDir } });
  nb = await s.json<Notebook>("/notebooks", { method: "POST", json: { title: "基地" } });
  other = await s.json<Notebook>("/notebooks", { method: "POST", json: { title: "私人日记" } });
  asset = await upload(nb.id, PNG, "map.png");
  // 另一份内容不同的图片，放在同一本 Notebook 但不被分享的笔记引用
  secretAsset = await upload(nb.id, Uint8Array.from([...PNG.subarray(0, PNG.length - 1), 0x83]), "s.png");
  note = await s.json<Note>(`/notebooks/${nb.id}/notes`, {
    method: "POST",
    json: { title: "心理史学", markdown: `# 心理史学\n\n![地图](asset://${asset.id})\n\n正文。` },
  });
  second = await s.json<Note>(`/notebooks/${nb.id}/notes`, {
    method: "POST",
    json: { title: "第二篇", markdown: `![秘密](asset://${secretAsset.id})` },
  });
  secret = await s.json<Note>(`/notebooks/${other.id}/notes`, {
    method: "POST",
    json: { title: "不能给人看", markdown: "我的密码提示" },
  });
  await s.json(`/notebooks/${nb.id}/lorebook/entries`, {
    method: "POST",
    json: { name: "谢顿", keys: ["谢顿"], content: "谢顿是数学家。" },
  });
  await s.json(`/notebooks/${nb.id}`, {
    method: "PATCH",
    json: { aiInstructions: "像图书管理员一样回答。" },
  });
});

afterAll(async () => {
  await s.dispose();
  cleanupDir(webDir);
});

describe("分享链接", () => {
  it("生成笔记链接：令牌随机，同样的选项再生成返回同一个", async () => {
    const a = await createShare({ kind: "note", id: note.id, creator: "Mar" });
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(a).toMatchObject({
      kind: "note",
      targetId: note.id,
      notebookId: nb.id,
      title: "心理史学",
      notebookTitle: "基地",
      path: `/share/${a.token}`,
      options: { render: true, lorebook: false, instructions: false, sources: false, creator: "Mar" },
    });
    const again = await share({ kind: "note", id: note.id, creator: "Mar" });
    expect(again.status).toBe(200);
    expect(((await again.json()) as ShareView).token).toBe(a.token);
    // 选项不同就是另一条链接
    const b = await createShare({ kind: "note", id: note.id, render: false });
    expect(b.token).not.toBe(a.token);
    const list = await s.json<ShareView[]>("/shares");
    expect(list.map((x) => x.token)).toEqual([b.token, a.token]);
  });

  it("目标不存在或参数不对时拒绝", async () => {
    expect((await share({ kind: "note", id: "note_nope" })).status).toBe(404);
    expect((await share({ kind: "notebook", id: "nb_nope" })).status).toBe(404);
    expect((await share({ kind: "artifact", id: note.id })).status).toBe(400);
  });

  it("公开读取笔记：卡片 JSON，资源指向公开地址，不内联", async () => {
    // 第一个用例已经生成过同样选项的链接，这里拿到的是同一个
    const { token } = await ensureShare({ kind: "note", id: note.id, creator: "Mar" });
    const res = await readPublic(token);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
    const body = (await res.json()) as PublicShare;
    expect(body.kind).toBe("note");
    expect(body.card.data).toMatchObject({ kind: "note", name: "心理史学", creator: "Mar" });
    expect(body.card.data.notes.map((n) => n.title)).toEqual(["心理史学"]);
    expect(body.card.data.assets).toHaveLength(1);
    expect(body.card.data.assets[0]!.uri).toBe(`/api/public/shares/${token}/assets/${asset.id}`);

    const img = await s.request(`/public/shares/${token}/assets/${asset.id}`);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(PNG);
  });

  it("下载卡片：JSON 内联资源，.quire 是压缩包", async () => {
    const { token } = await ensureShare({ kind: "note", id: note.id, creator: "Mar" });
    const json = await s.request(`/public/shares/${token}/card?format=json`);
    expect(json.headers.get("content-disposition")).toContain(".quire.json");
    const card = (await json.json()) as QuireCard;
    expect(card.data.assets[0]!.uri).toMatch(/^data:image\/png;base64,/);
    const zip = await s.request(`/public/shares/${token}/card?format=quire`);
    expect(zip.headers.get("content-type")).toBe("application/zip");
    const files = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    expect(JSON.parse(new TextDecoder().decode(files["card.json"])).data.name).toBe("心理史学");
  });

  it("整本 Notebook：按创建时的选项带知识书和 AI 说明，内容随原文更新", async () => {
    const full = await createShare({ kind: "notebook", id: nb.id });
    expect(full.options).toMatchObject({ lorebook: true, instructions: true, sources: false });
    let card = ((await (await readPublic(full.token)).json()) as PublicShare).card;
    expect(card.data.notes.map((n) => n.title)).toEqual(["心理史学", "第二篇"]);
    expect(card.data.lorebook?.entries.map((e) => e.name)).toEqual(["谢顿"]);
    expect(card.data.ai_instructions).toBe("像图书管理员一样回答。");
    // 别的 Notebook 的笔记不会混进来
    expect(JSON.stringify(card)).not.toContain("不能给人看");

    const bare = await createShare({ kind: "notebook", id: nb.id, lorebook: false, instructions: false });
    card = ((await (await readPublic(bare.token)).json()) as PublicShare).card;
    expect(card.data.lorebook).toBeUndefined();
    expect(card.data.ai_instructions).toBe("");

    await s.json(`/notes/${second.id}`, { method: "PATCH", json: { title: "第二篇（改）" } });
    card = ((await (await readPublic(full.token)).json()) as PublicShare).card;
    expect(card.data.notes.map((n) => n.title)).toContain("第二篇（改）");
  });

  it("不能越权：笔记链接读不到同本里别的笔记的资源、别的 Notebook 的资源，猜令牌也不行", async () => {
    const { token } = await createShare({ kind: "note", id: note.id, render: true, creator: "x" });
    // 同一本 Notebook 里、但不在分享笔记正文中的资源
    expect((await s.request(`/public/shares/${token}/assets/${secretAsset.id}`)).status).toBe(404);
    const elsewhere = await upload(other.id, Uint8Array.from([...PNG, 0]), "e.png");
    expect((await s.request(`/public/shares/${token}/assets/${elsewhere.id}`)).status).toBe(404);
    // 路径穿越与奇怪的 id
    expect((await s.request(`/public/shares/${token}/assets/..%2F..%2Fquirenote.db`)).status).toBe(404);
    // 整本链接可以读本里任一笔记引用的资源
    const book = await createShare({ kind: "notebook", id: nb.id, creator: "y" });
    expect((await s.request(`/public/shares/${book.token}/assets/${secretAsset.id}`)).status).toBe(200);
    expect((await s.request(`/public/shares/${book.token}/assets/${elsewhere.id}`)).status).toBe(404);
    // 令牌不存在、格式不对、拿笔记或 Notebook 的 id 当令牌
    for (const t of ["AAAAAAAAAAAAAAAAAAAAAAAA", "x", secret.id, other.id, nb.id]) {
      const res = await readPublic(t);
      expect(res.status).toBe(404);
      expect(JSON.stringify(await res.json())).not.toContain("不能给人看");
    }
  });

  it("撤销后公开接口全部 404，列表里不再出现", async () => {
    const { token } = await createShare({ kind: "note", id: note.id, creator: "撤销测试" });
    expect((await readPublic(token)).status).toBe(200);
    expect(await s.json(`/shares/${token}`, { method: "DELETE" })).toEqual({ ok: true });
    for (const path of [
      `/public/shares/${token}`,
      `/public/shares/${token}/card?format=json`,
      `/public/shares/${token}/card?format=quire`,
      `/public/shares/${token}/assets/${asset.id}`,
    ]) {
      const res = await s.request(path);
      expect(res.status, path).toBe(404);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_found");
    }
    expect((await s.json<ShareView[]>("/shares")).map((x) => x.token)).not.toContain(token);
    // 重复撤销不报错；不存在的令牌 404
    expect((await s.request(`/shares/${token}`, { method: "DELETE" })).status).toBe(200);
    expect((await s.request("/shares/AAAAAAAAAAAAAAAAAAAAAAAA", { method: "DELETE" })).status).toBe(404);
    // 同样的选项再生成是一条新链接
    const fresh = await createShare({ kind: "note", id: note.id, creator: "撤销测试" });
    expect(fresh.token).not.toBe(token);
  });

  it("删除笔记后链接失效并从列表移除；删除 Notebook 一并清掉", async () => {
    const tmp = await s.json<Note>(`/notebooks/${other.id}/notes`, {
      method: "POST",
      json: { title: "临时", markdown: "x" },
    });
    const a = await createShare({ kind: "note", id: tmp.id });
    const b = await createShare({ kind: "notebook", id: other.id });
    await s.json(`/notes/${tmp.id}`, { method: "DELETE" });
    expect((await readPublic(a.token)).status).toBe(404);
    let tokens = (await s.json<ShareView[]>("/shares")).map((x) => x.token);
    expect(tokens).not.toContain(a.token);
    expect(tokens).toContain(b.token);
    await s.json(`/notebooks/${other.id}`, { method: "DELETE" });
    expect((await readPublic(b.token)).status).toBe(404);
    tokens = (await s.json<ShareView[]>("/shares")).map((x) => x.token);
    expect(tokens).not.toContain(b.token);
  });

  it("只读页 HTML：写入标题，不进搜索引擎；失效的链接 404", async () => {
    const { token } = await createShare({ kind: "note", id: note.id, creator: "html" });
    const res = await s.app.request(`/share/${token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    const html = await res.text();
    expect(html).toContain("<title>心理史学 · QuireNote</title>");
    expect(html).toContain('property="og:title" content="心理史学"');
    expect(html).toContain("<div id=root></div>");
    await s.json(`/shares/${token}`, { method: "DELETE" });
    const gone = await s.app.request(`/share/${token}`);
    expect(gone.status).toBe(404);
    expect(await gone.text()).not.toContain("心理史学");
  });
});
