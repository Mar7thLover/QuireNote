import { type APIRequestContext, expect, type Locator, type Page, test } from "@playwright/test";

/** 右键菜单：不同位置弹出各自的实用操作；Shift+右键、空白处没有可用操作时是浏览器原生菜单。 */

const menu = (page: Page) => page.locator("[data-context-menu]").first();
const item = (page: Page, name: string | RegExp) => page.getByRole("menuitem", { name });
const rightClick = (l: Locator, opts: Parameters<Locator["click"]>[0] = {}) =>
  l.click({ button: "right", ...opts });

async function setup(request: APIRequestContext, title: string, withSource = true) {
  const nb = await (await request.post("/api/notebooks", { data: { title } })).json();
  if (withSource) {
    const src = await (
      await request.post(`/api/notebooks/${nb.id}/sources`, {
        data: {
          kind: "markdown",
          title: "学习方式",
          text: "# 学习方式\n\n监督学习使用标签。\n\n强化学习依靠奖励来学习。",
        },
      })
    ).json();
    await expect
      .poll(async () => (await (await request.get(`/api/sources/${src.id}`)).json()).status, {
        timeout: 30_000,
      })
      .toBe("ready");
    return { nb, src };
  }
  return { nb, src: null };
}

/** 在页面里选中一段文字（不触发工具栏），返回选区中心坐标。last：从最后一个匹配的区域找起。 */
async function selectText(page: Page, root: string, text: string, last = false) {
  return page.evaluate(
    ({ root, text, last }) => {
      const scopes = [...document.querySelectorAll(root)];
      if (last) scopes.reverse();
      for (const scope of scopes) {
        const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const i = n.textContent!.indexOf(text);
          if (i < 0) continue;
          const range = document.createRange();
          range.setStart(n, i);
          range.setEnd(n, i + text.length);
          const sel = window.getSelection()!;
          sel.removeAllRanges();
          sel.addRange(range);
          const r = range.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
      }
      throw new Error(`text not found: ${text}`);
    },
    { root, text, last },
  );
}

/** 右键一个块的行尾（落在选区外，光标移过去）。 */
async function rightClickLineEnd(page: Page, l: Locator) {
  const box = (await l.boundingBox())!;
  await page.mouse.click(box.x + box.width - 6, box.y + box.height / 2);
  await page.mouse.click(box.x + box.width - 6, box.y + box.height / 2, { button: "right" });
}

test.describe("右键菜单", () => {
  test("资料与笔记：右键重命名、置顶；空白处新建；标签页关闭其他；Esc 与 Shift+右键", async ({
    page,
    request,
  }) => {
    const { nb, src } = await setup(request, "E2E 右键 列表");
    const note = await (
      await request.post(`/api/notebooks/${nb.id}/notes`, { data: { title: "第一条笔记", markdown: "内容" } })
    ).json();
    await page.goto(`/n/${nb.id}`);

    // 资料行
    const row = page.getByText("学习方式", { exact: true }).first();
    await rightClick(row);
    await expect(menu(page)).toBeVisible();
    for (const name of ["只针对这份资料提问", "用于回答", "只勾选这一份", "AI 标注重点", "重命名", "删除"])
      await expect(item(page, name)).toBeVisible();
    page.once("dialog", (d) => d.accept("学习方法"));
    await item(page, "重命名").click();
    await expect(page.getByText("学习方法", { exact: true }).first()).toBeVisible();
    await expect
      .poll(async () => (await (await request.get(`/api/sources/${src!.id}`)).json()).title)
      .toBe("学习方法");

    // Esc 关闭；Shift+右键交给浏览器，不弹自己的菜单
    await rightClick(page.getByText("学习方法", { exact: true }).first());
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-context-menu]")).toHaveCount(0);
    await rightClick(page.getByText("学习方法", { exact: true }).first(), { modifiers: ["Shift"] });
    await expect(page.locator("[data-context-menu]")).toHaveCount(0);

    // 资料面板空白处：区域菜单（添加、联网搜索、全选）
    const srcArea = page
      .getByText("全选", { exact: true })
      .locator("xpath=ancestor::div[contains(@class,'h-full') and contains(@class,'flex-col')][1]");
    const srcBox = (await srcArea.boundingBox())!;
    await page.mouse.click(srcBox.x + 40, srcBox.y + srcBox.height - 30, { button: "right" });
    await expect(item(page, /^添加资料/)).toBeVisible();
    await expect(item(page, "重命名")).toHaveCount(0);
    await page.keyboard.press("Escape");

    // 笔记行：置顶
    await page.locator(".dv-tab", { hasText: "笔记" }).click();
    await rightClick(page.getByRole("button", { name: /第一条笔记/ }));
    await item(page, "置顶").click();
    await expect
      .poll(async () => (await (await request.get(`/api/notes/${note.id}`)).json()).pinned)
      .toBe(true);

    // 笔记面板空白处：区域菜单
    const notesArea = page
      .getByPlaceholder("搜索")
      .locator("xpath=ancestor::div[contains(@class,'h-full') and contains(@class,'flex-col')][1]");
    const box = (await notesArea.boundingBox())!;
    await page.mouse.click(box.x + 40, box.y + box.height - 30, { button: "right" });
    await expect(item(page, "新建笔记")).toBeVisible();
    await expect(item(page, "置顶")).toHaveCount(0);
    await page.keyboard.press("Escape");

    // 标签页：关闭其他
    await rightClick(page.locator(".dv-tab", { hasText: "笔记" }));
    await item(page, "关闭其他标签").click();
    await expect(page.locator(".dv-tab", { hasText: "资料" })).toHaveCount(0);
    await expect(page.locator(".dv-tab", { hasText: "笔记" })).toHaveCount(1);

    await request.delete(`/api/notebooks/${nb.id}`);
  });

  test("编辑器：选中文字加粗、插入表格并加行、转换为标题、粘贴", async ({ page, request, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const { nb } = await setup(request, "E2E 右键 编辑器", false);
    const note = await (
      await request.post(`/api/notebooks/${nb.id}/notes`, {
        data: { title: "编辑器测试", markdown: "第一段文字" },
      })
    ).json();
    await page.goto(`/n/${nb.id}?note=${note.id}`);
    const editor = page.locator(".tiptap");
    await expect(editor).toContainText("第一段文字");

    // 选中「第一段」→ 右键 → 格式 → 加粗
    await editor.click();
    const at = await selectText(page, ".tiptap", "第一段");
    await page.mouse.click(at.x, at.y, { button: "right" });
    for (const name of [/^剪切/, /^复制/, /^粘贴/, "AI", "询问 AI", "格式"])
      await expect(item(page, name).first()).toBeVisible();
    await item(page, "格式").hover();
    await item(page, /^加粗/).click();
    await expect(editor.locator("strong")).toHaveText("第一段");

    // 段落里右键 → 转换为 → 标题 2
    const p = editor.locator("p", { hasText: "第一段文字" });
    await rightClick(p, { position: { x: 4, y: 8 } });
    await item(page, "转换为").hover();
    await item(page, "标题 2").click();
    await expect(editor.locator("h2")).toContainText("第一段文字");

    // 插入表格，再在单元格里右键加一行
    await rightClickLineEnd(page, editor.locator("h2"));
    await item(page, "插入").hover();
    await item(page, "表格").click();
    await expect(editor.locator("table tr")).toHaveCount(3);
    await rightClick(editor.locator("table td").first());
    await item(page, "表格").hover();
    await item(page, "在下方插入行").click();
    await expect(editor.locator("table tr")).toHaveCount(4);

    // 粘贴：读剪贴板，插到光标处
    await page.evaluate(() => navigator.clipboard.writeText("从剪贴板来的一句话"));
    await rightClickLineEnd(page, editor.locator("h2"));
    await item(page, /^粘贴(?!为)/).click();
    await expect(editor).toContainText("从剪贴板来的一句话");

    // 保存后的 Markdown 里有表格和加粗
    await expect
      .poll(async () => (await (await request.get(`/api/notes/${note.id}`)).json()).markdown, {
        timeout: 10_000,
      })
      .toMatch(/\*\*第一段\*\*[\s\S]*\|/);
    await request.delete(`/api/notebooks/${nb.id}`);
  });

  test("阅读器：右键选中文字高亮为绿色，右键高亮取消", async ({ page, request }) => {
    const { nb } = await setup(request, "E2E 右键 阅读器");
    await page.goto(`/n/${nb.id}`);
    await rightClick(page.getByText("学习方式", { exact: true }).first());
    await item(page, "打开").click();
    await expect(page.getByText("监督学习使用标签。")).toBeVisible();

    const at = await selectText(page, "[data-source]", "监督学习");
    await page.mouse.click(at.x, at.y, { button: "right" });
    for (const name of ["询问 AI", "解释", "高亮", "批注…", "摘录为卡片", "复制为引用"])
      await expect(item(page, name)).toBeVisible();
    // 右键不会再弹出划词工具栏
    await expect(page.locator("[data-toolbar]")).toHaveCount(0);
    await item(page, "高亮").hover();
    await item(page, "绿色").click();
    const mark = page.locator("mark[data-hid]");
    await expect(mark).toHaveCount(1);
    await expect(mark).toHaveClass(/hl-green/);
    await expect(mark).toHaveText("监督学习");

    await rightClick(mark);
    await expect(item(page, "改颜色")).toBeVisible();
    await item(page, "取消高亮").click();
    await expect(mark).toHaveCount(0);

    // 阅读区空白处：面板级操作
    await rightClick(page.locator("[data-source]").first(), { position: { x: 2, y: 2 } });
    await expect(item(page, "AI 标注重点")).toBeVisible();
    await expect(item(page, "复制全文")).toBeVisible();
    await page.keyboard.press("Escape");
    await request.delete(`/api/notebooks/${nb.id}`);
  });

  test("对话：右键回答存为卡片、选中文字引用提问、引用徽标看出处；输入框右键粘贴", async ({
    page,
    request,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const { nb } = await setup(request, "E2E 右键 对话");
    await page.goto(`/n/${nb.id}`);
    const input = page.locator("[data-chat-input]");

    // 输入框右键粘贴
    await page.evaluate(() => navigator.clipboard.writeText("监督学习用什么？"));
    await rightClick(input);
    for (const name of [/^剪切/, /^复制/, /^粘贴/, /^全选/]) await expect(item(page, name)).toBeVisible();
    await item(page, /^粘贴/).click();
    await expect(input).toHaveValue("监督学习用什么？");
    await input.press("Enter");

    const cite = page.locator("button.cite").first();
    await expect(cite).toBeVisible({ timeout: 30_000 });
    // 等回答写完（流式结束后才有「重新生成」按钮）
    await expect(page.getByRole("button", { name: "重新生成" })).toBeVisible();
    const answer = page.locator(".prose-serif").last();

    // 回答上右键
    await rightClick(answer);
    for (const name of ["复制这条消息", "引用回复", "重新生成", "存为卡片", "存为笔记"])
      await expect(item(page, name)).toBeVisible();
    await item(page, "存为卡片").click();
    await expect(page.getByText("已存为卡片")).toBeVisible();

    // 选中回答里的一段 → 询问 AI：作为引用放进输入框
    const at = await selectText(page, ".prose-serif", "根据资料", true);
    await page.mouse.click(at.x, at.y, { button: "right" });
    await item(page, "询问 AI").click();
    await expect(page.locator("[data-chat-input]")).toBeFocused();

    // 引用徽标：查看出处
    await rightClick(cite);
    await item(page, "查看出处").click();
    await expect(page.locator(".hl-jump").first()).toBeVisible({ timeout: 10_000 });
    await request.delete(`/api/notebooks/${nb.id}`);
  });
});
