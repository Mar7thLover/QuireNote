/**
 * PNG 卡的封面：800×1200，上方是插画区（笔记里的第一张图，没有就用色块），下方衬线体标题、一句话介绍、作者。
 * 用 canvas 画，导出 PNG 后再把卡片 JSON 写进 tEXt 块。
 */
import type { QuireCard } from "@quirenote/core";
import { TINTS, tintFor } from "@/lib/tints";

const W = 800;
const H = 1200;
const PAD = 64;

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const ch of text.replace(/\s+/g, " ").trim()) {
    const next = line + ch;
    if (ctx.measureText(next).width > width && line) {
      lines.push(line);
      line = ch === " " ? "" : ch;
      if (lines.length === maxLines) break;
    } else {
      line = next;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  const n = lines.length;
  if (n > 1 && n < maxLines && [...lines[n - 1]!].length <= 2 && [...lines[n - 2]!].length > 6) {
    const prev = [...lines[n - 2]!];
    lines[n - 1] = prev.splice(-2).join("") + lines[n - 1];
    lines[n - 2] = prev.join("");
  }
  if (lines.length === maxLines && text.length > lines.join("").length + 1) {
    const last = lines[maxLines - 1]!;
    lines[maxLines - 1] = `${last.slice(0, Math.max(0, last.length - 1))}…`;
  }
  return lines;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** 卡片里第一张可作封面的图片（已内联为 data: URL）。 */
function coverSource(card: QuireCard): string | null {
  const assets = card.data.assets;
  const cover =
    assets.find((a) => a.type === "cover") ??
    assets.find((a) => a.type === "image" && a.mime !== "image/svg+xml");
  return cover?.uri.startsWith("data:image/") ? cover.uri : null;
}

export async function renderCover(
  card: QuireCard,
  labels: { kind: string; brand: string },
): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  await document.fonts?.ready;
  const serif = getComputedStyle(document.documentElement).getPropertyValue("--font-serif").trim() || "serif";
  const sans =
    getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim() || "sans-serif";

  ctx.fillStyle = "#faf9f5";
  ctx.fillRect(0, 0, W, H);

  // 插画区
  const artH = 620;
  const src = coverSource(card);
  const img = src ? await loadImage(src) : null;
  if (img) {
    const scale = Math.max(W / img.width, artH / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, artH);
    ctx.clip();
    // 竖版图（角色立绘多是这样）人物在上半部分：裁切时偏上取景
    ctx.drawImage(img, (W - w) / 2, h > artH ? (artH - h) * 0.25 : (artH - h) / 2, w, h);
    ctx.restore();
  } else {
    // 没有图片：Console 那组颜色里取一种做底，叠两道细线，像一页纸的天头
    const probe = document.createElement("div");
    probe.style.color = TINTS[tintFor(card.data.name)];
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, W, artH);
    ctx.strokeStyle = "rgba(20,20,19,0.18)";
    ctx.lineWidth = 2;
    for (const y of [artH - 120, artH - 104]) {
      ctx.beginPath();
      ctx.moveTo(PAD, y);
      ctx.lineTo(W - PAD, y);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(20,20,19,0.82)";
    ctx.font = `400 220px ${serif}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText([...card.data.name.trim()][0] ?? "Q", W / 2, artH / 2 - 40);
    ctx.textAlign = "left";
  }

  // 文字区
  ctx.textBaseline = "alphabetic";
  let y = artH + 72;
  ctx.fillStyle = "#73726c";
  ctx.font = `500 22px ${sans}`;
  ctx.fillText(labels.kind, PAD, y);
  y += 30;
  ctx.fillStyle = "#141413";
  ctx.font = `400 54px ${serif}`;
  for (const line of wrap(ctx, card.data.name, W - PAD * 2, 3)) {
    y += 66;
    ctx.fillText(line, PAD, y);
  }
  if (card.data.summary.trim()) {
    y += 30;
    ctx.fillStyle = "#4d4c48";
    ctx.font = `400 26px ${sans}`;
    for (const line of wrap(
      ctx,
      card.data.summary,
      W - PAD * 2,
      Math.max(1, Math.floor((H - 120 - y) / 40)),
    )) {
      y += 40;
      if (y > H - 110) break;
      ctx.fillText(line, PAD, y);
    }
  }
  // 页脚
  ctx.strokeStyle = "rgba(31,30,29,0.13)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, H - 84);
  ctx.lineTo(W - PAD, H - 84);
  ctx.stroke();
  ctx.fillStyle = "#73726c";
  ctx.font = `400 22px ${sans}`;
  ctx.fillText(card.data.creator ? `${card.data.creator}` : "", PAD, H - 44);
  ctx.textAlign = "right";
  ctx.font = `500 22px ${serif}`;
  ctx.fillText(labels.brand, W - PAD, H - 44);

  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("无法生成封面");
  return new Uint8Array(await blob.arrayBuffer());
}

export function downloadBytes(bytes: Uint8Array, filename: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
