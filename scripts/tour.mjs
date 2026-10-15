// 关键界面巡检截图：node scripts/tour.mjs [--dark] [--only=name]
// 依赖已运行的 web（FOLIO_WEB，默认 5173）和 server；截图存到 e2e/.screens/tour-*.png
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const dark = process.argv.includes("--dark");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const base = process.env.FOLIO_WEB ?? "http://localhost:5173";
const api = process.env.FOLIO_API ?? "http://localhost:8790/api";
mkdirSync("e2e/.screens", { recursive: true });

const nbs = await (await fetch(`${api}/notebooks`)).json();
const nb = nbs.find((n) => n.title === "人工智能简史") ?? nbs[0];

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: dark ? "dark" : "light",
  locale: "zh-CN",
});
await ctx.addInitScript((d) => {
  localStorage.setItem("folio.theme", JSON.stringify({ state: { mode: d ? "dark" : "light" }, version: 1 }));
  for (const k of Object.keys(localStorage)) if (k.startsWith("folio.layout.")) localStorage.removeItem(k);
}, dark);
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("pageerror:", e.message));
const suffix = dark ? "-dark" : "";
const shot = async (name) => {
  await page.waitForTimeout(500);
  await page.screenshot({ path: `e2e/.screens/tour-${name}${suffix}.png` });
  console.log("saved", name + suffix);
};
const want = (n) => !only || only === n;

await page.goto(`${base}/n/${nb.id}`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);

if (want("chat")) {
  const input = page.locator("[data-chat-input]");
  await input.fill("Transformer 和规模定律分别带来了什么改变？");
  await input.press("Enter");
  await page.locator("button.cite").first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  await page.locator("button.cite").first().click();
  await page.locator(".hl-jump").first().waitFor({ timeout: 10000 });
  await shot("chat-reader");
}

if (want("editor")) {
  await page.getByRole("button", { name: "笔记", exact: true }).first().click();
  await page.getByText("三次浪潮的共同模式").first().click();
  await page.locator(".tiptap").first().waitFor();
  await page.locator(".tiptap").first().click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/");
  await page.waitForTimeout(400);
  await shot("editor-slash");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+Z");
  await page.keyboard.press("Control+Z");
  // 选中一段文字，显示 AI 气泡菜单
  await page.locator(".tiptap li").first().dblclick();
  await page.waitForTimeout(400);
  await shot("editor-bubble");
}

if (want("agent")) {
  await page.keyboard.press("Control+K");
  await page.keyboard.type("把这几条笔记合并成一份对比表");
  await page.waitForTimeout(300);
  await page.keyboard.press("Enter");
  await page.getByText("AI 改动预览").waitFor({ timeout: 30000 });
  await shot("agent-diff");
  await page.keyboard.press("Escape");
}

if (want("palette")) {
  await page.keyboard.press("Control+K");
  await page.keyboard.type("把这几条笔记合并成一份对比表");
  await shot("palette");
  await page.keyboard.press("Escape");
}

for (const [kind, label] of [
  ["mindmap", "思维导图"],
  ["flashcards", "闪卡"],
  ["quiz", "测验"],
  ["timeline", "时间线"],
  ["table", "数据表格"],
  ["slides", "幻灯片"],
  ["report", "报告"],
  ["audio", "音频概览"],
]) {
  if (!want(kind) && !want("studio")) continue;
  await page
    .getByText(new RegExp(`^${label}：`))
    .first()
    .click();
  await page.waitForTimeout(1200);
  await shot(`artifact-${kind}`);
}

for (const [kind, label] of [
  ["elements", "元素"],
  ["database", "数据库"],
  ["review", "复习"],
  ["search", "联网搜索"],
]) {
  if (!want(kind) && !want("panels")) continue;
  await page.getByRole("button", { name: label, exact: true }).first().click();
  await page.waitForTimeout(1000);
  await shot(`panel-${kind}`);
}

for (const sec of ["appearance", "models", "templates", "rules", "data"]) {
  if (!want(sec) && !want("settings")) continue;
  await page.goto(`${base}/settings/${sec}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await shot(`settings-${sec}`);
}

await browser.close();
