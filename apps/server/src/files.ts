/** 文件存储：原始资料文件与生成的媒体。接口与磁盘实现分离，便于以后换成对象存储。 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";

export interface FileStore {
  put(path: string, data: Uint8Array): Promise<void>;
  get(path: string): Promise<Uint8Array | null>;
  exists(path: string): Promise<boolean>;
  delete(path: string): Promise<void>;
  /** 删除目录（前缀）下的全部文件。 */
  deletePrefix(prefix: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
  sizeBytes(): Promise<number>;
  /** 删除所有文件（恢复备份前）。 */
  clear(): Promise<void>;
  /** 本地绝对路径（ffmpeg 等外部工具需要）。 */
  localPath(path: string): string;
}

export class DiskFileStore implements FileStore {
  constructor(readonly root: string) {
    mkdirSync(root, { recursive: true });
  }

  localPath(path: string): string {
    const clean = normalize(path).replace(/^([/\\])+/, "");
    if (clean.split(/[/\\]/).includes("..")) throw new Error("非法文件路径");
    return join(this.root, clean);
  }

  async put(path: string, data: Uint8Array): Promise<void> {
    const p = this.localPath(path);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, data);
  }

  async get(path: string): Promise<Uint8Array | null> {
    const p = this.localPath(path);
    if (!existsSync(p) || !statSync(p).isFile()) return null;
    return new Uint8Array(readFileSync(p));
  }

  async exists(path: string): Promise<boolean> {
    return existsSync(this.localPath(path));
  }

  async delete(path: string): Promise<void> {
    rmSync(this.localPath(path), { force: true });
  }

  async deletePrefix(prefix: string): Promise<void> {
    rmSync(this.localPath(prefix), { recursive: true, force: true });
  }

  async list(prefix = ""): Promise<string[]> {
    const base = prefix ? this.localPath(prefix) : this.root;
    if (!existsSync(base)) return [];
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (ent.isFile())
          out.push(
            p
              .slice(this.root.length + 1)
              .split(sep)
              .join("/"),
          );
      }
    };
    walk(base);
    return out.sort();
  }

  async sizeBytes(): Promise<number> {
    let total = 0;
    for (const f of await this.list()) total += statSync(this.localPath(f)).size;
    return total;
  }

  async clear(): Promise<void> {
    for (const ent of readdirSync(this.root)) rmSync(join(this.root, ent), { recursive: true, force: true });
  }
}

const MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  webm: "video/webm",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  html: "text/html; charset=utf-8",
  json: "application/json",
  epub: "application/epub+zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export function mimeFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}

export function extFromMime(mime: string): string {
  const m = mime.split(";")[0]!.trim().toLowerCase();
  const found = Object.entries(MIME).find(([, v]) => v.split(";")[0] === m);
  if (found) return found[0];
  if (m === "audio/mp3") return "mp3";
  if (m === "audio/x-wav" || m === "audio/wave") return "wav";
  return "bin";
}

/** 文件名清洗：去掉路径与非法字符。 */
export function safeName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "file";
  const cleaned = [...base]
    .map((ch) => (ch.charCodeAt(0) < 32 || '<>:"|?*'.includes(ch) ? "_" : ch))
    .join("");
  return cleaned.slice(0, 120) || "file";
}
