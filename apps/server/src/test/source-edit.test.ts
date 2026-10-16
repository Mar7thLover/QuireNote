import type { Chunk, Job, Notebook, Source, SourceContent } from "@quirenote/core";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeServer, type TestServer } from "./helpers";

let s: TestServer;
let nb: Notebook;
let src: Source;

const ORIGINAL = [
  "# 机器学习简介",
  "",
  "机器学习让计算机从数据中学习规律。",
  "",
  "监督学习使用带标签的数据训练模型。",
  "",
  "强化学习通过奖励信号学习策略。",
].join("\n");

type EditResult = { source: Source; job: Job | null; highlights: { kept: number; removed: number } };

async function content(): Promise<SourceContent> {
  return s.json<SourceContent>(`/sources/${src.id}/content`);
}

async function highlight(text: string, color = "yellow", note = ""): Promise<{ id: string }> {
  const c = await content();
  const start = c.text.indexOf(text);
  return s.json(`/sources/${src.id}/highlights`, {
    method: "POST",
    json: { start, end: start + text.length, color, note },
  });
}

beforeAll(async () => {
  s = await makeServer();
  nb = await s.json<Notebook>("/notebooks", { method: "POST", json: { title: "编辑测试" } });
  src = await s.json<Source>(`/notebooks/${nb.id}/sources`, {
    method: "POST",
    json: { kind: "markdown", title: "ML", text: ORIGINAL },
  });
  await s.ctx.jobs.idle();
});

afterAll(async () => {
  await s.dispose();
});

describe("highlights", () => {
  it("can be recolored, annotated and removed", async () => {
    const h = await highlight("监督学习");
    const patched = await s.json<{ color: string; note: string }>(`/sources/${src.id}/highlights/${h.id}`, {
      method: "PATCH",
      json: { color: "blue", note: "重要" },
    });
    expect(patched).toMatchObject({ color: "blue", note: "重要" });
    await s.json(`/sources/${src.id}/highlights/${h.id}`, { method: "DELETE" });
    expect((await content()).highlights.some((x) => x.id === h.id)).toBe(false);
  });
});

describe("editing a source", () => {
  it("moves highlights with the text, drops rewritten ones and reindexes", async () => {
    const keep = await highlight("强化学习通过奖励信号");
    const gone = await highlight("监督学习使用带标签的数据");
    const edited = ORIGINAL.replace("# 机器学习简介", "# 机器学习简介\n\n这是补充的导语。").replace(
      "监督学习使用带标签的数据训练模型。",
      "半监督学习结合少量标签。",
    );
    const r = await s.json<EditResult>(`/sources/${src.id}/content`, {
      method: "PUT",
      json: { text: edited },
    });
    expect(r.highlights).toEqual({ kept: 1, removed: 1 });
    expect(r.source.props.edited).toBe(true);
    expect(r.job?.type).toBe("ingest");
    await s.ctx.jobs.idle();

    const c = await content();
    expect(c.text).toBe(edited);
    const moved = c.highlights.find((h) => h.id === keep.id)!;
    expect(c.text.slice(moved.start, moved.end)).toBe("强化学习通过奖励信号");
    expect(c.highlights.some((h) => h.id === gone.id)).toBe(false);
    // 分块按新文本重建，检索能找到新内容。
    const chunks = await s.json<Chunk[]>(`/sources/${src.id}/chunks`);
    expect(chunks.map((x) => x.text).join("\n")).toContain("半监督学习");
    for (const ch of chunks) expect(c.text.slice(ch.start, ch.end)).toBe(ch.text);
    const done = await s.json<Source>(`/sources/${src.id}`);
    expect(done.status).toBe("ready");
    expect(done.charCount).toBe(edited.length);
  });

  it("is a no-op when nothing changed and rejects empty text", async () => {
    const c = await content();
    const same = await s.json<EditResult>(`/sources/${src.id}/content`, {
      method: "PUT",
      json: { text: c.text },
    });
    expect(same.job).toBeNull();
    const empty = await s.request(`/sources/${src.id}/content`, { method: "PUT", json: { text: "  \n" } });
    expect(empty.status).toBe(400);
  });

  it("exports the pre-edit original with the notebook", async () => {
    const res = await s.request(`/notebooks/${nb.id}/export`);
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(files)).toContain(`files/source-edits/${src.id}.json`);
  });

  it("reverts to the first original, keeping highlights that still match", async () => {
    // 第二次编辑后恢复：回到最初的版本，而不是上一版。
    const c = await content();
    await s.json(`/sources/${src.id}/content`, { method: "PUT", json: { text: `${c.text}\n\n再加一段。` } });
    await s.ctx.jobs.idle();
    const r = await s.json<EditResult>(`/sources/${src.id}/content/revert`, { method: "POST" });
    expect(r.source.props.edited).toBeUndefined();
    await s.ctx.jobs.idle();
    const back = await content();
    expect(back.text).toBe(ORIGINAL);
    const h = back.highlights.find((x) => back.text.slice(x.start, x.end) === "强化学习通过奖励信号");
    expect(h).toBeTruthy();
    const again = await s.request(`/sources/${src.id}/content/revert`, { method: "POST" });
    expect(again.status).toBe(400);
  });
});
