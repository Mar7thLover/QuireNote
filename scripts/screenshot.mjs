// 界面截图自检工具：node scripts/screenshot.mjs <path> <name> [--dark] [--mobile] [--wait=ms] [--eval=js]
// 截图保存到 e2e/.screens/<name>.png（已 gitignore）。
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const [, , path = "/", name = "shot", ...flags] = process.argv;
const opt = Object.fromEntries(
  flags.map((f) => {
    const [k, ...v] = f.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : true];
  }),
);
const base = process.env.FOLIO_WEB ?? "http://localhost:5173";
mkdirSync("e2e/.screens", { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: opt.mobile
    ? { width: 390, height: 844 }
    : { width: Number(opt.w ?? 1440), height: Number(opt.h ?? 900) },
  deviceScaleFactor: opt.mobile ? 2 : 1,
  colorScheme: opt.dark ? "dark" : "light",
  locale: "zh-CN",
  isMobile: !!opt.mobile,
  hasTouch: !!opt.mobile,
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
await page.addInitScript((dark) => {
  localStorage.setItem(
    "folio.theme",
    JSON.stringify({ state: { mode: dark ? "dark" : "light" }, version: 1 }),
  );
}, !!opt.dark);
await page.goto(base + path, { waitUntil: "networkidle" });
await page.waitForTimeout(Number(opt.wait ?? 800));
if (opt.eval) {
  await page.evaluate(opt.eval);
  await page.waitForTimeout(Number(opt.after ?? 800));
}
await page.screenshot({ path: `e2e/.screens/${name}.png`, fullPage: false });
if (errors.length) console.log(errors.slice(0, 10).join("\n"));
console.log(`saved e2e/.screens/${name}.png`);
await browser.close();
