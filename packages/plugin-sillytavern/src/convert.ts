/**
 * 酒馆（SillyTavern）格式 → Quire 卡；知识书 → 酒馆世界书。字段对应见 docs/CARD_SPEC.md「与酒馆的兼容」。
 * 原始数据完整保存在 extensions.sillytavern，再导出回酒馆时不丢。
 */

import type { ConvertOptions } from "@quirenote/card";
import {
  type CardLorebook,
  type CardLoreEntry,
  CardLoreEntry as CardLoreEntrySchema,
  type CardTemplate,
  DEFAULT_LOREBOOK,
  type LoreLogic,
  type LorePosition,
  type LoreRole,
  QUIRE_CARD_SPEC,
  QUIRE_CARD_VERSION,
  type QuireCard,
  type QuireCardData,
  type RenderRule,
} from "@quirenote/core";
import { stMessages } from "./messages";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const strs = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "")
    : typeof v === "string"
      ? v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

/** 短而稳定的哈希（FNV-1a），用来生成导入条目的 id。 */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

const LOGIC: LoreLogic[] = ["and_any", "not_all", "not_any", "and_all"];
const ROLES: LoreRole[] = ["system", "user", "assistant"];

// ───────────── 角色卡 ─────────────

export function isCharacterCard(v: unknown): v is Obj {
  if (!isObj(v)) return false;
  if (v.spec === "chara_card_v2" || v.spec === "chara_card_v3") return isObj(v.data);
  // V1：扁平字段
  return typeof v.name === "string" && ("first_mes" in v || "description" in v) && !("entries" in v);
}

function cardData(v: Obj): Obj {
  return isObj(v.data) && (v.spec === "chara_card_v2" || v.spec === "chara_card_v3") ? v.data : v;
}

/** {{char}} / {{user}} 等宏：角色名、「你」；其余宏原样保留。 */
function macros(text: string, name: string, you: string): string {
  return text
    .replace(/\{\{char\}\}|<BOT>|<CHAR>/gi, name)
    .replace(/\{\{user\}\}|<USER>/gi, you)
    .replace(/\r\n/g, "\n");
}

function section(title: string, body: string): string {
  return body.trim() ? `## ${title}\n\n${body.trim()}\n` : "";
}

/** 转换结果（来源格式由导入器补上）。 */
export interface StConverted {
  card: QuireCard;
  warnings: string[];
}

export function characterToCard(raw: Obj, opts: ConvertOptions = {}): StConverted {
  const M = stMessages(opts.lang);
  const d = cardData(raw);
  const warnings: string[] = [];
  const realName = str(d.name).trim() || M.unnamedCharacter;
  const name = str(d.nickname).trim() || realName;
  const m = (s: unknown) => macros(str(s), name, M.you);

  const settings = [
    section(M.description, m(d.description)),
    section(M.personality, m(d.personality)),
    section(M.scenario, m(d.scenario)),
  ]
    .filter(Boolean)
    .join("\n");
  const greetings = strs(d.alternate_greetings);
  const groupGreetings = strs(d.group_only_greetings);
  const openers = [
    section(M.firstMessage, m(d.first_mes)),
    greetings.length
      ? `## ${M.altGreetings}\n\n${greetings.map((g, i) => `### ${i + 1}\n\n${m(g).trim()}`).join("\n\n")}\n`
      : "",
    groupGreetings.length
      ? `## ${M.groupGreetings}\n\n${groupGreetings.map((g, i) => `### ${i + 1}\n\n${m(g).trim()}`).join("\n\n")}\n`
      : "",
    section(M.examples, m(d.mes_example)),
  ]
    .filter(Boolean)
    .join("\n");

  const notes: QuireCardData["notes"] = [];
  if (settings)
    notes.push({
      id: "st_settings",
      title: M.settingsNote(name),
      markdown: settings,
      tags: [],
      kind: "note",
    });
  if (openers)
    notes.push({ id: "st_openers", title: M.openersNote(name), markdown: openers, tags: [], kind: "note" });
  if (realName !== name && notes[0]) notes[0].markdown = `${M.realName(realName)}\n\n${notes[0].markdown}`;

  // 知识书：角色书 + 角色设定（常驻） + 历史后指令与深度提示词
  const book: CardLorebook = isObj(d.character_book)
    ? characterBookToLorebook(d.character_book, name, warnings, opts.lang)
    : { ...DEFAULT_LOREBOOK, name: M.bookName(name), entries: [] };
  const extra: CardLoreEntry[] = [];
  const defs = [m(d.description), m(d.personality), m(d.scenario)].filter((s) => s.trim()).join("\n\n");
  if (defs)
    extra.push(
      entry({
        id: "st_char",
        name: M.charEntry(name),
        content: defs,
        constant: true,
        order: 0,
        position: "before_sources",
      }),
    );
  const phi = m(d.post_history_instructions).trim();
  if (phi)
    extra.push(
      entry({
        id: "st_phi",
        name: M.postHistory,
        content: phi,
        constant: true,
        position: "at_depth",
        depth: 0,
        role: "system",
      }),
    );
  const ext = isObj(d.extensions) ? d.extensions : {};
  const dp = isObj(ext.depth_prompt) ? ext.depth_prompt : null;
  if (dp && str(dp.prompt).trim())
    extra.push(
      entry({
        id: "st_depth",
        name: M.depthPrompt,
        content: m(dp.prompt).trim(),
        constant: true,
        position: "at_depth",
        depth: num(dp.depth) ?? 4,
        role: (["system", "user", "assistant"] as const).find((r) => r === dp.role) ?? "system",
      }),
    );
  book.entries = [...extra, ...book.entries];

  const regex = Array.isArray(ext.regex_scripts)
    ? regexScriptsToRender(ext.regex_scripts, warnings, opts.lang)
    : null;

  const multi = isObj(d.creator_notes_multilingual) ? d.creator_notes_multilingual : null;
  const lang = (opts.lang ?? "zh").slice(0, 2);
  const creatorNotes = str(multi?.[lang]) || str(d.creator_notes);

  const unknownMacros = new Set(
    [d.description, d.personality, d.scenario, d.first_mes, d.mes_example, d.system_prompt]
      .flatMap((s) => str(s).match(/\{\{[^}]+\}\}/g) ?? [])
      .filter((x) => !/^\{\{(char|user)\}\}$/i.test(x)),
  );
  if (unknownMacros.size) warnings.push(M.unknownMacros([...unknownMacros].slice(0, 8)));

  const data: QuireCardData = {
    kind: "notebook",
    name,
    summary: m(d.description).replace(/\s+/g, " ").trim().slice(0, 140),
    creator: str(d.creator),
    creator_notes: creatorNotes,
    version: str(d.character_version),
    tags: strs(d.tags).slice(0, 100),
    created_at: num(d.creation_date) ?? 0,
    modified_at: num(d.modification_date) ?? 0,
    source: strs(d.source),
    notebook: {
      title: name,
      description: m(d.description).replace(/\s+/g, " ").trim().slice(0, 200),
      icon: "🎭",
      color: "rose",
    },
    notes,
    sources: [],
    ai_instructions: m(d.system_prompt).trim(),
    ...(regex && (regex.rules.length || regex.templates.length)
      ? { render: { rules: regex.rules, templates: regex.templates } }
      : {}),
    lorebook: book.entries.length ? book : undefined,
    assets: [],
    extensions: { sillytavern: raw },
  };
  return { card: { spec: QUIRE_CARD_SPEC, spec_version: QUIRE_CARD_VERSION, data }, warnings };
}

function entry(partial: Partial<CardLoreEntry> & { id: string }): CardLoreEntry {
  return CardLoreEntrySchema.parse(partial);
}

// ───────────── 知识书 ─────────────

/** V3 修饰符：content 开头的 `@@xxx` 行。识别的转成字段，其余丢弃（原文在扩展里）。 */
function applyDecorators(e: CardLoreEntry): CardLoreEntry {
  const lines = e.content.split("\n");
  let i = 0;
  const out = { ...e };
  for (; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line.startsWith("@@")) break;
    const [nameRaw, ...rest] = line.replace(/^@@@?/, "").split(/\s+/);
    const arg = rest.join(" ");
    const n = Number(arg);
    switch (nameRaw) {
      case "depth":
        if (Number.isFinite(n)) Object.assign(out, { position: "at_depth", depth: n });
        break;
      case "role":
        if (["system", "user", "assistant"].includes(arg)) out.role = arg as LoreRole;
        break;
      case "activate_only_after":
        if (Number.isFinite(n)) out.delay = n;
        break;
      case "scan_depth":
        if (Number.isFinite(n)) out.scan_depth = n;
        break;
      case "activate":
        out.constant = true;
        break;
      case "dont_activate":
        out.enabled = false;
        break;
      case "additional_keys":
        out.secondary_keys = [...out.secondary_keys, ...strs(arg)];
        out.logic = "and_any";
        break;
      case "exclude_keys":
        if (!out.secondary_keys.length) {
          out.secondary_keys = strs(arg);
          out.logic = "not_any";
        }
        break;
      case "position":
        out.position = "before_sources";
        break;
      default:
        break;
    }
  }
  out.content = lines.slice(i).join("\n").trim();
  return out;
}

const POSITION: Record<number, { position: LorePosition; depth?: number }> = {
  0: { position: "before_sources" },
  1: { position: "after_sources" },
  2: { position: "at_depth", depth: 4 },
  3: { position: "at_depth", depth: 4 },
  4: { position: "at_depth" },
  5: { position: "before_sources" },
  6: { position: "before_sources" },
};

/** 正则键：酒馆世界书写成 `/p/f`；角色书用 use_regex 标记整组键。 */
function regexKeys(keys: string[], useRegex: boolean): string[] {
  if (!useRegex) return keys;
  return keys.map((k) => (/^\/.+\/[a-z]*$/s.test(k) ? k : `/${k}/`));
}

/** 酒馆世界书条目（world info JSON 的 entries[uid]）→ 知识书条目。 */
export function worldInfoEntryToLore(e: Obj, fallbackId: string, lang?: string): CardLoreEntry {
  const posNum = num(e.position) ?? 0;
  const pos = POSITION[posNum];
  const outlet = posNum === 7;
  const selective = bool(e.selective) ?? true;
  const role = num(e.role);
  const base: Partial<CardLoreEntry> & { id: string } = {
    id: `st_${String(e.uid ?? fallbackId)}`,
    name: str(e.comment).slice(0, 200),
    keys: strs(e.key),
    secondary_keys: selective ? strs(e.keysecondary) : [],
    logic: LOGIC[num(e.selectiveLogic) ?? 0] ?? "and_any",
    content: str(e.content),
    constant: bool(e.constant) ?? false,
    enabled: !(bool(e.disable) ?? false) && !outlet,
    order: num(e.order) ?? 100,
    position: pos?.position ?? "after_sources",
    depth: pos?.depth ?? num(e.depth) ?? 4,
    role: (role !== null ? ROLES[role] : undefined) ?? "system",
    probability: (bool(e.useProbability) ?? true) ? (num(e.probability) ?? 100) : 100,
    group: str(e.group),
    group_weight: num(e.groupWeight) ?? 100,
    sticky: num(e.sticky),
    cooldown: num(e.cooldown),
    delay: num(e.delay),
    prevent_recursion: bool(e.preventRecursion) ?? false,
    exclude_recursion: bool(e.excludeRecursion) ?? false,
    scan_depth: num(e.scanDepth),
    case_sensitive: bool(e.caseSensitive),
    match_whole_words: bool(e.matchWholeWords),
    comment: outlet ? stMessages(lang).outletComment : "",
    extensions: { sillytavern: e },
  };
  return applyDecorators(entry(base));
}

/** 角色卡里的 character_book → 知识书。 */
export function characterBookToLorebook(
  book: Obj,
  charName: string,
  warnings: string[] = [],
  lang?: string,
): CardLorebook {
  const M = stMessages(lang);
  const entries = Array.isArray(book.entries) ? book.entries.filter(isObj) : [];
  const out: CardLoreEntry[] = entries.map((e, i) => {
    const x = isObj(e.extensions) ? e.extensions : {};
    const extPos = num(x.position);
    const pos =
      extPos !== null
        ? POSITION[extPos]
        : { position: (e.position === "before_char" ? "before_sources" : "after_sources") as LorePosition };
    const role = num(x.role);
    const selective = bool(e.selective) ?? false;
    return applyDecorators(
      entry({
        id: `st_${String(e.id ?? i)}`,
        name: str(e.name) || str(e.comment),
        keys: regexKeys(strs(e.keys), bool(e.use_regex) ?? false),
        secondary_keys: selective ? regexKeys(strs(e.secondary_keys), bool(e.use_regex) ?? false) : [],
        logic: LOGIC[num(x.selectiveLogic) ?? 0] ?? "and_any",
        content: macros(str(e.content), charName, M.you),
        constant: bool(e.constant) ?? false,
        enabled: (bool(e.enabled) ?? true) && extPos !== 7,
        comment: extPos === 7 ? M.outletComment : str(e.comment),
        order: num(e.insertion_order) ?? 100,
        priority: num(e.priority) ?? 100,
        position: pos?.position ?? "after_sources",
        depth: pos?.depth ?? num(x.depth) ?? 4,
        role: (role !== null ? ROLES[role] : undefined) ?? "system",
        probability: (bool(x.useProbability) ?? true) ? (num(x.probability) ?? 100) : 100,
        group: str(x.group),
        group_weight: num(x.group_weight) ?? 100,
        sticky: num(x.sticky),
        cooldown: num(x.cooldown),
        delay: num(x.delay),
        prevent_recursion: bool(x.prevent_recursion) ?? false,
        exclude_recursion: bool(x.exclude_recursion) ?? false,
        scan_depth: num(x.scan_depth),
        case_sensitive: bool(e.case_sensitive) ?? bool(x.case_sensitive),
        match_whole_words: bool(x.match_whole_words),
        extensions: { sillytavern: e },
      }),
    );
  });
  if (out.some((e) => e.comment === M.outletComment)) warnings.push(M.outletWarning);
  return {
    ...DEFAULT_LOREBOOK,
    name: str(book.name) || M.bookName(charName),
    description: str(book.description),
    scan_depth: num(book.scan_depth) ?? DEFAULT_LOREBOOK.scan_depth,
    token_budget: num(book.token_budget) ?? DEFAULT_LOREBOOK.token_budget,
    recursive: bool(book.recursive_scanning) ?? false,
    extensions: { sillytavern: { ...book, entries: undefined } },
    entries: out,
  };
}

export function isWorldInfo(v: unknown): v is Obj {
  return isObj(v) && (isObj(v.entries) || (Array.isArray(v.entries) && !("spec" in v)));
}

/** 独立世界书 JSON（entries 以 uid 为键，或数组）→ 只含知识书的卡。 */
export function worldInfoToCard(raw: Obj, opts: ConvertOptions = {}): StConverted {
  const M = stMessages(opts.lang);
  const warnings: string[] = [];
  const name = str(raw.name) || (opts.filename || M.worldInfo).replace(/\.(json|lorebook)$/i, "");
  const entries: CardLoreEntry[] = Array.isArray(raw.entries)
    ? characterBookToLorebook(raw, name, warnings, opts.lang).entries
    : Object.entries(raw.entries as Obj)
        .filter(([, e]) => isObj(e))
        .map(([uid, e]) => worldInfoEntryToLore(e as Obj, uid, opts.lang));
  if (!Array.isArray(raw.entries) && entries.some((e) => e.comment === M.outletComment))
    warnings.push(M.outletWarning);
  if (entries.some((e) => isObj(e.extensions.sillytavern) && (e.extensions.sillytavern as Obj).vectorized))
    warnings.push(M.vectorized);
  const book: CardLorebook = {
    ...DEFAULT_LOREBOOK,
    name,
    description: str(raw.description),
    extensions: { sillytavern: { ...raw, entries: undefined } },
    entries,
  };
  return {
    card: {
      spec: QUIRE_CARD_SPEC,
      spec_version: QUIRE_CARD_VERSION,
      data: {
        kind: "notebook",
        name,
        summary: M.worldInfoSummary(entries.length),
        creator: "",
        creator_notes: "",
        version: "",
        tags: [],
        created_at: 0,
        modified_at: 0,
        source: [],
        notes: [],
        sources: [],
        ai_instructions: "",
        lorebook: book,
        assets: [],
        extensions: {},
      },
    },
    warnings,
  };
}

/** 知识书 → 酒馆世界书 JSON（导入时保存的原始字段优先保留）。 */
export function lorebookToWorldInfo(book: CardLorebook): Obj {
  const entries: Obj = {};
  book.entries.forEach((e, uid) => {
    const orig = isObj(e.extensions.sillytavern) ? (e.extensions.sillytavern as Obj) : {};
    const position = e.position === "before_sources" ? 0 : e.position === "after_sources" ? 1 : 4;
    entries[String(uid)] = {
      ...orig,
      uid,
      key: e.keys,
      keysecondary: e.secondary_keys,
      comment: e.name || e.comment,
      content: e.content,
      constant: e.constant,
      selective: e.secondary_keys.length > 0,
      selectiveLogic: LOGIC.indexOf(e.logic),
      order: e.order,
      position,
      disable: !e.enabled,
      depth: e.depth,
      role: ROLES.indexOf(e.role),
      probability: e.probability,
      useProbability: e.probability < 100,
      group: e.group,
      groupWeight: e.group_weight,
      preventRecursion: e.prevent_recursion,
      excludeRecursion: e.exclude_recursion,
      sticky: e.sticky,
      cooldown: e.cooldown,
      delay: e.delay,
      scanDepth: e.scan_depth,
      caseSensitive: e.case_sensitive,
      matchWholeWords: e.match_whole_words,
      displayIndex: uid,
    };
  });
  return { name: book.name, description: book.description, entries };
}

// ───────────── 正则脚本 ─────────────

export function isRegexScripts(v: unknown): boolean {
  const list = Array.isArray(v) ? v : [v];
  return list.length > 0 && list.every((x) => isObj(x) && typeof x.findRegex === "string");
}

/** `/pattern/flags` → pattern + flags（只保留 JS 支持的标志）。 */
export function parseRegexString(s: string): { pattern: string; flags: string } {
  const m = /^\/([\s\S]+)\/([a-z]*)$/.exec(s.trim());
  if (!m) return { pattern: s, flags: "g" };
  const flags = [...new Set(m[2]!.split("").filter((f) => "dgimsuy".includes(f)))].join("");
  return { pattern: m[1]!, flags: flags || "g" };
}

const HTML_RE = /<\s*[a-z][\s\S]*>/i;

/** 酒馆正则脚本 → 渲染规则；含 HTML 的替换串变成卡片模板，捕获组变成模板变量。 */
export function regexScriptsToRender(
  scripts: unknown[],
  warnings: string[] = [],
  lang?: string,
): { rules: RenderRule[]; templates: CardTemplate[] } {
  const M = stMessages(lang);
  const rules: RenderRule[] = [];
  const templates: CardTemplate[] = [];
  let unsupported = 0;
  let trimmed = 0;
  let scripted = 0;
  scripts.filter(isObj).forEach((s, i) => {
    const name = str(s.scriptName) || M.regexScript(i + 1);
    const { pattern, flags } = parseRegexString(str(s.findRegex));
    if (!pattern) return;
    const placement = Array.isArray(s.placement) ? s.placement.map(Number) : [2];
    const scopes: RenderRule["scopes"] = [];
    if (placement.includes(1) || placement.includes(2)) scopes.push("chat", "note");
    if (placement.includes(5)) scopes.push("lorebook");
    if (!scopes.length) scopes.push("chat", "note");
    const displayOnly = bool(s.markdownOnly) === true && bool(s.promptOnly) !== true;
    if (!displayOnly) unsupported++;
    if (strs(s.trimStrings).length) trimmed++;
    const id = `st_regex_${hash(`${name}\u0000${pattern}`)}`;
    const replacement = str(s.replaceString).replace(/\{\{match\}\}/gi, () => "$&");
    let templateId: string | null = null;
    const slots: Record<string, string> = {};
    if (HTML_RE.test(replacement)) {
      if (/<\s*script/i.test(replacement)) scripted++;
      templateId = `${id}_tpl`;
      const html = replacement
        .replace(/\$<([A-Za-z_][\w]*)>/g, (_, n: string) => `{{${n}}}`)
        .replace(/\$&/g, () => {
          slots["0"] = "match";
          return "{{match}}";
        })
        .replace(/\$(\d{1,2})/g, (_, d: string) => {
          slots[d] = `g${d}`;
          return `{{g${d}}}`;
        });
      templates.push({
        id: templateId,
        name,
        description: M.fromRegex,
        html,
        css: "",
        slots: Object.values(slots).map((v) => ({ name: v, sample: "" })),
        builtin: false,
      });
    }
    rules.push({
      id,
      name,
      enabled: displayOnly && !(bool(s.disabled) ?? false),
      pattern,
      flags,
      templateId,
      replacement: templateId ? "" : replacement,
      slots,
      scopes,
      order: 1000 + i,
    });
  });
  if (unsupported) warnings.push(M.promptRegex(unsupported));
  if (trimmed) warnings.push(M.trimStrings(trimmed));
  if (scripted) warnings.push(M.scripted(scripted));
  return { rules, templates };
}

export function regexToCard(raw: unknown, opts: ConvertOptions = {}): StConverted {
  const M = stMessages(opts.lang);
  const warnings: string[] = [];
  const list = (Array.isArray(raw) ? raw : [raw]) as unknown[];
  const render = regexScriptsToRender(list, warnings, opts.lang);
  const name = (opts.filename || M.regexScripts).replace(/\.json$/i, "");
  return {
    card: {
      spec: QUIRE_CARD_SPEC,
      spec_version: QUIRE_CARD_VERSION,
      data: {
        kind: "notebook",
        name,
        summary: M.regexSummary(render.rules.length),
        creator: "",
        creator_notes: "",
        version: "",
        tags: [],
        created_at: 0,
        modified_at: 0,
        source: [],
        notes: [],
        sources: [],
        ai_instructions: "",
        render,
        assets: [],
        extensions: {},
      },
    },
    warnings,
  };
}
