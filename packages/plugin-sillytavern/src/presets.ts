/**
 * 酒馆的对话补全预设（Chat Completion preset）↔ QuireNote 对话预设；角色卡 → 问答风格预设。
 * 酒馆预设里的占位片段（聊天记录、世界书、角色描述等的位置）由 QuireNote 自己的提示词顺序处理，导入时略过。
 */
import type { ChatPresetInput, PresetSnippet } from "@quirenote/core";
import { stMessages } from "./messages";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** 酒馆预设里代表「这里放某段内容」的占位片段。 */
const MARKERS = new Set([
  "chatHistory",
  "worldInfoBefore",
  "worldInfoAfter",
  "charDescription",
  "charPersonality",
  "scenario",
  "personaDescription",
  "dialogueExamples",
]);
/** 酒馆的全局默认提示词顺序。 */
const GLOBAL_ORDER = 100001;

export function isStPreset(v: unknown): v is Obj {
  return (
    isObj(v) &&
    Array.isArray(v.prompts) &&
    (Array.isArray(v.prompt_order) || typeof v.temperature === "number")
  );
}

export interface PresetConverted {
  preset: ChatPresetInput;
  warnings: string[];
}

export function stPresetToPreset(raw: Obj, opts: { filename?: string; lang?: string } = {}): PresetConverted {
  const M = stMessages(opts.lang);
  const warnings: string[] = [];
  const prompts = (raw.prompts as unknown[]).filter(isObj);
  const byId = new Map(prompts.map((p) => [str(p.identifier), p]));
  const orders = Array.isArray(raw.prompt_order) ? raw.prompt_order.filter(isObj) : [];
  const order = orders.find((o) => num(o.character_id) === GLOBAL_ORDER) ?? orders[0];
  let perCharacter = 0;
  if (orders.some((o) => num(o.character_id) !== GLOBAL_ORDER)) perCharacter = orders.length - 1;
  const sequence: Obj[] = order
    ? (Array.isArray(order.order) ? order.order.filter(isObj) : [])
        .filter((o) => o.enabled !== false)
        .map((o) => byId.get(str(o.identifier)))
        .filter((p): p is Obj => !!p)
    : prompts.filter((p) => p.enabled !== false);

  const instructions: string[] = [];
  const snippets: PresetSnippet[] = [];
  let markers = 0;
  for (const p of sequence) {
    if (p.marker === true || MARKERS.has(str(p.identifier))) {
      markers++;
      continue;
    }
    const content = str(p.content).trim();
    if (!content) continue;
    const role = (["system", "user", "assistant"] as const).find((r) => r === p.role) ?? "system";
    // 1 = 按深度插入对话（酒馆的 absolute）；其余按顺序进系统提示
    if (num(p.injection_position) === 1) snippets.push({ content, position: "before_question", role });
    else instructions.push(content);
  }
  if (markers) warnings.push(M.presetMarkers(markers));
  if (perCharacter > 0) warnings.push(M.presetPromptOnly(perCharacter));

  const name = (opts.filename ?? "").replace(/\.json$/i, "").trim() || M.presetName;
  return {
    preset: {
      name: name.slice(0, 100),
      description: "",
      instructions: instructions.join("\n\n"),
      format: "",
      temperature: clamp(num(raw.temperature), 0, 2),
      topP: clamp(num(raw.top_p), 0, 1),
      maxTokens: clampInt(num(raw.openai_max_tokens), 16, 128_000),
      snippets,
      extensions: { sillytavern: raw },
    },
    warnings,
  };
}

const clamp = (v: number | null, lo: number, hi: number) =>
  v === null ? null : Math.min(hi, Math.max(lo, v));
const clampInt = (v: number | null, lo: number, hi: number) =>
  v === null ? null : Math.round(Math.min(hi, Math.max(lo, v)));

/** QuireNote 预设 → 酒馆预设 JSON。从酒馆导入的保留原有字段，只更新参数和主提示词。 */
export function presetToStPreset(p: ChatPresetInput): Obj {
  const orig = isObj(p.extensions?.sillytavern) ? (p.extensions.sillytavern as Obj) : null;
  const main = [p.instructions, p.format ? `Format: ${p.format}` : ""].filter((s) => s?.trim()).join("\n\n");
  const custom = (p.snippets ?? []).map((s, i) => ({
    identifier: `quire_${i}`,
    name: `QuireNote ${i + 1}`,
    system_prompt: false,
    role: s.role ?? "system",
    content: s.content,
    injection_position: s.position === "before_question" ? 1 : 0,
    injection_depth: s.position === "before_question" ? 0 : 4,
  }));
  const params = {
    ...(p.temperature != null ? { temperature: p.temperature } : {}),
    ...(p.topP != null ? { top_p: p.topP } : {}),
    ...(p.maxTokens != null ? { openai_max_tokens: p.maxTokens } : {}),
  };
  if (orig) {
    const prompts = (Array.isArray(orig.prompts) ? orig.prompts.filter(isObj) : []).map((x) =>
      str(x.identifier) === "main" ? { ...x, content: main } : x,
    );
    return { ...orig, ...params, prompts };
  }
  const prompts = [
    { identifier: "main", name: "Main Prompt", system_prompt: true, role: "system", content: main },
    { identifier: "chatHistory", name: "Chat History", system_prompt: true, marker: true },
    ...custom,
  ];
  return {
    ...params,
    prompts,
    prompt_order: [
      {
        character_id: GLOBAL_ORDER,
        order: prompts.map((x) => ({ identifier: x.identifier, enabled: true })),
      },
    ],
  };
}

/** 角色卡 → 问答风格预设：角色设定写进要求，历史后指令和深度提示词放在提问之前。 */
export function characterToPreset(raw: Obj, lang?: string): ChatPresetInput {
  const M = stMessages(lang);
  const d =
    isObj(raw.data) && (raw.spec === "chara_card_v2" || raw.spec === "chara_card_v3") ? raw.data : raw;
  const name = str(d.nickname).trim() || str(d.name).trim() || M.unnamedCharacter;
  const macro = (s: unknown) =>
    str(s)
      .replace(/\{\{char\}\}|<BOT>|<CHAR>/gi, name)
      .replace(/\{\{user\}\}|<USER>/gi, M.you)
      .trim();
  const sections = [
    [M.description, macro(d.description)],
    [M.personality, macro(d.personality)],
    [M.scenario, macro(d.scenario)],
    [M.examples, macro(d.mes_example)],
  ]
    .filter(([, body]) => body)
    .map(([title, body]) => `### ${title}\n\n${body}`);
  const instructions = [
    M.characterRole(name),
    sections.length ? `## ${M.characterSection}\n\n${sections.join("\n\n")}` : "",
    macro(d.system_prompt),
  ]
    .filter(Boolean)
    .join("\n\n");
  const snippets: PresetSnippet[] = [];
  const phi = macro(d.post_history_instructions);
  if (phi) snippets.push({ content: phi, position: "before_question", role: "system" });
  const ext = isObj(d.extensions) ? d.extensions : {};
  const dp = isObj(ext.depth_prompt) ? ext.depth_prompt : null;
  if (dp && macro(dp.prompt)) {
    const role = (["system", "user", "assistant"] as const).find((r) => r === dp.role) ?? "system";
    snippets.push({ content: macro(dp.prompt), position: "before_question", role });
  }
  return {
    name: name.slice(0, 100),
    description: macro(d.description).replace(/\s+/g, " ").slice(0, 120),
    instructions,
    format: "",
    temperature: null,
    topP: null,
    maxTokens: null,
    snippets,
    extensions: { sillytavern: { character: raw } },
  };
}
