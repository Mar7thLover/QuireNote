# @folio/render

正则规则引擎 + 沙箱卡片模板渲染。框架无关，不依赖 React。

## 渲染流程

```ts
import RegexWorker from "@folio/render/worker?worker";
import {
  SANDBOX_ATTR,
  buildSrcdoc,
  builtinRules,
  builtinTemplates,
  cardThemeVars,
  createRuleRunner,
} from "@folio/render";

// 1. 正则在 Web Worker 里执行，单条规则超时后 worker 会被 terminate 并重建，这条规则被跳过
const runner = createRuleRunner({ createWorker: () => new RegexWorker(), timeoutMs: 300 });
const { segments, errors } = await runner.run(markdown, [...builtinRules, ...userRules], { scope: "chat" });

// 2. text 段照常渲染；card 段放进沙箱 iframe
const themeVars = cardThemeVars(themeSettings, resolvedMode); // 深浅色跟随应用主题
for (const seg of segments) {
  if (seg.type === "card") {
    const template = templates.get(seg.templateId);
    // <iframe sandbox={SANDBOX_ATTR} srcdoc={buildSrcdoc(template, seg.vars, { themeVars })} />
  }
}
```

`errors` 中的每一项为 `{ ruleId, ruleName, kind: "invalid-pattern" | "timeout" | "worker-error", message }`，出错的规则会被跳过，其他规则照常执行。

iframe 高度自适应：`SANDBOX_ATTR` 是 `"allow-same-origin"`（不带 `allow-scripts`），宿主可以读取 `iframe.contentDocument.documentElement.scrollHeight`。
没有脚本时同源权限无法被利用；外部请求会被 srcdoc 内的 CSP 拦截。

## 规则

`RenderRule`（定义见 `@folio/core`）按 `order` 升序执行，只执行 `enabled` 且 `scopes` 包含当前作用域的规则。

- `templateId` 为 `null`：纯文本替换，`replacement` 支持 `$1`、`$<name>`、`$&`、`$$`。
- 有 `templateId`：匹配到的内容替换成 `card` 段。命名捕获组直接作为变量名；`slots` 把组号（或组名）映射成变量名，例如 `{ "1": "term" }`。变量值会去掉首尾空白。
- 前面的规则已经产出的 card 段，后面的规则不会再处理。
- 没有 `g` 标志时只替换整段文本中的第一处匹配。

`applyRulesSync` 是同步版，**只用于测试和服务端可信场景**。
`analyzePattern(pattern, flags)` 静态检测 ReDoS 风险（嵌套量词、重叠交替、相邻重叠量词、超大重复次数），返回 `risk` 和带位置的 `issues`，供编辑器提示。

## 模板语法（mustache 子集）

| 语法 | 说明 |
| --- | --- |
| `{{var}}` | HTML 转义输出（不支持非转义输出） |
| `{{var\|默认值}}` | 变量为空时输出默认值 |
| `{{#if var}}…{{else}}…{{/if}}` | 变量去掉首尾空白后非空即为真 |
| `{{#each list}}…{{/each}}` | `list` 用 `\|\|` 分隔，循环内用 `{{.}}` 取当前项 |
| `{{.0}}` `{{.1}}` | 扩展语法：当前项按 `::` 拆分后的第 1、2 部分 |

模板渲染完成后会对整段结果做清洗（`sanitizeHtml`），清洗内容包括：

- 删除 `script` / `iframe` / `object` / `embed` / `link` / `meta` / `base` / `form` / `template` / SVG 动画元素；
- 删除所有 `on*` 属性；
- 删除 `javascript:` / `vbscript:` 链接，以及非图片的 `data:` 链接；
- 删除 CSS 中的 `@import`、`expression()` 和指向外部的 `url()`。

清洗依赖 DOMParser。服务端可以用 `setDefaultHtmlParser(new JSDOM().window.DOMParser())` 注入，或者通过 `options.parser` 传入。

模板只应通过以下主题变量取色：`--card-bg`、`--card-fg`、`--card-muted`、`--card-accent`、`--card-border`、`--card-radius`、`--font-sans`、`--font-serif`、`--font-mono`。

## 内置模板与规则

| 模板 | 规则写法（`｜` 和 `\|` 都可以，`：` 和 `:` 都可以） |
| --- | --- |
| 知识卡 `builtin.knowledge` | `【知识：标题｜正文｜要点\|\|要点】`、`【要点：标题｜a\|\|b】` |
| 术语卡 `builtin.term` | `【术语：名称｜定义｜别名(可选)】` |
| 对比卡 `builtin.compare` | `【对比：A｜B｜A要点\|\|…｜B要点\|\|…】` |
| 时间线卡 `builtin.timeline` | `【时间线：标题(可选)｜1950::事件\|\|1956::事件】` |
| 引用卡 `builtin.quote` | `【引用：内容｜出处(可选)】` |
| 要点 / 提示卡 `builtin.callout` | 行首 `> [!tip] 内容`（还支持 note / important / warning / caution） |
| 数据卡 `builtin.stat` | `【数据：数值｜说明｜备注(可选)】` |

`builtinRuleSamples` 给出了每条内置规则的示例文本。

## `.folio-theme`

```ts
const text = exportTheme({ name, author, theme, templates, rules }); // 不导出内置模板
const res = importTheme(text, { existingTemplateIds, existingRuleIds, onConflict: "rename" });
if (res.ok) {
  res.theme;
  res.warnings;
  res.renamed;
} else {
  res.error;
  res.issues;
}
```

导入时会做以下处理：

- 用 zod 校验文件内容；
- 清洗模板（有改动时给出警告）；
- 处理 id 冲突，`onConflict` 可选 `rename`（默认，改名为 `id-2` 并同步更新规则对模板的引用）、`skip` 或 `replace`。与内置 id 冲突时总是改名。
- 禁用非法或有灾难性回溯风险的规则。

`defaultThemeSettings` 提供默认的全局主题设置。
