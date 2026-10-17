import { QUIRE_CARD_SPEC, QUIRE_CARD_VERSION, type QuireCard } from "@quirenote/core";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { CardError, cardToPng, cardToZip, parseCardFile } from "./parse";
import { base64ToBytes, encodeJsonBase64, readPngText, writePngText } from "./png";
import { lorebookToWorldInfo, parseRegexString, worldInfoToCard } from "./sillytavern";

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

const V2_CARD = {
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "Seraphina",
    description: "{{char}} is a guardian of the forest. She talks to {{user}} kindly.",
    personality: "gentle",
    scenario: "",
    first_mes: "Hello, {{user}}.",
    mes_example: "",
    creator_notes: "default notes",
    creator_notes_multilingual: { en: "english notes", zh: "中文说明" },
    system_prompt: "You are {{char}}.",
    post_history_instructions: "Stay in character.",
    alternate_greetings: ["Hi again."],
    tags: ["fantasy"],
    creator: "someone",
    character_version: "3",
    extensions: {
      depth_prompt: { prompt: "{{char}} is tired.", depth: 2, role: "system" },
      regex_scripts: [
        {
          scriptName: "Bold stars",
          findRegex: "/\\*\\*(.+?)\\*\\*/g",
          replaceString: "<b>$1</b>",
          placement: [2],
          markdownOnly: true,
          promptOnly: false,
          disabled: false,
        },
        {
          scriptName: "Prompt rewrite",
          findRegex: "/foo/g",
          replaceString: "bar",
          placement: [1, 2],
          markdownOnly: false,
          promptOnly: false,
        },
      ],
    },
    character_book: {
      name: "Forest lore",
      scan_depth: 6,
      token_budget: 500,
      recursive_scanning: true,
      entries: [
        {
          id: 7,
          keys: ["glade"],
          secondary_keys: ["night"],
          content: "{{char}} guards the glade.",
          enabled: true,
          insertion_order: 20,
          selective: true,
          constant: false,
          position: "after_char",
          extensions: {
            selectiveLogic: 3,
            position: 4,
            depth: 3,
            role: 1,
            probability: 50,
            useProbability: true,
          },
        },
        {
          id: 8,
          keys: ["sea"],
          content: "outlet text",
          enabled: true,
          insertion_order: 30,
          extensions: { position: 7 },
        },
      ],
    },
  },
};

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

describe("酒馆角色卡", () => {
  it("V2 JSON → Notebook：角色设定、开场白、知识书、AI 说明、正则规则", () => {
    const { format, card, warnings } = parseCardFile(json(V2_CARD), "Seraphina.json", { lang: "zh" });
    expect(format).toBe("st-card-json");
    const d = card.data;
    expect(d.kind).toBe("notebook");
    expect(d.name).toBe("Seraphina");
    expect(d.creator_notes).toBe("中文说明");
    expect(d.notes.map((n) => n.title)).toEqual(["Seraphina · 角色设定", "Seraphina · 开场白与示例对话"]);
    // {{char}} → 名字，{{user}} → 你
    expect(d.notes[0]!.markdown).toContain("Seraphina is a guardian");
    expect(d.notes[0]!.markdown).toContain("talks to 你 kindly");
    expect(d.notes[1]!.markdown).toContain("## 其他开场白");
    expect(d.ai_instructions).toBe("You are Seraphina.");

    const entries = d.lorebook!.entries;
    const byId = Object.fromEntries(entries.map((e) => [e.id, e]));
    expect(byId.st_char).toMatchObject({ constant: true, position: "before_sources", order: 0 });
    expect(byId.st_phi).toMatchObject({
      constant: true,
      position: "at_depth",
      depth: 0,
      content: "Stay in character.",
    });
    expect(byId.st_depth).toMatchObject({ position: "at_depth", depth: 2, content: "Seraphina is tired." });
    expect(byId.st_7).toMatchObject({
      keys: ["glade"],
      secondary_keys: ["night"],
      logic: "and_all",
      position: "at_depth",
      depth: 3,
      role: "user",
      probability: 50,
      order: 20,
      content: "Seraphina guards the glade.",
    });
    expect(byId.st_8!.enabled).toBe(false);
    expect(d.lorebook).toMatchObject({
      name: "Forest lore",
      scan_depth: 6,
      token_budget: 500,
      recursive: true,
    });

    const rules = d.render!.rules;
    expect(rules).toHaveLength(2);
    expect(rules[0]).toMatchObject({
      name: "Bold stars",
      enabled: true,
      flags: "g",
      scopes: ["chat", "note"],
    });
    expect(d.render!.templates[0]!.html).toBe("<b>{{g1}}</b>");
    expect(rules[0]!.slots).toEqual({ "1": "g1" });
    expect(rules[1]!.enabled).toBe(false);
    expect(warnings.some((w) => w.includes("outlet"))).toBe(true);
    expect(warnings.some((w) => w.includes("只改显示"))).toBe(true);
    // 原始数据完整保留
    expect(d.extensions.sillytavern).toEqual(V2_CARD);
  });

  it("英文界面导入时生成英文标题和警告", () => {
    const { card, warnings } = parseCardFile(json(V2_CARD), "Seraphina.json", { lang: "en" });
    expect(card.data.notes[0]!.title).toBe("Seraphina · Character");
    expect(card.data.notes[0]!.markdown).toContain("## Description");
    expect(card.data.notes[0]!.markdown).toContain("talks to you kindly");
    expect(card.data.creator_notes).toBe("english notes");
    expect(warnings.some((w) => /display/.test(w))).toBe(true);
  });

  it("PNG：ccv3 优先，只有 chara 时按 V2 读取", () => {
    const v3 = { ...V2_CARD, spec: "chara_card_v3", data: { ...V2_CARD.data, name: "V3 名" } };
    let png = writePngText(PNG, "chara", encodeJsonBase64(V2_CARD));
    const v2 = parseCardFile(png, "a.png");
    expect(v2.format).toBe("st-card-png");
    expect(v2.card.data.name).toBe("Seraphina");
    expect(v2.card.data.assets.some((a) => a.type === "cover")).toBe(true);
    png = writePngText(png, "ccv3", encodeJsonBase64(v3));
    const parsed = parseCardFile(png, "a.png");
    expect(parsed.card.data.name).toBe("V3 名");
  });

  it("CHARX：card.json + embeded:// 资源，主图标作为封面", () => {
    const card = {
      ...V2_CARD,
      spec: "chara_card_v3",
      data: {
        ...V2_CARD.data,
        assets: [
          { type: "icon", uri: "embeded://assets/icon/main.png", name: "main", ext: "png" },
          { type: "emotion", uri: "embeded://assets/emotion/happy.png", name: "happy", ext: "png" },
        ],
      },
    };
    const zip = zipSync({
      "card.json": json(card),
      "assets/icon/main.png": PNG,
      "assets/emotion/happy.png": PNG,
    });
    const parsed = parseCardFile(zip, "s.charx");
    expect(parsed.format).toBe("st-charx");
    const assets = parsed.card.data.assets;
    expect(assets.find((a) => a.type === "cover")?.uri).toBe("embedded://assets/icon/main.png");
    expect(assets.find((a) => a.name === "happy.png")?.type).toBe("image");
    expect(parsed.files.has("assets/emotion/happy.png")).toBe(true);
  });
});

describe("酒馆世界书与正则脚本", () => {
  const WORLD = {
    name: "Terminus",
    entries: {
      "0": {
        uid: 0,
        key: ["Terminus", "端点星"],
        keysecondary: ["Foundation"],
        selective: true,
        selectiveLogic: 2,
        comment: "端点星",
        content: "端点星位于银河边缘。",
        constant: false,
        order: 50,
        position: 4,
        depth: 2,
        role: 2,
        disable: false,
        probability: 100,
        useProbability: true,
        group: "planets",
        groupWeight: 30,
        sticky: 2,
        cooldown: 1,
        delay: 3,
        scanDepth: 8,
        caseSensitive: true,
        matchWholeWords: null,
      },
      "1": { uid: 1, key: ["x"], content: "outlet", position: 7, comment: "" },
      "2": { uid: 2, key: ["v"], content: "vec", vectorized: true, disable: true },
    },
  };

  it("world info JSON → 知识书，字段一一对应", () => {
    const { format, card, warnings } = parseCardFile(json(WORLD), "Terminus.json");
    expect(format).toBe("st-worldinfo");
    expect(card.data.name).toBe("Terminus");
    const [a, b, c] = card.data.lorebook!.entries;
    expect(a).toMatchObject({
      id: "st_0",
      name: "端点星",
      keys: ["Terminus", "端点星"],
      secondary_keys: ["Foundation"],
      logic: "not_any",
      position: "at_depth",
      depth: 2,
      role: "assistant",
      group: "planets",
      group_weight: 30,
      sticky: 2,
      cooldown: 1,
      delay: 3,
      scan_depth: 8,
      case_sensitive: true,
      match_whole_words: null,
      order: 50,
    });
    expect(b!.enabled).toBe(false);
    expect(c!.enabled).toBe(false);
    expect(warnings).toHaveLength(2);
  });

  it("导出回世界书再导入，关键字段不变", () => {
    const book = parseCardFile(json(WORLD)).card.data.lorebook!;
    const again = worldInfoToCard(lorebookToWorldInfo(book)).card.data.lorebook!;
    const pick = (e: (typeof book.entries)[number]) => [
      e.keys,
      e.secondary_keys,
      e.logic,
      e.content,
      e.position,
      e.depth,
      e.role,
      e.enabled,
    ];
    expect(again.entries.map(pick)).toEqual(book.entries.map(pick));
  });

  it("正则脚本 JSON → 渲染规则；{{match}} 变成整段匹配", () => {
    const scripts = [
      {
        scriptName: "Quote",
        findRegex: "/「(.+?)」/gu",
        replaceString: '<q class="x">{{match}}</q>',
        placement: [2],
        markdownOnly: true,
      },
      {
        scriptName: "Strip",
        findRegex: "/\\s+$/m",
        replaceString: "",
        placement: [5],
        markdownOnly: true,
        trimStrings: ["a"],
      },
    ];
    const { format, card, warnings } = parseCardFile(json(scripts), "styles.json");
    expect(format).toBe("st-regex");
    expect(card.data.name).toBe("styles");
    const [q, s] = card.data.render!.rules;
    expect(q).toMatchObject({ pattern: "「(.+?)」", flags: "gu", enabled: true, slots: { "0": "match" } });
    expect(card.data.render!.templates[0]!.html).toBe('<q class="x">{{match}}</q>');
    expect(s!.scopes).toEqual(["lorebook"]);
    expect(warnings.some((w) => w.includes("trimStrings"))).toBe(true);
  });

  it("parseRegexString 只保留 JS 支持的标志", () => {
    expect(parseRegexString("/a+/gisx")).toEqual({ pattern: "a+", flags: "gis" });
    expect(parseRegexString("plain")).toEqual({ pattern: "plain", flags: "g" });
  });
});
