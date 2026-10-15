// 调试用：打开页面并执行一段表达式，打印结果。node scripts/probe.mjs <path> "<js>" [--dark]
import { chromium } from "@playwright/test";

const [, , path = "/", js = "document.title", ...flags] = process.argv;
const dark = flags.includes("--dark");
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  colorScheme: dark ? "dark" : "light",
});
page.on("pageerror", (e) => console.log("pageerror:", e.message));
await page.addInitScript(
  (d) =>
    localStorage.setItem(
      "folio.theme",
      JSON.stringify({ state: { mode: d ? "dark" : "light" }, version: 1 }),
    ),
  dark,
);
await page.goto((process.env.FOLIO_WEB ?? "http://localhost:5173") + path, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
console.log(JSON.stringify(await page.evaluate(js), null, 1));
await browser.close();
