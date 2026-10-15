import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const pdf = fileURLToPath(new URL("./fixtures/transformer.pdf", import.meta.url));

test.describe("核心流程", () => {
  test("导入 PDF → 提问 → 点引用跳转高亮 → 存为卡片", async ({ page }) => {
    await page.goto("/");

    // 新建 Notebook
    await page.getByRole("button", { name: "新建 Notebook" }).first().click();
    await page.getByPlaceholder("Notebook 标题").fill("E2E 测试");
    await page.getByRole("button", { name: "新建", exact: true }).click();
    await expect(page).toHaveURL(/\/n\/nb_/);

    // 导入 PDF
    await page.getByRole("button", { name: "添加", exact: true }).first().click();
    await page.locator('input[type="file"]').last().setInputFiles(pdf);
    const row = page.getByText("transformer", { exact: true });
    await expect(row).toBeVisible();
    await expect(page.getByText(/PDF · 2 页/)).toBeVisible({ timeout: 30_000 });

    // 提问（默认使用内置 local 模型，无需 Key）
    const input = page.locator("[data-chat-input]");
    await input.fill("What did the Transformer remove?");
    await input.press("Enter");

    // 回答中出现引用徽标
    const cite = page.locator("button.cite").first();
    await expect(cite).toBeVisible({ timeout: 30_000 });

    // 点击引用 → 阅读器打开并高亮原文
    await cite.click();
    await expect(page.locator(".hl-jump").first()).toBeVisible({ timeout: 10_000 });

    // 存为卡片
    await page.locator("button.cite").first().hover();
    await page.getByRole("button", { name: "存为卡片" }).first().click();
    await expect(page.getByText("已存为卡片")).toBeVisible();

    // 卡片出现在笔记列表里
    await page.getByRole("button", { name: "笔记" }).first().click();
    await expect(page.getByText("卡片", { exact: true }).first()).toBeVisible();
  });

  test("命令面板可用键盘打开并跳转", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Control+K");
    await expect(page.getByPlaceholder("输入命令，或用自然语言描述要做的事…")).toBeVisible();
    await page.keyboard.type("人工智能");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/n\/nb_/);
  });
});

test.describe("移动端 @mobile", () => {
  test("底部导航切换面板", async ({ page }) => {
    await page.goto("/");
    await page.getByText("人工智能简史").first().click();
    await expect(page.getByRole("navigation")).toBeVisible();
    await page.getByRole("button", { name: "资料", exact: true }).click();
    await expect(page.getByText("深度学习革命笔记")).toBeVisible();
  });
});
