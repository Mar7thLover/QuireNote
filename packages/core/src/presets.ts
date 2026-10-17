/**
 * 对话预设：一套可以随时切换的回答风格——要求（相当于系统提示词）、回答格式、生成参数和附加片段。
 * 和 Notebook 的 AI 说明叠加使用：AI 说明是这本 Notebook 固定的背景，预设是风格；两者冲突时以 AI 说明为准。
 */
import { z } from "zod";
import { patchOf } from "./patch";

export const PresetPosition = z.enum(["system_start", "after_sources", "before_question"]);
export type PresetPosition = z.infer<typeof PresetPosition>;

/** 附加片段：放在系统提示开头、资料之后，或紧贴在提问之前。 */
export const PresetSnippet = z.object({
  content: z.string().max(50_000),
  position: PresetPosition.default("system_start"),
  role: z.enum(["system", "user", "assistant"]).default("system"),
});
export type PresetSnippet = z.infer<typeof PresetSnippet>;

export const ChatPresetFields = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).default(""),
  /** 要求：语气、立场、扮演的角色。 */
  instructions: z.string().max(50_000).default(""),
  /** 回答格式：篇幅、结构。 */
  format: z.string().max(10_000).default(""),
  temperature: z.number().min(0).max(2).nullable().default(null),
  topP: z.number().min(0).max(1).nullable().default(null),
  maxTokens: z.number().int().min(16).max(128_000).nullable().default(null),
  snippets: z.array(PresetSnippet).max(50).default([]),
  /** 导入时保留的原始数据（例如酒馆预设），导出回去时用。 */
  extensions: z.record(z.string(), z.unknown()).default({}),
});
export const ChatPreset = ChatPresetFields.extend({
  id: z.string(),
  builtin: z.boolean().default(false),
});
export type ChatPreset = z.infer<typeof ChatPreset>;
export const ChatPresetInput = ChatPresetFields;
export type ChatPresetInput = z.input<typeof ChatPresetInput>;
export const ChatPresetPatch = patchOf(ChatPresetFields);
export type ChatPresetPatch = z.infer<typeof ChatPresetPatch>;

/** 预设文件（QuireNote 自己的格式）。 */
export const PRESET_FILE_FORMAT = "quire-preset";
export const PresetFile = z.object({
  format: z.literal(PRESET_FILE_FORMAT),
  version: z.literal(1),
  preset: ChatPresetFields,
});

export const DEFAULT_PRESET_ID = "builtin.research";

const BUILTIN: {
  id: string;
  zh: [string, string];
  en: [string, string];
  instructions: string;
  format?: string;
  temperature?: number;
}[] = [
  {
    id: DEFAULT_PRESET_ID,
    zh: ["研究助理", "依据资料回答，结论带引用。默认风格。"],
    en: ["Research assistant", "Answers from your sources with citations. The default."],
    instructions: "",
  },
  {
    id: "builtin.plain",
    zh: ["通俗讲解", "像给没有背景的朋友讲，先结论再举例。"],
    en: [
      "Plain explanation",
      "Explains like to a friend without background: conclusion first, then examples.",
    ],
    instructions:
      "用通俗的语言讲解，像对一位没有相关背景的朋友解释。先用一句话给出结论，再用例子或类比展开；术语第一次出现时顺带解释它的意思。",
    format: "篇幅适中，少用列表，多用完整的句子。",
  },
  {
    id: "builtin.quiz",
    zh: ["提问式复习", "先提问引导回忆，再纠正补充。"],
    en: ["Quiz me", "Asks questions to prompt recall, then corrects and fills in."],
    instructions:
      "帮助用户复习，而不是直接给出完整答案。先用一两个问题引导用户回忆资料里的要点；用户回答后，指出对的地方、纠正错误、补充遗漏。用户明确要求时再直接给出答案。",
    format: "每次只问一到两个问题，简短。",
  },
  {
    id: "builtin.writer",
    zh: ["写作搭档", "帮助构思、续写、改写和润色，保持你的文风。"],
    en: ["Writing partner", "Helps plan, continue, rewrite and polish in your own style."],
    instructions:
      "你是写作搭档：帮助作者构思情节、续写、改写和润色。保持作者已有的文风、人称和时态；提出修改时简要说明理由。涉及人物和设定时以知识书和笔记为准，不擅自改动设定；不确定的地方先问。",
    temperature: 0.9,
  },
];

/** 内置预设（名称跟随界面语言；要求用中文写，回答语言仍由提问和资料决定）。 */
export function builtinPresets(lang?: string): ChatPreset[] {
  const en = !!lang?.toLowerCase().startsWith("en");
  return BUILTIN.map((b) => {
    const [name, description] = en ? b.en : b.zh;
    return ChatPreset.parse({
      id: b.id,
      builtin: true,
      name,
      description,
      instructions: b.instructions,
      format: b.format ?? "",
      temperature: b.temperature ?? null,
    });
  });
}
