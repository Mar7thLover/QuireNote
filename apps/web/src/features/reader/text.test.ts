import { describe, expect, it } from "vitest";
import { paragraphize, segmentParagraph } from "./text";

describe("paragraphize", () => {
  const text = "# 标题\n第一段\n\n\n第二段\f第三页的段落";
  const paras = paragraphize(text, [0, text.indexOf("\f") + 1]);

  it("段落偏移与原文一致", () => {
    for (const p of paras) expect(text.slice(p.start, p.end)).toBe(p.text);
  });

  it("识别标题并记录前缀长度", () => {
    expect(paras[0]).toMatchObject({ heading: 1, prefix: 2, text: "# 标题" });
  });

  it("折叠连续空行", () => {
    const empties = paras.filter((p) => !p.text.trim());
    expect(empties).toHaveLength(1);
  });

  it("按页偏移标注页码与分页", () => {
    const last = paras.at(-1)!;
    expect(last).toMatchObject({ page: 2, pageBreak: true, text: "第三页的段落" });
  });
});

describe("segmentParagraph", () => {
  const p = { start: 10, end: 20, text: "0123456789", page: 1, pageBreak: false, heading: 0, prefix: 0 };

  it("切出高亮片段", () => {
    const segs = segmentParagraph(p, [{ start: 12, end: 15, cls: "hl-yellow", id: "h1" }]);
    expect(segs.map((s) => s.text)).toEqual(["01", "234", "56789"]);
    expect(segs[1]).toMatchObject({ cls: ["hl-yellow"], ids: ["h1"] });
  });

  it("重叠区间叠加样式，越界区间被裁剪", () => {
    const segs = segmentParagraph(p, [
      { start: 5, end: 14, cls: "a" },
      { start: 13, end: 30, cls: "b" },
    ]);
    expect(segs.map((s) => [s.text, s.cls.join(",")])).toEqual([
      ["012", "a"],
      ["3", "a,b"],
      ["456789", "b"],
    ]);
  });

  it("隐藏 markdown 前缀", () => {
    const h = { ...p, text: "## 小节", end: 15, heading: 2, prefix: 3 };
    const segs = segmentParagraph(h, []);
    expect(segs[0]).toMatchObject({ text: "## ", hidden: true });
    expect(segs[1]).toMatchObject({ text: "小节", hidden: false });
  });
});
