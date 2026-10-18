// 生成应用图标：一叠书页，左侧陶土色的线装（quire = 装订成册的一叠书页）。
// 网页的 favicon.svg / icon.svg，以及 iOS、Android 的图标和启动图都从这里生成，改图标只改这一个文件。
// 用法：node scripts/icons.mjs（需要 Playwright 的 Chromium：pnpm exec playwright install chromium）
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INK = "#1F1E1D";
const CLAY = "#C06240"; // oklch(0.6 0.13 40)，与界面的默认点缀色一致
const IVORY = "#FAF9F5";
const IVORY_DEEP = "#F0EEE6";
const PAPER = "#FFFFFF";

/**
 * 书页与装订线（512 × 512 坐标系，居中）：三张纸叠成一册，左侧是四目线装——
 * 红线沿书脊穿过四个针眼，每个针眼处绕过书脊外缘。
 */
function emblem() {
  const W = 250;
  const H = 318;
  const step = 20;
  const x = 117;
  const y = 117;
  const sheet = (sx, sy, opacity) =>
    `<rect x="${sx}" y="${sy}" width="${W}" height="${H}" rx="18" fill="${PAPER}" stroke="${INK}" stroke-opacity="${opacity}" stroke-width="5"/>`;
  const lines = [128, 128, 92, 128, 70]
    .map(
      (w, i) =>
        `<rect x="${x + 84}" y="${y + 82 + i * 38}" width="${w}" height="13" rx="6.5" fill="${INK}" fill-opacity="0.1"/>`,
    )
    .join("");
  const sx = x + 44; // 针眼所在的竖线
  const holes = [0, 1, 2, 3].map((i) => y + 56 + (i * (H - 112)) / 3);
  const thread = [`M${sx} ${holes[0]}V${holes[3]}`, ...holes.map((hy) => `M${sx} ${hy}H${x - 9}`)].join("");
  return `
    <rect x="${x + 4}" y="${y + 16}" width="${W}" height="${H}" rx="18" fill="${INK}" fill-opacity="0.09" filter="url(#soft)"/>
    ${sheet(x + 2 * step, y - 2 * step, 0.12)}
    ${sheet(x + step, y - step, 0.14)}
    ${sheet(x, y, 0.18)}
    ${lines}
    <path d="${thread}" fill="none" stroke="${CLAY}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
    ${holes.map((hy) => `<circle cx="${sx}" cy="${hy}" r="8" fill="${CLAY}"/>`).join("")}`;
}

const DEFS = `<defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${IVORY}"/><stop offset="1" stop-color="${IVORY_DEEP}"/></linearGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="10"/></filter>
  </defs>`;

/** 完整图标：圆角象牙色底 + 书页。rounded=false 时铺满方形（iOS 自己裁圆角）。 */
function iconSvg({ rounded = true } = {}) {
  const tile = rounded
    ? `<rect width="512" height="512" rx="114" fill="url(#tile)"/><rect x="1" y="1" width="510" height="510" rx="113" fill="none" stroke="${INK}" stroke-opacity="0.08" stroke-width="2"/>`
    : `<rect width="512" height="512" fill="url(#tile)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><title>QuireNote</title>${DEFS}${tile}${emblem()}</svg>\n`;
}

/** 只有书页（Android 自适应图标前景、启动图），scale 为书页在画布中的缩放。 */
function emblemSvg(size, scale) {
  const t = (size - 512 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">${DEFS}<g transform="translate(${t} ${t}) scale(${scale})">${emblem()}</g></svg>`;
}

/** 浏览器标签页里只有 16–32 像素：两张纸、粗一点的线，不画字迹。 */
const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><title>QuireNote</title><defs><linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${IVORY}"/><stop offset="1" stop-color="${IVORY_DEEP}"/></linearGradient></defs><rect width="32" height="32" rx="7.5" fill="url(#t)"/><rect x=".5" y=".5" width="31" height="31" rx="7" fill="none" stroke="${INK}" stroke-opacity=".16"/><rect x="10.5" y="3.5" width="17" height="22" rx="1.8" fill="${PAPER}" stroke="${INK}" stroke-opacity=".32" stroke-width="1.1"/><rect x="7" y="7" width="17" height="22" rx="1.8" fill="${PAPER}" stroke="${INK}" stroke-opacity=".55" stroke-width="1.1"/><path d="M10.6 10.6V25.4M10.6 10.6H5.2M10.6 15.53H5.2M10.6 20.47H5.2M10.6 25.4H5.2" fill="none" stroke="${CLAY}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
`;

writeFileSync(join(ROOT, "apps/web/public/favicon.svg"), FAVICON);
writeFileSync(join(ROOT, "apps/web/public/icon.svg"), iconSvg());

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

/** 把 SVG 渲成 PNG。background 为 null 时保留透明。 */
async function png(svg, w, h, out, background = null) {
  const html = `<html><body style="margin:0;background:${background ?? "transparent"}"><div style="width:${w}px;height:${h}px;display:grid;place-items:center;overflow:hidden">${svg}</div></body></html>`;
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(html);
  mkdirSync(dirname(out), { recursive: true });
  await page.screenshot({
    path: out,
    omitBackground: background === null,
    clip: { x: 0, y: 0, width: w, height: h },
  });
}
const sized = (svg, px) => svg.replace("<svg ", `<svg width="${px}" height="${px}" `);

// apple-touch-icon（iOS「添加到主屏幕」）
await png(
  sized(iconSvg({ rounded: false }), 180),
  180,
  180,
  join(ROOT, "apps/web/public/apple-touch-icon.png"),
  IVORY,
);

// iOS 应用图标：1024 方形、不透明
const ios = join(ROOT, "apps/mobile/ios/App/App/Assets.xcassets");
await png(
  sized(iconSvg({ rounded: false }), 1024),
  1024,
  1024,
  join(ios, "AppIcon.appiconset/AppIcon-512@2x.png"),
  IVORY,
);

// Android：传统方形 / 圆形图标，自适应图标前景（108dp，内容在中间 66dp 的安全区里）
const res = join(ROOT, "apps/mobile/android/app/src/main/res");
const DENSITY = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(DENSITY)) {
  const legacy = Math.round(48 * k);
  const fg = Math.round(108 * k);
  await png(sized(iconSvg(), legacy), legacy, legacy, join(res, `mipmap-${d}/ic_launcher.png`));
  const round = `<svg xmlns="http://www.w3.org/2000/svg" width="${legacy}" height="${legacy}" viewBox="0 0 512 512">${DEFS}<circle cx="256" cy="256" r="255" fill="url(#tile)"/><circle cx="256" cy="256" r="254" fill="none" stroke="${INK}" stroke-opacity="0.08" stroke-width="2"/><g transform="translate(256 256) scale(0.84) translate(-256 -256)">${emblem()}</g></svg>`;
  await png(round, legacy, legacy, join(res, `mipmap-${d}/ic_launcher_round.png`));
  await png(sized(emblemSvg(512, 0.74), fg), fg, fg, join(res, `mipmap-${d}/ic_launcher_foreground.png`));
}
writeFileSync(
  join(res, "values/ic_launcher_background.xml"),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${IVORY_DEEP}</color>\n</resources>\n`,
);

// 启动图：象牙色底，书页居中。按现有文件的尺寸逐个重画（PNG 的宽高在 IHDR 里）
const pngSize = (file) => {
  const b = readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};
const splashes = [
  ...readdirSync(res, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith("drawable"))
    .flatMap((e) =>
      readdirSync(join(res, e.name))
        .filter((f) => f === "splash.png")
        .map((f) => join(res, e.name, f)),
    ),
  ...readdirSync(join(ios, "Splash.imageset"))
    .filter((f) => f.endsWith(".png"))
    .map((f) => join(ios, "Splash.imageset", f)),
];
for (const file of splashes) {
  const meta = pngSize(file);
  const side = Math.round(Math.min(meta.w, meta.h) * 0.42);
  const svg = sized(emblemSvg(512, 1), side);
  await png(svg, meta.w, meta.h, file, IVORY);
}

await browser.close();
console.log(
  `favicon.svg, icon.svg, apple-touch-icon.png, iOS 图标, Android 图标 ×${Object.keys(DENSITY).length * 3}, 启动图 ×${splashes.length}`,
);
