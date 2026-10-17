/**
 * 行内模板：只含行内标签和安全 style 的模板（例如酒馆正则里常见的「给对白、动作描写上色」）
 * 直接渲染在正文里，跟着文字换行，不打断段落和列表。其余模板仍放进沙箱 iframe。
 *
 * 这里不靠 iframe 隔离，所以只放行很窄的一组：行内标签、少数排版类 CSS 属性、不含 url() 的值；
 * class 和其他属性一律去掉（避免借用页面自己的样式类盖住界面）。
 */
import type { CardTemplate } from "@quirenote/core";
import { resolveParser, type SanitizeOptions } from "./sanitize";
import { renderTemplate } from "./template";

const INLINE_TAGS = new Set([
  "span",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "del",
  "ins",
  "mark",
  "small",
  "sub",
  "sup",
  "code",
  "kbd",
  "q",
  "abbr",
  "br",
  "ruby",
  "rt",
  "rp",
]);

const STYLE_PROPS = new Set([
  "color",
  "background-color",
  "font-style",
  "font-weight",
  "font-family",
  "font-size",
  "font-variant",
  "text-decoration",
  "text-decoration-line",
  "text-decoration-color",
  "text-decoration-style",
  "text-underline-offset",
  "letter-spacing",
  "opacity",
  "border",
  "border-bottom",
  "border-color",
  "border-style",
  "border-width",
  "border-radius",
  "padding",
  "padding-left",
  "padding-right",
  "margin-left",
  "margin-right",
  "text-shadow",
  "white-space",
  "vertical-align",
]);

/** 只保留白名单里的属性；值里出现 url()、expression、反斜杠转义等就整条丢弃。 */
function cleanStyle(style: string): string {
  const out: string[] = [];
  for (const decl of style.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const value = decl.slice(i + 1).trim();
    if (!STYLE_PROPS.has(prop) || !value) continue;
    if (/url\s*\(|image-set|expression|@import|javascript:|\\|[<>]/i.test(value)) continue;
    out.push(`${prop}: ${value}`);
  }
  return out.join("; ");
}

/**
 * 模板能否、以及如何在正文里行内渲染。可以时返回清洗后的 HTML，否则返回 null（交给 iframe）。
 * 模板带 CSS、用了块级或未知标签时都不算行内。
 */
export function renderInlineHtml(
  template: Pick<CardTemplate, "html" | "css">,
  vars: Readonly<Record<string, string>>,
  options: SanitizeOptions = {},
): string | null {
  if (template.css.trim()) return null;
  const html = renderTemplate(template.html, vars).trim();
  if (!html || html.length > 4000) return null;
  const body = resolveParser(options).parseFromString(
    `<!doctype html><body>${html}</body>`,
    "text/html",
  ).body;
  if (!body) return null;
  for (const el of [...body.querySelectorAll("*")]) {
    if (!INLINE_TAGS.has(el.localName.toLowerCase())) return null;
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name === "style") {
        const style = cleanStyle(attr.value);
        if (style) el.setAttribute("style", style);
        else el.removeAttribute("style");
      } else if (name !== "title" && name !== "lang" && name !== "dir") {
        el.removeAttribute(attr.name);
      }
    }
  }
  return body.innerHTML;
}
