import { describe, expect, it } from "vitest";
import { escapeHtml, renderTemplate, splitList, templateVariables } from "./template";

describe("renderTemplate", () => {
  it("变量输出做 HTML 转义，<script> 不会成为标签", () => {
    const out = renderTemplate("<p>{{x}}</p>", { x: '<script>alert("x")</script>' });
    expect(out).toBe("<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>");
    expect(out).not.toContain("<script");
  });

  it("属性里的变量不能闭合引号", () => {
    const out = renderTemplate('<a title="{{t}}">x</a>', { t: '" onmouseover="alert(1)' });
    expect(out).toBe('<a title="&quot; onmouseover&#61;&quot;alert(1)">x</a>');
  });

  it("三重花括号也转义", () => {
    expect(renderTemplate("{{{x}}}", { x: "<b>" })).toBe("&lt;b&gt;");
  });

  it("{{var|default}} 在变量缺失或为空白时使用默认值", () => {
    expect(renderTemplate("{{a|默认}}·{{b|默认}}·{{ c | 有 空格 }}", { a: "值", b: "  " })).toBe(
      "值·默认·有 空格",
    );
    expect(renderTemplate("{{d|<i>}}", {})).toBe("&lt;i&gt;");
  });

  it("#if / else，支持嵌套", () => {
    const tpl = "{{#if a}}A{{#if b}}B{{else}}-{{/if}}{{else}}none{{/if}}";
    expect(renderTemplate(tpl, { a: "1", b: "1" })).toBe("AB");
    expect(renderTemplate(tpl, { a: "1" })).toBe("A-");
    expect(renderTemplate(tpl, { a: "   " })).toBe("none");
  });

  it("#each 用 || 拆分列表，{{.}} 取当前项，外层变量仍可访问", () => {
    const tpl = "<ul>{{#each items}}<li>{{.}}/{{tag}}</li>{{/each}}</ul>";
    expect(renderTemplate(tpl, { items: " 一 || 二||||<三>", tag: "t" })).toBe(
      "<ul><li>一/t</li><li>二/t</li><li>&lt;三&gt;/t</li></ul>",
    );
    expect(renderTemplate(tpl, { items: "" })).toBe("<ul></ul>");
  });

  it("#each 中 {{.0}} {{.1}} 取 :: 分隔的部分，可与 #if 组合", () => {
    const tpl = "{{#each e}}[{{#if .1}}{{.0}}={{.1}}{{else}}{{.}}{{/if}}]{{/each}}";
    expect(renderTemplate(tpl, { e: "1950::图灵||无日期" })).toBe("[1950=图灵][无日期]");
  });

  it("容忍不完整或未知的标签", () => {
    expect(renderTemplate("a {{#if x}}b", { x: "1" })).toBe("a b");
    expect(renderTemplate("a {{/each}} {{! 注释 }}c {{", {})).toBe("a  c {{");
  });

  it("templateVariables 列出模板用到的变量", () => {
    expect(templateVariables("{{a}}{{#if b}}{{c|x}}{{/if}}{{#each d}}{{.}}{{/each}}").sort()).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("escapeHtml 与 splitList", () => {
    expect(escapeHtml(`&<>"'\`=`)).toBe("&amp;&lt;&gt;&quot;&#39;&#96;&#61;");
    expect(splitList("a|| b ||")).toEqual(["a", "b"]);
  });
});
