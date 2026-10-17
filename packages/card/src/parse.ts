/**
 * 读取卡片文件：本体只认 Quire 卡（PNG / JSON / .quire 压缩包）；别的格式交给插件提供的导入器
 * （例如「酒馆兼容」插件的角色卡、世界书、正则脚本）。统一转成 QuireCard，资源文件单独返回。
 */
import { type CardAsset, QUIRE_CARD_SPEC, QuireCard } from "@quirenote/core";
import { strToU8, unzipSync, zipSync } from "fflate";
import type { CardImporter, Converted, ConvertOptions } from "./importer";
import { type CardMessages, cardMessages } from "./messages";
import { decodeJsonBase64, encodeJsonBase64, isPng, readPngText, writePngText } from "./png";

export interface ParseOptions extends ConvertOptions {
  /** 插件提供的导入器，按顺序尝试。 */
  importers?: readonly CardImporter[];
}

export const CARD_LIMITS = {
  json: 8 * 1024 * 1024,
  png: 20 * 1024 * 1024,
  zip: 200 * 1024 * 1024,
  /** 解压后的总大小（防 zip 炸弹）。 */
  unzipped: 300 * 1024 * 1024,
  asset: 50 * 1024 * 1024,
};

/** Quire 卡自己的三种容器；插件格式由导入器给出（如 `st-card-png`）。 */
export type CardFormat = "quire-png" | "quire-json" | "quire-zip" | (string & {});

export interface ParsedCard {
  format: CardFormat;
  /** 转换它的插件 id；Quire 卡为 null。 */
  importer: string | null;
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

const isQuire = (value: unknown) =>
  !!value && typeof value === "object" && (value as { spec?: unknown }).spec === QUIRE_CARD_SPEC;

/** 依次问每个导入器；第一个认得的负责转换。 */
function viaImporters(
  opts: ParseOptions,
  pick: (imp: CardImporter) => Converted | null | undefined,
): (Converted & { importer: string }) | null {
  for (const imp of opts.importers ?? []) {
    const r = pick(imp);
    if (r) return { ...r, importer: imp.id };
  }
  return null;
}

/** 已解析的 JSON 判断是哪一种并转换。 */
function fromJson(value: unknown, opts: ParseOptions): Converted & { importer: string | null } {
  const M = cardMessages(opts.lang);
  if (isQuire(value)) return { format: "quire-json", card: validate(value, M), warnings: [], importer: null };
  const r = viaImporters(opts, (imp) => imp.fromJson?.(value, opts));
  if (r) return r;
  throw new CardError(M.unknownJson, "unknown_format");
}

function fromZip(bytes: Uint8Array, opts: ParseOptions): ParsedCard {
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
  if (isQuire(value))
    return { format: "quire-zip", importer: null, card: validate(value, M), files, warnings: [] };
  const r = viaImporters(opts, (imp) => imp.fromZip?.(value, files, opts));
  if (r) return { format: r.format, importer: r.importer, card: r.card, files, warnings: r.warnings };
  throw new CardError(M.unknownJson, "unknown_format");
}

function fromPng(bytes: Uint8Array, opts: ParseOptions): ParsedCard {
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
    return { format: "quire-png", importer: null, card, files, warnings: [] };
  }
  const r = viaImporters(opts, (imp) => imp.fromPngText?.(text, opts));
  if (r) {
    if (!r.card.data.assets.some((a) => a.type === "cover")) r.card.data.assets.push(cover);
    return { format: r.format, importer: r.importer, card: r.card, files, warnings: r.warnings };
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
export function parseCardFile(bytes: Uint8Array, filename = "", opts: ParseOptions = {}): ParsedCard {
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
  const r = fromJson(value, o);
  return { format: r.format, importer: r.importer, card: r.card, files: new Map(), warnings: r.warnings };
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
