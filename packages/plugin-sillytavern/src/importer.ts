/** 「酒馆兼容」插件的卡片导入器：角色卡（JSON / PNG / CHARX）、世界书、正则脚本。 */
import { CardError, type CardImporter, type Converted, decodeJsonBase64 } from "@quirenote/card";
import type { QuireCard } from "@quirenote/core";
import {
  characterToCard,
  isCharacterCard,
  isRegexScripts,
  isWorldInfo,
  regexToCard,
  worldInfoToCard,
} from "./convert";
import { stMessages } from "./messages";

export const PLUGIN_ID = "sillytavern";

/** 角色卡的几种格式（PNG / JSON / CHARX）：可以导入为 Notebook，也可以导入为问答风格。 */
export const CHARACTER_FORMATS = ["st-card-png", "st-card-json", "st-charx"];
export const isCharacterFormat = (format: string) => CHARACTER_FORMATS.includes(format);

/** CHARX 的 assets：`embeded://`（规格原文拼写）或 `embedded://` 指向压缩包内路径。 */
function attachCharxAssets(raw: unknown, card: QuireCard, files: Map<string, Uint8Array>): void {
  const data = (raw as { data?: { assets?: unknown } }).data;
  const assets = Array.isArray(data?.assets) ? data.assets : [];
  for (const a of assets as { type?: string; uri?: string; name?: string; ext?: string }[]) {
    const uri = String(a.uri ?? "");
    const path = uri.replace(/^embedd?ed:\/\//, "");
    if (uri === path || !files.has(path)) continue;
    const isMain = a.type === "icon" && a.name === "main";
    card.data.assets.push({
      id: path.replace(/[^A-Za-z0-9_.-]/g, "_"),
      type: isMain
        ? "cover"
        : a.type === "emotion" || a.type === "background" || a.type === "icon"
          ? "image"
          : `x_${a.type ?? "other"}`,
      name: `${a.name ?? "asset"}.${a.ext ?? path.split(".").pop() ?? "bin"}`,
      mime: "application/octet-stream",
      uri: `embedded://${path}`,
    });
  }
}

export const sillytavernImporter: CardImporter = {
  id: PLUGIN_ID,
  fromJson(value, opts): Converted | null {
    if (isCharacterCard(value)) return { format: "st-card-json", ...characterToCard(value, opts) };
    if (isWorldInfo(value)) return { format: "st-worldinfo", ...worldInfoToCard(value, opts) };
    if (isRegexScripts(value)) return { format: "st-regex", ...regexToCard(value, opts) };
    return null;
  },
  fromZip(value, files, opts): Converted | null {
    if (!isCharacterCard(value)) return null;
    const converted = characterToCard(value, opts);
    attachCharxAssets(value, converted.card, files);
    return { format: "st-charx", ...converted };
  },
  fromPngText(text, opts): Converted | null {
    const raw = text.get("ccv3") ?? text.get("chara");
    if (!raw) return null;
    const M = stMessages(opts.lang);
    let value: unknown;
    try {
      value = decodeJsonBase64(raw);
    } catch {
      throw new CardError(M.corrupt);
    }
    if (!isCharacterCard(value)) throw new CardError(M.notCharacter);
    return { format: "st-card-png", ...characterToCard(value, opts) };
  },
};
