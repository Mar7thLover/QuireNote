/**
 * PNG 文本块读写：卡片 JSON 以 UTF-8 → base64 写进 `tEXt` 块，关键字 `quire`（酒馆角色卡是 `ccv3` / `chara`）。
 * 纯 TypeScript，浏览器与服务端通用。
 */

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 8 && SIGNATURE.every((b, i) => bytes[i] === b);
}

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

interface Chunk {
  type: string;
  data: Uint8Array;
  /** 在原文件中的起止（含长度、类型、CRC）。 */
  start: number;
  end: number;
}

function readChunks(bytes: Uint8Array): Chunk[] {
  if (!isPng(bytes)) throw new Error("不是 PNG 文件");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Chunk[] = [];
  let off = 8;
  while (off + 12 <= bytes.length) {
    const len = view.getUint32(off);
    const type = String.fromCharCode(...bytes.subarray(off + 4, off + 8));
    const end = off + 12 + len;
    if (end > bytes.length) break;
    out.push({ type, data: bytes.subarray(off + 8, off + 8 + len), start: off, end });
    off = end;
    if (type === "IEND") break;
  }
  return out;
}

function latin1(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + 0x8000)));
  return s;
}

/** 读出全部 tEXt 块：关键字 → 文本（latin1）。 */
export function readPngText(bytes: Uint8Array): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of readChunks(bytes)) {
    if (c.type !== "tEXt") continue;
    const zero = c.data.indexOf(0);
    if (zero <= 0) continue;
    const key = latin1(c.data.subarray(0, zero));
    if (!out.has(key)) out.set(key, latin1(c.data.subarray(zero + 1)));
  }
  return out;
}

function textChunk(keyword: string, text: string): Uint8Array {
  const body = new Uint8Array(keyword.length + 1 + text.length);
  for (let i = 0; i < keyword.length; i++) body[i] = keyword.charCodeAt(i) & 0xff;
  for (let i = 0; i < text.length; i++) body[keyword.length + 1 + i] = text.charCodeAt(i) & 0xff;
  const typed = new Uint8Array(4 + body.length);
  typed.set([116, 69, 88, 116]); // "tEXt"
  typed.set(body, 4);
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  out.set(typed, 4);
  view.setUint32(8 + body.length, crc32(typed));
  return out;
}

/** 写入（替换）一个 tEXt 块，放在 IEND 之前。text 必须是 latin1（base64 满足）。 */
export function writePngText(bytes: Uint8Array, keyword: string, text: string): Uint8Array {
  const chunks = readChunks(bytes);
  const iend = chunks.find((c) => c.type === "IEND");
  if (!iend) throw new Error("PNG 缺少 IEND 块");
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  for (const c of chunks) {
    if (c.type === "IEND") break;
    if (c.type === "tEXt") {
      const zero = c.data.indexOf(0);
      if (zero > 0 && latin1(c.data.subarray(0, zero)) === keyword) continue;
    }
    parts.push(bytes.subarray(c.start, c.end));
  }
  parts.push(textChunk(keyword, text));
  parts.push(bytes.subarray(iend.start, iend.end));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// ───────────── base64（UTF-8） ─────────────

export function bytesToBase64(bytes: Uint8Array): string {
  return btoa(latin1(bytes));
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodeJsonBase64(value: unknown): string {
  return bytesToBase64(new TextEncoder().encode(JSON.stringify(value)));
}

export function decodeJsonBase64(b64: string): unknown {
  return JSON.parse(new TextDecoder().decode(base64ToBytes(b64)));
}
