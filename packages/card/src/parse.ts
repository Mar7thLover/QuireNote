/**
 * 读取任意卡片文件：Quire 卡（PNG / JSON / .quire 压缩包），酒馆角色卡（PNG / JSON / CHARX）、
 * 酒馆世界书 JSON、酒馆正则脚本 JSON。统一转成 QuireCard，资源文件单独返回。
 */
import { type CardAsset, QUIRE_CARD_SPEC, QuireCard } from "@quirenote/core";
import { strToU8, unzipSync, zipSync } from "fflate";
import { type CardMessages, cardMessages } from "./messages";
import { decodeJsonBase64, encodeJsonBase64, isPng, readPngText, writePngText } from "./png";
import {
  type ConvertOptions,
  characterToCard,
  isCharacterCard,
  isRegexScripts,
  isWorldInfo,
  regexToCard,
  worldInfoToCard,
} from "./sillytavern";

export const CARD_LIMITS = {
  /** 整本 Notebook 带上资料全文时会比较大，和 PNG 用同一上限。 */
  json: 20 * 1024 * 1024,
  png: 20 * 1024 * 1024,
  zip: 200 * 1024 * 1024,
  /** 解压后的总大小（防 zip 炸弹）。 */
  unzipped: 300 * 1024 * 1024,
  asset: 50 * 1024 * 1024,
};

export type CardFormat =
  | "quire-png"
  | "quire-json"
  | "quire-zip"
  | "st-card-png"
  | "st-card-json"
  | "st-charx"
  | "st-worldinfo"
  | "st-regex";

export interface ParsedCard {
  format: CardFormat;
  card: QuireCard;
  /** 压缩包里的资源文件（路径 → 内容），以及 PNG 卡本身（`cover.png`）。 */
  files: Map<string, Uint8Array>;
  warnings: string[];
}

export class CardError extends Error {
  constructor(
    message: string,
    readonly code = "invalid_card",
  ) {
    super(message);
    this.name = "CardError";
  }
}

const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;

function validate(raw: unknown, M: CardMessages): QuireCard {
  const r = QuireCard.safeParse(raw);
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  throw new CardError(
    M.invalidCard(issue ? `${issue.path.join(".") || M.root} ${issue.message}` : r.error.message),
  );
}

function parseJson(text: string, M: CardMessages): unknown {
  try {
    return JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    throw new CardError(M.invalidJson);
  }
}

/** 已解析的 JSON 判断是哪一种并转换。 */
function fromJson(
  value: unknown,
  opts: ConvertOptions,
): { format: CardFormat; card: QuireCard; warnings: string[] } {
  const M = cardMessages(opts.lang);
  if (value && typeof value === "object" && (value as { spec?: unknown }).spec === QUIRE_CARD_SPEC)
    return { format: "quire-json", card: validate(value, M), warnings: [] };
  if (isCharacterCard(value)) return { format: "st-card-json", ...characterToCard(value, opts) };
  if (isWorldInfo(value)) return { format: "st-worldinfo", ...worldInfoToCard(value, opts) };
  if (isRegexScripts(value)) return { format: "st-regex", ...regexToCard(value, opts) };
  throw new CardError(M.unknownJson, "unknown_format");
}

function fromZip(bytes: Uint8Array, opts: ConvertOptions): ParsedCard {
  const M = cardMessages(opts.lang);
  let total = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (f) => {
        if (f.name.endsWith("/")) return false;
        if (f.name.split("/").some((p) => p === ".." || p.startsWith("/")) || /^[a-z]:/i.test(f.name))
          throw new CardError(M.unsafePath(f.name));
        if (f.originalSize > CARD_LIMITS.asset && f.name !== "card.json")
          throw new CardError(M.assetTooBig(f.name, mb(CARD_LIMITS.asset)));
        total += f.originalSize;
        if (total > CARD_LIMITS.unzipped) throw new CardError(M.unzippedTooBig(mb(CARD_LIMITS.unzipped)));
        return true;
      },
    });
  } catch (e) {
    if (e instanceof CardError) throw e;
    throw new CardError(M.badZip);
  }
  const json = entries["card.json"];
  if (!json) throw new CardError(M.noCardJson);
  const value = parseJson(new TextDecoder().decode(json), M);
  const files = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(entries)) if (name !== "card.json") files.set(name, data);
  const parsed = fromJson(value, opts);
  const format: CardFormat = parsed.format === "quire-json" ? "quire-zip" : "st-charx";
  if (format === "st-charx") attachCharxAssets(value, parsed.card, files);
  return { format, card: parsed.card, files, warnings: parsed.warnings };
}

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

function fromPng(bytes: Uint8Array, opts: ConvertOptions): ParsedCard {
  const M = cardMessages(opts.lang);
  const text = readPngText(bytes);
  const files = new Map<string, Uint8Array>([["cover.png", bytes]]);
  const cover: CardAsset = {
    id: "cover.png",
    type: "cover",
    name: "cover.png",
    mime: "image/png",
    uri: "embedded://cover.png",
  };
  const quire = text.get("quire");
  if (quire) {
    const card = validate(safeDecode(quire, M), M);
    if (!card.data.assets.some((a) => a.type === "cover")) card.data.assets.push(cover);
    return { format: "quire-png", card, files, warnings: [] };
  }
  const st = text.get("ccv3") ?? text.get("chara");
  if (st) {
    const value = safeDecode(st, M);
    if (!isCharacterCard(value)) throw new CardError(M.notCharacter);
    const { card, warnings } = characterToCard(value, opts);
    card.data.assets.push(cover);
    return { format: "st-card-png", card, files, warnings };
  }
  throw new CardError(M.noCardData, "no_card_data");
}

function safeDecode(b64: string, M: CardMessages): unknown {
  try {
    return decodeJsonBase64(b64);
  } catch {
    throw new CardError(M.corrupt);
  }
}

/** 识别并读取一个卡片文件。 */
export function parseCardFile(bytes: Uint8Array, filename = "", opts: ConvertOptions = {}): ParsedCard {
  const o = { ...opts, filename: opts.filename ?? filename };
  const M = cardMessages(o.lang);
  if (isPng(bytes)) {
    if (bytes.length > CARD_LIMITS.png) throw new CardError(M.pngTooBig(mb(CARD_LIMITS.png)));
    return fromPng(bytes, o);
  }
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    if (bytes.length > CARD_LIMITS.zip) throw new CardError(M.zipTooBig(mb(CARD_LIMITS.zip)));
    return fromZip(bytes, o);
  }
  if (bytes.length > CARD_LIMITS.json) throw new CardError(M.jsonTooBig(mb(CARD_LIMITS.json)));
  const value = parseJson(new TextDecoder().decode(bytes), M);
  return { ...fromJson(value, o), files: new Map() };
}

// ───────────── 写出 ─────────────

/** 把卡片写进一张 PNG（替换已有的 quire 块）。 */
export function cardToPng(cover: Uint8Array, card: QuireCard): Uint8Array {
  return writePngText(cover, "quire", encodeJsonBase64(card));
}

/** .quire 压缩包：根目录 card.json + assets/…；资源的 uri 应已是 embedded://<路径>。 */
export function cardToZip(card: QuireCard, files: Map<string, Uint8Array>): Uint8Array {
  const entries: Record<string, Uint8Array> = { "card.json": strToU8(JSON.stringify(card, null, 2)) };
  for (const [path, data] of files) entries[path] = data;
  return zipSync(entries, { level: 6 });
}
