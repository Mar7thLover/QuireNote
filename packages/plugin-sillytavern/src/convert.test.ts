import { base64ToBytes, encodeJsonBase64, parseCardFile, writePngText } from "@quirenote/card";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { lorebookToWorldInfo, parseRegexString, worldInfoToCard } from "./convert";
import { sillytavernImporter } from "./importer";

/** 1×1 透明 PNG。 */
const PNG = base64ToBytes(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
);
const json = (v: unknown) => strToU8(JSON.stringify(v));
const importers = [sillytavernImporter];
const parse = (bytes: Uint8Array, name = "", lang?: string) =>
  parseCardFile(bytes, name, { importers, ...(lang ? { lang } : {}) });

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

describe("酒馆角色卡", () => {
  it("V2 JSON → Notebook：角色设定、开场白、知识书、AI 说明、正则规则", () => {
    const { format, card, warnings } = parse(json(V2_CARD), "Seraphina.json", "zh");
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
    const { card, warnings } = parse(json(V2_CARD), "Seraphina.json", "en");
    expect(card.data.notes[0]!.title).toBe("Seraphina · Character");
    expect(card.data.notes[0]!.markdown).toContain("## Description");
    expect(card.data.notes[0]!.markdown).toContain("talks to you kindly");
    expect(card.data.creator_notes).toBe("english notes");
    expect(warnings.some((w) => /display/.test(w))).toBe(true);
  });

  it("PNG：ccv3 优先，只有 chara 时按 V2 读取", () => {
    const v3 = { ...V2_CARD, spec: "chara_card_v3", data: { ...V2_CARD.data, name: "V3 名" } };
    let png = writePngText(PNG, "chara", encodeJsonBase64(V2_CARD));
    const v2 = parse(png, "a.png");
    expect(v2.format).toBe("st-card-png");
    expect(v2.card.data.name).toBe("Seraphina");
    expect(v2.card.data.assets.some((a) => a.type === "cover")).toBe(true);
    png = writePngText(png, "ccv3", encodeJsonBase64(v3));
    const parsed = parse(png, "a.png");
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
    const parsed = parse(zip, "s.charx");
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
    const { format, card, warnings } = parse(json(WORLD), "Terminus.json");
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
    const book = parse(json(WORLD)).card.data.lorebook!;
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
    const { format, card, warnings } = parse(json(scripts), "styles.json");
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
