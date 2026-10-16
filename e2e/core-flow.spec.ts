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

    // 提问（E2E 服务端接的是 e2e/fake-llm.ts 假模型，回答固定引用 [1]）
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

test.describe("引导与布局", () => {
  test("首页有上手引导、概览卡片，侧栏里有带文字的设置", async ({ page }) => {
    await page.goto("/");
    const guide = page.getByRole("region", { name: "开始使用 QuireNote" });
    await expect(guide).toBeVisible();
    // E2E 已配置假模型、示例 Notebook 自带资料：前两步完成，第三步待做。
    await expect(guide.getByText("已完成")).toHaveCount(2);
    // 概览卡片显示当前对话模型（E2E 接的是假模型）。
    await expect(page.getByText("fake-chat", { exact: true })).toBeVisible();
    // 设置在侧栏里是可展开的分组，展开后列出各分区。
    const sidebar = page.locator("aside");
    await sidebar.getByRole("button", { name: "设置" }).click();
    await sidebar.getByRole("link", { name: "模型与服务" }).click();
    await expect(page).toHaveURL(/\/settings\/models/);
  });

  test("工作区侧栏带名称、可收起，且没有多余的滚动条", async ({ page }) => {
    await page.goto("/");
    await page.getByText("人工智能简史").first().click();
    const sidebar = page.locator("aside");
    await expect(sidebar.getByRole("button", { name: "资料" })).toContainText("资料");
    await expect(sidebar.getByRole("button", { name: "设置" })).toBeVisible();
    await expect(page.locator(".dv-groupview").first()).toBeVisible();
    // dockview 的视图不应比容器大（以前主题 padding 会让整个工作区出现横竖滚动条）。
    const overflow = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".quirenote-dock .dv-view")].some(
        (v) => v.scrollWidth > v.clientWidth + 1 || v.scrollHeight > v.clientHeight + 1,
      ),
    );
    expect(overflow).toBe(false);
    await sidebar.getByRole("button", { name: "收起侧栏" }).click();
    await expect(sidebar.getByRole("button", { name: "资料" })).not.toContainText("资料");
    await sidebar.getByRole("button", { name: "展开侧栏" }).click();
  });
});

test.describe("阅读器：高亮与编辑资料", () => {
  test("选中或点击高亮都能改色、取消高亮；编辑资料后高亮跟着文字走，可恢复原文", async ({
    page,
    request,
  }) => {
    // 新建一份文本资料（API 直接创建，避免依赖拖拽选区）。
    const nb = await (await request.post("/api/notebooks", { data: { title: "E2E 编辑资料" } })).json();
    const src = await (
      await request.post(`/api/notebooks/${nb.id}/sources`, {
        data: {
          kind: "markdown",
          title: "学习方式",
          // 第二个高亮放在段落中间：选区端点落在高亮元素上时，偏移要算上它前面的文字。
          text: "# 学习方式\n\n监督学习使用标签。\n\n强化学习是与监督学习不同的另一大类方法，它依靠奖励来学习。",
        },
      })
    ).json();
    await expect
      .poll(async () => (await (await request.get(`/api/sources/${src.id}`)).json()).status)
      .toBe("ready");
    const text: string = (await (await request.get(`/api/sources/${src.id}/content`)).json()).text;
    for (const q of ["监督学习使用标签", "依靠奖励"]) {
      const start = text.indexOf(q);
      await request.post(`/api/sources/${src.id}/highlights`, { data: { start, end: start + q.length } });
    }

    await page.goto(`/n/${nb.id}`);
    await page.getByText("学习方式", { exact: true }).first().dblclick();
    const marks = page.locator("mark[data-hid]");
    await expect(marks).toHaveCount(2);

    // 高亮列表入口带文字，不显示数量（数字会打断阅读）
    await expect(page.getByRole("button", { name: "高亮", exact: true })).toBeVisible();

    // 选中已高亮的文字：工具栏标出当前颜色，并有「取消高亮」
    const selectMark = (text: string) =>
      marks.filter({ hasText: text }).evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
        el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      });
    await selectMark("依靠奖励");
    await expect(page.getByRole("button", { name: "当前颜色：黄色" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByRole("button", { name: "取消高亮" }).click();
    await expect(marks).toHaveCount(1);

    // 点击高亮也弹出同一个工具栏：改成绿色，仍然只有一条
    await marks.filter({ hasText: "监督学习使用标签" }).click();
    await page.getByRole("button", { name: "绿色高亮" }).click();
    await expect(marks).toHaveCount(1);
    await expect(marks.first()).toHaveClass(/hl-green/);
    // 在同一段上再高亮一次不会叠出重复的高亮
    await selectMark("监督学习使用标签");
    await expect(page.getByRole("button", { name: "当前颜色：绿色" })).toBeVisible();
    await page.getByRole("button", { name: "蓝色高亮" }).click();
    await expect(marks).toHaveCount(1);
    await expect(marks.first()).toHaveClass(/hl-blue/);

    // 编辑：开头加一段，Ctrl+S 保存
    await page.getByRole("button", { name: "编辑内容" }).click();
    const editor = page.getByRole("textbox", { name: "编辑内容" });
    await editor.press("Control+Home");
    await editor.pressSequentially("导读一句。\n\n");
    await editor.press("Control+s");
    await expect(page.getByText("已编辑")).toBeVisible();
    await expect(page.getByText("导读一句。")).toBeVisible({ timeout: 20_000 });
    await expect(marks.filter({ hasText: "监督学习使用标签" })).toHaveCount(1);

    // 恢复原文
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "恢复原文" }).click();
    await expect(page.getByText("导读一句。")).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByText("已编辑")).toHaveCount(0);
    await expect(marks.filter({ hasText: "监督学习使用标签" })).toHaveCount(1);
    await request.delete(`/api/notebooks/${nb.id}`);
  });
});

test.describe("移动端 @mobile", () => {
  test("底部导航切换面板", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("main").getByText("人工智能简史").first().click();
    await expect(page.getByRole("navigation")).toBeVisible();
    await page.getByRole("button", { name: "资料", exact: true }).click();
    await expect(page.getByText("深度学习革命笔记")).toBeVisible();
  });
});
