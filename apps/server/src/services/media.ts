/** 媒体处理：音频拼接（mp3 / wav / PCM）与 ffmpeg 视频合成。 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BinaryResult } from "@folio/ai";
import type { AppContext } from "../context";

/** 跳过 ID3v2 标签，便于把多段 mp3 直接拼接。 */
function stripId3(data: Uint8Array): Uint8Array {
  if (data.length > 10 && data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33) {
    const size =
      ((data[6]! & 0x7f) << 21) | ((data[7]! & 0x7f) << 14) | ((data[8]! & 0x7f) << 7) | (data[9]! & 0x7f);
    return data.subarray(10 + size);
  }
  return data;
}

interface WavInfo {
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  data: Uint8Array;
}

function parseWav(buf: Uint8Array): WavInfo | null {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o: number) => String.fromCharCode(buf[o]!, buf[o + 1]!, buf[o + 2]!, buf[o + 3]!);
  if (buf.length < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let off = 12;
  let fmt: Omit<WavInfo, "data"> | null = null;
  while (off + 8 <= buf.length) {
    const id = tag(off);
    const size = dv.getUint32(off + 4, true);
    if (id === "fmt ") {
      fmt = {
        channels: dv.getUint16(off + 10, true),
        sampleRate: dv.getUint32(off + 12, true),
        bitsPerSample: dv.getUint16(off + 22, true),
      };
    } else if (id === "data" && fmt) {
      return { ...fmt, data: buf.subarray(off + 8, Math.min(buf.length, off + 8 + size)) };
    }
    off += 8 + size + (size % 2);
  }
  return null;
}

export function buildWav(pcm: Uint8Array, sampleRate: number, channels = 1, bitsPerSample = 16): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  const dv = new DataView(out.buffer);
  const w = (o: number, s: string) => {
    for (let i = 0; i < 4; i++) out[o + i] = s.charCodeAt(i);
  };
  w(0, "RIFF");
  dv.setUint32(4, 36 + pcm.length, true);
  w(8, "WAVE");
  w(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, channels, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, (sampleRate * channels * bitsPerSample) / 8, true);
  dv.setUint16(32, (channels * bitsPerSample) / 8, true);
  dv.setUint16(34, bitsPerSample, true);
  w(36, "data");
  dv.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

function isMp3(p: BinaryResult): boolean {
  return (
    /mpeg|mp3/.test(p.mediaType) ||
    (p.data[0] === 0x49 && p.data[1] === 0x44 && p.data[2] === 0x33) ||
    (p.data[0] === 0xff && (p.data[1]! & 0xe0) === 0xe0)
  );
}

/** 原始 PCM（audio/L16;rate=24000 或 audio/pcm）转 WAV。 */
function pcmToWav(p: BinaryResult): BinaryResult {
  const rate = Number(/rate=(\d+)/.exec(p.mediaType)?.[1] ?? 24000);
  return { data: buildWav(p.data, rate), mediaType: "audio/wav" };
}

/** 拼接多段音频。全部是 mp3 时直接拼帧；全部是 wav/PCM 时合并 PCM 数据。 */
export function concatAudio(parts: BinaryResult[]): BinaryResult {
  if (!parts.length) throw new Error("没有音频片段");
  const normalized = parts.map((p) => (/L16|pcm/i.test(p.mediaType) ? pcmToWav(p) : p));
  if (normalized.every(isMp3)) {
    const chunks = normalized.map((p, i) => (i === 0 ? p.data : stripId3(p.data)));
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.length;
    }
    return { data: out, mediaType: "audio/mpeg" };
  }
  const wavs = normalized.map((p) => parseWav(p.data));
  if (wavs.every((w): w is WavInfo => !!w)) {
    const first = wavs[0]!;
    const same = wavs.every(
      (w) =>
        w.sampleRate === first.sampleRate &&
        w.channels === first.channels &&
        w.bitsPerSample === first.bitsPerSample,
    );
    if (same) {
      // 每句之间插 0.35 秒静音，听感更自然。
      const gap = new Uint8Array(
        Math.round(first.sampleRate * 0.35) * first.channels * (first.bitsPerSample / 8),
      );
      const total = wavs.reduce((s, w) => s + w.data.length + gap.length, 0);
      const pcm = new Uint8Array(total);
      let off = 0;
      for (const w of wavs) {
        pcm.set(w.data, off);
        off += w.data.length + gap.length;
      }
      return {
        data: buildWav(pcm, first.sampleRate, first.channels, first.bitsPerSample),
        mediaType: "audio/wav",
      };
    }
  }
  throw new Error("无法拼接不同格式的音频片段（需要 ffmpeg）");
}

/** 探测 ffmpeg：FFMPEG_PATH 或 PATH 中的 ffmpeg。结果缓存在 ctx 上。 */
export function detectFfmpeg(ctx: AppContext): string | null {
  if (ctx.ffmpeg !== undefined) return ctx.ffmpeg;
  const candidates = [process.env.FFMPEG_PATH, "ffmpeg"].filter((x): x is string => !!x);
  for (const c of candidates) {
    try {
      const r = spawnSync(c, ["-version"], { timeout: 5000, windowsHide: true });
      if (r.status === 0) {
        ctx.ffmpeg = c;
        return c;
      }
    } catch {
      /* 不存在 */
    }
  }
  ctx.ffmpeg = null;
  return null;
}

function runFfmpeg(bin: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, ["-hide_banner", "-loglevel", "error", "-y", ...args], { cwd, windowsHide: true });
    let err = "";
    p.stderr.on("data", (d) => {
      err += String(d);
    });
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg 退出码 ${code}：${err.slice(-500)}`)),
    );
  });
}

const FONT_CANDIDATES = [
  process.env.FOLIO_FONT_FILE,
  "C:/Windows/Fonts/msyh.ttc",
  "C:/Windows/Fonts/simhei.ttf",
  "/System/Library/Fonts/PingFang.ttc",
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
];

function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

export interface VideoSlide {
  title: string;
  bullets: string[];
  /** 该页旁白音频（可选）。 */
  audio?: BinaryResult | null;
}

/** 用 ffmpeg 把幻灯片（纯色背景 + 文字）与旁白合成为 mp4。 */
export async function renderSlidesVideo(bin: string, slides: VideoSlide[]): Promise<Uint8Array> {
  const dir = mkdtempSync(join(tmpdir(), "folio-video-"));
  try {
    const font = FONT_CANDIDATES.find((f) => f && existsSync(f));
    const fontOpt = font ? `fontfile='${escapeFilterPath(font)}':` : "";
    const segments: string[] = [];
    for (let i = 0; i < slides.length; i++) {
      const s = slides[i]!;
      writeFileSync(join(dir, `title${i}.txt`), s.title);
      writeFileSync(join(dir, `body${i}.txt`), s.bullets.map((b) => `• ${b}`).join("\n"));
      let duration = Math.max(4, 2 + s.bullets.join("").length / 12);
      const inputs = ["-f", "lavfi", "-i", "color=c=0x1e1b4b:s=1280x720:r=25"];
      if (s.audio?.data.length) {
        const ext = /wav/.test(s.audio.mediaType) ? "wav" : "mp3";
        writeFileSync(join(dir, `a${i}.${ext}`), s.audio.data);
        inputs.push("-i", `a${i}.${ext}`);
        duration = 0;
      } else inputs.push("-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono");
      const vf = [
        `drawtext=${fontOpt}textfile=title${i}.txt:fontcolor=white:fontsize=48:x=80:y=80`,
        `drawtext=${fontOpt}textfile=body${i}.txt:fontcolor=0xe0e7ff:fontsize=30:line_spacing=18:x=100:y=200`,
      ].join(",");
      const out = `seg${i}.mp4`;
      await runFfmpeg(
        bin,
        [
          ...inputs,
          "-vf",
          vf,
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-ar",
          "24000",
          "-ac",
          "1",
          ...(duration ? ["-t", duration.toFixed(1)] : ["-shortest"]),
          out,
        ],
        dir,
      );
      segments.push(out);
    }
    writeFileSync(join(dir, "list.txt"), segments.map((s) => `file '${s}'`).join("\n"));
    await runFfmpeg(bin, ["-f", "concat", "-safe", "0", "-i", "list.txt", "-c", "copy", "out.mp4"], dir);
    return new Uint8Array(readFileSync(join(dir, "out.mp4")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
