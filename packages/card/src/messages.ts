/**
 * 转换时生成的文字：笔记标题、小节名、条目名、警告和错误。跟随导入时的界面语言，
 * 这样英文界面导入的酒馆角色卡不会出现中文标题。
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
  invalidCard: (detail: string) => `卡片内容不符合规范：${detail}`,
  root: "(根)",
  invalidJson: "文件不是有效的 JSON",
  unknownJson: "认不出这个文件：既不是 Quire 卡，也不是酒馆的角色卡、世界书或正则脚本",
  unsafePath: (name: string) => `压缩包里有不安全的路径：${name}`,
  assetTooBig: (name: string, limit: string) => `资源 ${name} 超过 ${limit}`,
  unzippedTooBig: (limit: string) => `解压后超过 ${limit}`,
  badZip: "无法解压文件",
  noCardJson: "压缩包根目录没有 card.json",
  notCharacter: "PNG 里的酒馆数据不是角色卡",
  noCardData:
    "这张图里没有卡片数据。如果是从微信、QQ 等转发的，图片可能被压缩过，请让对方发送原图或用文件发送。",
  corrupt: "卡片数据已损坏（无法解码）",
  pngTooBig: (limit: string) => `PNG 超过 ${limit}`,
  zipTooBig: (limit: string) => `压缩包超过 ${limit}`,
  jsonTooBig: (limit: string) => `JSON 超过 ${limit}`,
};

export type CardMessages = typeof zh;

const en: CardMessages = {
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
  invalidCard: (detail) => `The card doesn't follow the spec: ${detail}`,
  root: "(root)",
  invalidJson: "The file isn't valid JSON",
  unknownJson:
    "Couldn't recognise this file: it's not a Quire card, nor a SillyTavern character card, world info or regex script",
  unsafePath: (name) => `The archive contains an unsafe path: ${name}`,
  assetTooBig: (name, limit) => `Asset ${name} is larger than ${limit}`,
  unzippedTooBig: (limit) => `Larger than ${limit} once unpacked`,
  badZip: "Couldn't unpack the file",
  noCardJson: "There's no card.json at the root of the archive",
  notCharacter: "The SillyTavern data in this PNG isn't a character card",
  noCardData:
    "There's no card data in this image. If it was forwarded through a chat app, the image may have been recompressed — ask for the original file.",
  corrupt: "The card data is damaged (can't be decoded)",
  pngTooBig: (limit) => `PNG larger than ${limit}`,
  zipTooBig: (limit) => `Archive larger than ${limit}`,
  jsonTooBig: (limit) => `JSON larger than ${limit}`,
};

export function cardMessages(lang?: string): CardMessages {
  return lang?.toLowerCase().startsWith("en") ? en : zh;
}
