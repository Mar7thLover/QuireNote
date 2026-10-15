import { describe, expect, it } from "vitest";
import {
  captionsToText,
  fetchUrl,
  fetchYoutubeTranscript,
  htmlToText,
  parseCaptions,
  parseDocx,
  parseEpub,
  parseHtmlArticle,
  parsePdf,
  parsePlain,
  youtubeId,
} from "../ingest/parsers";
import { makeDocx, makeEpub, makePdf } from "./helpers";

const ARTICLE = `<!doctype html><html><head><title>Dartmouth 1956 - Example</title></head><body>
<nav>Home | About</nav>
<article><h1>The Dartmouth Workshop</h1>
<p>In the summer of 1956, John McCarthy and colleagues organized a workshop at Dartmouth College. The proposal coined the term artificial intelligence.</p>
<p>The workshop lasted about eight weeks and brought together researchers interested in machine intelligence &amp; learning.</p>
<h2>Legacy</h2><p>Many consider 1956 the birth year of AI as an academic field, which shaped decades of research that followed.</p>
</article><footer>Copyright</footer></body></html>`;

function htmlResponse(html: string, type = "text/html; charset=utf-8") {
  return new Response(html, { headers: { "content-type": type } });
}

describe("parsers", () => {
  it("plain text: normalizes newlines and BOM", () => {
    const d = parsePlain("﻿line1\r\nline2\r\n\r\n\r\n\r\nline3  \n");
    expect(d.text).toBe("line1\nline2\n\nline3");
    expect(d.pageOffsets).toEqual([0]);
  });

  it("plain text with form feeds becomes pages", () => {
    const d = parsePlain("Page A\fPage B\fPage C", { formFeedPages: true });
    expect(d.pageCount).toBe(3);
    expect(d.pageOffsets).toHaveLength(3);
    expect(d.text.slice(d.pageOffsets[2]!)).toBe("Page C");
  });

  it("pdf: extracts per-page text with page offsets (unpdf)", async () => {
    const d = await parsePdf(
      makePdf(["Alan Turing proposed the imitation game.", "The Dartmouth workshop happened in 1956."]),
    );
    expect(d.pageCount).toBe(2);
    expect(d.pageOffsets).toHaveLength(2);
    expect(d.text.slice(0, d.pageOffsets[1])).toContain("imitation game");
    expect(d.text.slice(d.pageOffsets[1]!)).toContain("Dartmouth workshop");
  });

  it("pdf: rejects garbage with a clear error", async () => {
    await expect(parsePdf(new TextEncoder().encode("not a pdf"))).rejects.toThrow(/PDF/);
  });

  it("docx: extracts paragraphs (mammoth)", async () => {
    const d = await parseDocx(makeDocx(["第一段：图灵测试。", "Second paragraph about AI & learning."]));
    expect(d.text).toContain("第一段：图灵测试。");
    expect(d.text).toContain("Second paragraph about AI & learning.");
    expect(d.text.indexOf("第一段")).toBeLessThan(d.text.indexOf("Second"));
  });

  it("epub: follows the spine and strips xhtml tags", () => {
    const d = parseEpub(
      makeEpub("AI 简史", [
        { title: "第一章", html: "<h1>第一章 起源</h1><p>1956 年，达特茅斯会议召开。</p>" },
        { title: "第二章", html: "<p>感知机 &amp; 反向传播。</p><p>第二段<br/>换行</p>" },
      ]),
    );
    expect(d.title).toBe("AI 简史");
    expect(d.text).toContain("# 第一章 起源");
    expect(d.text).toContain("1956 年，达特茅斯会议召开。");
    expect(d.text).toContain("# 第二章");
    expect(d.text).toContain("感知机 & 反向传播。");
    expect(d.text).not.toMatch(/<[a-z]/);
    expect(d.text.indexOf("第一章")).toBeLessThan(d.text.indexOf("第二章"));
  });

  it("html: converts block structure to paragraphs and headings", () => {
    const t = htmlToText(
      "<h2>Title</h2><p>a &lt; b</p><ul><li>one</li><li>two</li></ul><script>x()</script>",
    );
    expect(t).toBe("## Title\n\na < b\n\n- one\n- two");
  });

  it("html article: Readability extracts the main content", () => {
    const d = parseHtmlArticle(ARTICLE, "https://example.org/dartmouth");
    expect(d.title).toMatch(/Dartmouth/);
    expect(d.text).toContain("In the summer of 1956");
    expect(d.text).toContain("machine intelligence & learning");
    expect(d.text).not.toContain("Home | About");
  });

  it("url: fetches with a browser UA and parses HTML", async () => {
    const calls: string[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      calls.push(`${url} ${new Headers(init?.headers).get("user-agent")?.slice(0, 7)}`);
      return htmlResponse(ARTICLE);
    }) as unknown as typeof fetch;
    const { doc, mime } = await fetchUrl("https://example.org/dartmouth", f);
    expect(mime).toBe("text/html");
    expect(doc.text).toContain("Dartmouth College");
    expect(calls[0]).toBe("https://example.org/dartmouth Mozilla");
  });

  it("url: handles PDFs and HTTP errors", async () => {
    const pdf = makePdf(["Remote PDF page"]);
    const ok = (async () =>
      new Response(pdf, { headers: { "content-type": "application/pdf" } })) as unknown as typeof fetch;
    expect((await fetchUrl("https://example.org/a.pdf", ok)).doc.text).toContain("Remote PDF page");
    const notFound = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    await expect(fetchUrl("https://example.org/missing", notFound)).rejects.toThrow(/404/);
    await expect(fetchUrl("ftp://example.org", ok)).rejects.toThrow(/http/);
  });

  it("youtube: extracts video ids", () => {
    expect(youtubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://example.com/watch?v=x")).toBeNull();
  });

  it("youtube: fetches caption tracks and builds timestamped paragraphs", async () => {
    const page = `<html><script>var x = {"captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?v=abc\\u0026lang=en","languageCode":"en","kind":"asr"},{"baseUrl":"https://www.youtube.com/api/timedtext?v=abc\\u0026lang=zh-Hans","languageCode":"zh-Hans"}]};
      var d = {"videoDetails":{"title":"AI 简史讲座","lengthSeconds":"600"}};</script></html>`;
    const xml = `<?xml version="1.0"?><transcript><text start="0.5" dur="2">大家好</text><text start="3" dur="2">今天讲 &amp;amp; 图灵</text><text start="40" dur="2">第二段</text></transcript>`;
    const urls: string[] = [];
    const f = (async (url: string) => {
      urls.push(url);
      return url.includes("timedtext") ? htmlResponse(xml, "text/xml") : htmlResponse(page);
    }) as unknown as typeof fetch;
    const d = await fetchYoutubeTranscript("https://youtu.be/abcdefghijk", f);
    expect(urls[1]).toBe("https://www.youtube.com/api/timedtext?v=abc&lang=zh-Hans");
    expect(d.text).toBe("[00:00] 大家好 今天讲 & 图灵 第二段");
    expect(d.title).toBe("AI 简史讲座");
  });

  it("youtube: clear error when there are no captions", async () => {
    const f = (async () => htmlResponse("<html>no captions here</html>")) as unknown as typeof fetch;
    await expect(fetchYoutubeTranscript("https://youtu.be/abcdefghijk", f)).rejects.toThrow(/字幕/);
  });

  it("captions: parses json3 and groups by ~30s", () => {
    const lines = parseCaptions(
      JSON.stringify({
        events: [
          { tStartMs: 0, segs: [{ utf8: "a" }] },
          { tStartMs: 31000, segs: [{ utf8: "b" }] },
          { tStartMs: 35000, segs: [{ utf8: "c" }] },
        ],
      }),
    );
    expect(captionsToText(lines)).toBe("[00:00] a b\n\n[00:35] c");
  });
});
