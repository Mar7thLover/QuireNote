import { QUIRE_CARD_SPEC, QUIRE_CARD_VERSION, type QuireCard } from "@quirenote/core";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { CardError, cardToPng, cardToZip, parseCardFile } from "./parse";
import { base64ToBytes, encodeJsonBase64, readPngText, writePngText } from "./png";

/** 1×1 透明 PNG。 */
const PNG = base64ToBytes(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
);
const json = (v: unknown) => strToU8(JSON.stringify(v));

function sampleCard(): QuireCard {
  return {
    spec: QUIRE_CARD_SPEC,
    spec_version: QUIRE_CARD_VERSION,
    data: {
      kind: "notebook",
      name: "银河帝国笔记",
      summary: "阿西莫夫的设定整理",
      creator: "Mar",
      creator_notes: "",
      version: "1.0",
      tags: ["科幻"],
      created_at: 0,
      modified_at: 0,
      source: [],
      notes: [
        { id: "n1", title: "心理史学", markdown: "# 心理史学\n\n【概念：心理史学】", tags: [], kind: "note" },
      ],
      sources: [],
      ai_instructions: "用研究助理的口吻回答。",
      lorebook: {
        name: "设定",
        description: "",
        enabled: true,
        scan_depth: 4,
        token_budget: 2000,
        recursive: false,
        max_recursion: 3,
        case_sensitive: false,
        match_whole_words: false,
        extensions: {},
        entries: [],
      },
      assets: [],
      extensions: {},
    },
  };
}

describe("Quire 卡", () => {
  it("PNG 往返：写进 quire 块再读出，封面作为资源", () => {
    const card = sampleCard();
    const png = cardToPng(PNG, card);
    const parsed = parseCardFile(png, "x.png");
    expect(parsed.format).toBe("quire-png");
    expect(parsed.card.data.name).toBe("银河帝国笔记");
    expect(parsed.card.data.notes[0]!.markdown).toContain("【概念：心理史学】");
    expect(parsed.card.data.assets.find((a) => a.type === "cover")?.uri).toBe("embedded://cover.png");
    expect(parsed.files.get("cover.png")).toEqual(png);
  });

  it("重复写入只保留一个 quire 块", () => {
    const a = sampleCard();
    const b = { ...sampleCard(), data: { ...sampleCard().data, name: "第二版" } };
    const png = cardToPng(cardToPng(PNG, a), b);
    expect(readPngText(png).get("quire")).toBe(encodeJsonBase64(b));
    expect(parseCardFile(png).card.data.name).toBe("第二版");
  });

  it("没有卡片数据的 PNG 给出可读的错误码", () => {
    expect(() => parseCardFile(PNG, "a.png")).toThrowError(CardError);
    try {
      parseCardFile(PNG, "a.png", { lang: "en" });
    } catch (e) {
      expect((e as CardError).code).toBe("no_card_data");
      expect((e as CardError).message).toMatch(/no card data/i);
    }
  });

  it("JSON 与 .quire 压缩包", () => {
    const card = sampleCard();
    expect(parseCardFile(json(card), "a.quire.json").format).toBe("quire-json");
    card.data.assets.push({
      id: "pic.png",
      type: "image",
      name: "pic.png",
      mime: "image/png",
      uri: "embedded://assets/pic.png",
    });
    const zip = cardToZip(card, new Map([["assets/pic.png", PNG]]));
    const parsed = parseCardFile(zip, "a.quire");
    expect(parsed.format).toBe("quire-zip");
    expect(parsed.files.get("assets/pic.png")).toEqual(PNG);
  });

  it("拒绝不安全的压缩包、缺 card.json、无效 JSON 和认不出的 JSON", () => {
    const evil = zipSync({ "card.json": json(sampleCard()), "../evil.txt": strToU8("x") });
    expect(() => parseCardFile(evil)).toThrowError(/不安全/);
    expect(() => parseCardFile(zipSync({ "a.txt": strToU8("x") }))).toThrowError(/card\.json/);
    expect(() => parseCardFile(strToU8("{oops"))).toThrowError(/JSON/);
    try {
      parseCardFile(json({ hello: 1 }));
    } catch (e) {
      expect((e as CardError).code).toBe("unknown_format");
    }
  });

  it("不符合规格的 Quire 卡指出字段", () => {
    const bad = { ...sampleCard(), data: { ...sampleCard().data, name: "" } };
    expect(() => parseCardFile(json(bad))).toThrowError(/data\.name/);
  });
});

describe("插件导入器", () => {
  it("本体认不出的格式交给导入器，并记下是哪个插件转换的", () => {
    const importer = {
      id: "demo",
      fromJson: (v: unknown) =>
        (v as { demo?: string }).demo
          ? { format: "demo-json", card: sampleCard(), warnings: ["来自插件"] }
          : null,
    };
    expect(() => parseCardFile(json({ demo: "x" }))).toThrowError(CardError);
    const parsed = parseCardFile(json({ demo: "x" }), "a.json", { importers: [importer] });
    expect(parsed).toMatchObject({ format: "demo-json", importer: "demo", warnings: ["来自插件"] });
    expect(parseCardFile(json(sampleCard()), "a.json", { importers: [importer] }).importer).toBeNull();
  });

  it("PNG 里没有 quire 块时问导入器，结果自动带上封面", () => {
    const importer = {
      id: "demo",
      fromPngText: (t: Map<string, string>) =>
        t.has("demo") ? { format: "demo-png", card: sampleCard(), warnings: [] } : null,
    };
    const png = writePngText(PNG, "demo", "1");
    const parsed = parseCardFile(png, "a.png", { importers: [importer] });
    expect(parsed.importer).toBe("demo");
    expect(parsed.card.data.assets.some((a) => a.type === "cover")).toBe(true);
  });
});
