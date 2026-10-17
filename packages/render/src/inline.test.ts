// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderInlineHtml } from "./inline";

const tpl = (html: string, css = "") => ({ html, css });

describe("renderInlineHtml", () => {
  it("行内标签 + 安全样式直接渲染，变量转义", () => {
    const out = renderInlineHtml(
      tpl('<span style="color:var(--card-muted);font-style:italic">{{g1}}</span>'),
      {
        g1: "<b>递过</b>草药",
      },
    );
    expect(out).toBe(
      '<span style="color: var(--card-muted); font-style: italic">&lt;b&gt;递过&lt;/b&gt;草药</span>',
    );
  });

  it("去掉 class、事件属性、危险的 CSS 属性和值", () => {
    const out = renderInlineHtml(
      tpl(
        '<b class="fixed inset-0" onclick="x()" style="position:fixed;color:red;background-color:url(https://t/x.png);font-weight:700">x</b>',
      ),
      {},
    );
    expect(out).toBe('<b style="color: red; font-weight: 700">x</b>');
  });

  it("带 CSS、块级或未知标签的模板交给 iframe", () => {
    expect(renderInlineHtml(tpl("<span>x</span>", ".a{color:red}"), {})).toBeNull();
    expect(renderInlineHtml(tpl("<div>x</div>"), {})).toBeNull();
    expect(renderInlineHtml(tpl("<span><img src=x></span>"), {})).toBeNull();
    expect(renderInlineHtml(tpl("<details><summary>状态</summary>…</details>"), {})).toBeNull();
  });
});
