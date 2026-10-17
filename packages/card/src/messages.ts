/** 读取卡片时的错误提示，跟随导入时的界面语言。插件的转换文字在各自的包里。 */

const zh = {
  invalidCard: (detail: string) => `卡片内容不符合规范：${detail}`,
  root: "(根)",
  invalidJson: "文件不是有效的 JSON",
  unknownJson: "认不出这个文件：它不是 Quire 卡，也不是已安装插件支持的格式",
  unsafePath: (name: string) => `压缩包里有不安全的路径：${name}`,
  assetTooBig: (name: string, limit: string) => `资源 ${name} 超过 ${limit}`,
  unzippedTooBig: (limit: string) => `解压后超过 ${limit}`,
  badZip: "无法解压文件",
  noCardJson: "压缩包根目录没有 card.json",
  noCardData:
    "这张图里没有卡片数据。如果是从微信、QQ 等转发的，图片可能被压缩过，请让对方发送原图或用文件发送。",
  corrupt: "卡片数据已损坏（无法解码）",
  pngTooBig: (limit: string) => `PNG 超过 ${limit}`,
  zipTooBig: (limit: string) => `压缩包超过 ${limit}`,
  jsonTooBig: (limit: string) => `JSON 超过 ${limit}`,
};

export type CardMessages = typeof zh;

const en: CardMessages = {
  invalidCard: (detail) => `The card doesn't follow the spec: ${detail}`,
  root: "(root)",
  invalidJson: "The file isn't valid JSON",
  unknownJson:
    "Couldn't recognise this file: it's not a Quire card, nor a format an installed plugin supports",
  unsafePath: (name) => `The archive contains an unsafe path: ${name}`,
  assetTooBig: (name, limit) => `Asset ${name} is larger than ${limit}`,
  unzippedTooBig: (limit) => `Larger than ${limit} once unpacked`,
  badZip: "Couldn't unpack the file",
  noCardJson: "There's no card.json at the root of the archive",
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
