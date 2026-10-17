/**
 * 转换酒馆文件时生成的文字：笔记标题、小节名、条目名和警告。跟随导入时的界面语言，
 * 这样英文界面导入的角色卡不会出现中文标题。
 */

const zh = {
  you: "你",
  unnamedCharacter: "未命名角色",
  description: "描述",
  personality: "性格",
  scenario: "场景",
  firstMessage: "开场白",
  altGreetings: "其他开场白",
  groupGreetings: "群聊开场白",
  examples: "示例对话",
  settingsNote: (name: string) => `${name} · 角色设定`,
  openersNote: (name: string) => `${name} · 开场白与示例对话`,
  realName: (name: string) => `原名：${name}`,
  bookName: (name: string) => `${name} 的知识书`,
  charEntry: (name: string) => `${name}（角色设定）`,
  postHistory: "历史后指令",
  depthPrompt: "角色备注（深度提示词）",
  unknownMacros: (list: string[]) => `保留了未转换的宏：${list.join("、")}`,
  outletComment: "酒馆的 outlet 条目（只在模板里手动引用），QuireNote 不支持，导入为停用。",
  outletWarning: "有条目使用酒馆的 outlet 位置，已导入为停用",
  vectorized: "向量触发的条目按普通关键词条目导入",
  worldInfo: "世界书",
  worldInfoSummary: (n: number) => `知识书，${n} 条`,
  regexScript: (i: number) => `正则脚本 ${i}`,
  regexScripts: "正则脚本",
  regexSummary: (n: number) => `正则规则，${n} 条`,
  fromRegex: "从酒馆正则脚本导入",
  promptRegex: (n: number) => `${n} 条正则会改写发给模型的文字，QuireNote 只改显示，已导入为停用`,
  trimStrings: (n: number) => `${n} 条正则用了 trimStrings，QuireNote 暂不支持，可能显示多余字符`,
  scripted: (n: number) => `${n} 条正则的替换内容含脚本，脚本会被移除，只保留静态样式`,
  notCharacter: "PNG 里的酒馆数据不是角色卡",
  corrupt: "卡片数据已损坏（无法解码）",
  presetName: "酒馆预设",
  characterSection: "角色设定",
  characterRole: (name: string) =>
    `你在扮演「${name}」。下面是这个角色的设定，回答时保持这个角色的口吻和视角。`,
  presetMarkers: (n: number) =>
    `预设里有 ${n} 个酒馆专用的占位片段（聊天记录、世界书位置等），QuireNote 按自己的顺序处理，已忽略`,
  presetPromptOnly: (n: number) => `${n} 个片段设置了只在特定角色卡下使用，已按全局片段导入`,
};

export type StMessages = typeof zh;

const en: StMessages = {
  you: "you",
  unnamedCharacter: "Unnamed character",
  description: "Description",
  personality: "Personality",
  scenario: "Scenario",
  firstMessage: "First message",
  altGreetings: "Alternate greetings",
  groupGreetings: "Group greetings",
  examples: "Example dialogue",
  settingsNote: (name) => `${name} · Character`,
  openersNote: (name) => `${name} · Greetings and examples`,
  realName: (name) => `Real name: ${name}`,
  bookName: (name) => `${name}'s lorebook`,
  charEntry: (name) => `${name} (character)`,
  postHistory: "Post-history instructions",
  depthPrompt: "Character note (depth prompt)",
  unknownMacros: (list) => `Kept unconverted macros: ${list.join(", ")}`,
  outletComment:
    "A SillyTavern outlet entry (only referenced manually in templates). QuireNote doesn't support it, so it was imported turned off.",
  outletWarning: "Some entries use SillyTavern's outlet position and were imported turned off",
  vectorized: "Vector-triggered entries were imported as ordinary keyword entries",
  worldInfo: "World info",
  worldInfoSummary: (n) => `Lorebook, ${n} entries`,
  regexScript: (i) => `Regex script ${i}`,
  regexScripts: "Regex scripts",
  regexSummary: (n) => `Render rules, ${n}`,
  fromRegex: "Imported from a SillyTavern regex script",
  promptRegex: (n) =>
    `${n} regex scripts rewrite the text sent to the model; QuireNote only changes display, so they were imported turned off`,
  trimStrings: (n) =>
    `${n} regex scripts use trimStrings, which QuireNote doesn't support yet; extra characters may show`,
  scripted: (n) =>
    `${n} regex replacements contain scripts; the scripts are removed and only static styling is kept`,
  notCharacter: "The SillyTavern data in this PNG isn't a character card",
  corrupt: "The card data is damaged (can't be decoded)",
  presetName: "SillyTavern preset",
  characterSection: "Character",
  characterRole: (name) =>
    `You are playing "${name}". The character's settings follow; keep this character's voice and point of view.`,
  presetMarkers: (n) =>
    `The preset has ${n} SillyTavern placeholder parts (chat history, world info positions…); QuireNote orders those itself, so they were skipped`,
  presetPromptOnly: (n) =>
    `${n} parts were limited to particular character cards; they were imported as global parts`,
};

export function stMessages(lang?: string): StMessages {
  return lang?.toLowerCase().startsWith("en") ? en : zh;
}
