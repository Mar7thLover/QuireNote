/**
 * 模板 HTML / CSS 清洗。
 *
 * 清洗是纵深防御的一层：真正的边界是 sandbox iframe（无 allow-scripts）+ 严格 CSP。
 * 清洗保证即使模板被放进别的上下文（例如预览、导出）也不携带脚本或外部请求。
 */

/** 任何能把 HTML 解析成 Document 的对象，浏览器里就是 `new DOMParser()`。 */
export interface HtmlParser {
  parseFromString(html: string, type: "text/html"): Document;
}

export interface SanitizeOptions {
  /** 注入解析器；默认使用全局 `DOMParser`（浏览器或 jsdom 环境）。 */
  parser?: HtmlParser;
}

let defaultParser: HtmlParser | null = null;

/** 为没有全局 DOMParser 的环境（服务端）设置默认解析器，例如 `new JSDOM().window.DOMParser`。 */
export function setDefaultHtmlParser(parser: HtmlParser | null): void {
  defaultParser = parser;
}

export function resolveParser(options: SanitizeOptions): HtmlParser {
  if (options.parser) return options.parser;
  if (defaultParser) return defaultParser;
  const Ctor = (globalThis as { DOMParser?: new () => HtmlParser }).DOMParser;
  if (Ctor) return new Ctor();
  throw new Error("没有可用的 DOMParser：请通过 options.parser 或 setDefaultHtmlParser 注入解析器");
}

export function hasHtmlParser(options: SanitizeOptions = {}): boolean {
  try {
    resolveParser(options);
    return true;
  } catch {
    return false;
  }
}

/** 整个删除（连同子树）的元素。 */
const BLOCKED_TAGS = new Set([
  "script",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "link",
  "meta",
  "base",
  "form",
  "template",
  "noscript",
  "portal",
  "fencedframe",
  // SVG 动画可以在运行时改写 href
  "animate",
  "set",
  "animatemotion",
  "animatetransform",
  "handler",
  "listener",
]);

/** 值是 URL 的属性。 */
const URL_ATTRS = new Set([
  "href",
  "src",
  "xlink:href",
  "action",
  "formaction",
  "poster",
  "background",
  "cite",
  "longdesc",
  "lowsrc",
  "dynsrc",
  "data",
  "codebase",
  "manifest",
  "ping",
  "srcset",
  "imagesrcset",
]);

/** 直接删除的属性（会触发导航或加载）。 */
const BLOCKED_ATTRS = new Set(["srcdoc", "http-equiv", "formaction", "action", "ping", "is"]);

const SAFE_DATA_IMAGE =
  /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon|svg\+xml)[;,]/;

/** 浏览器解析 URL 前会去掉控制字符和空白；检测前做同样的归一化。 */
function normalizeUrl(value: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 有意去除控制字符
  return value.replace(/[\u0000- \u007f-\u009f]/g, "").toLowerCase();
}

/** 判断一个 URL 是否允许出现在模板里。远程 http(s) 地址保留，是否加载由 CSP 决定。 */
export function isSafeUrl(value: string): boolean {
  const url = normalizeUrl(value);
  if (url.startsWith("javascript:") || url.startsWith("vbscript:")) return false;
  if (url.startsWith("data:")) return SAFE_DATA_IMAGE.test(url);
  if (/^[a-z][a-z0-9+.-]*:/.test(url)) return /^(?:https?|mailto|tel):/.test(url);
  return true;
}

/** 按 HTML 规范的思路拆分 srcset：URL 是一段不含空白的字符（data: URL 里可以有逗号），之后是描述符。 */
function parseSrcset(value: string): { url: string; descriptor: string }[] {
  const out: { url: string; descriptor: string }[] = [];
  let i = 0;
  while (i < value.length) {
    while (i < value.length && /[\s,]/.test(value[i] ?? "")) i++;
    if (i >= value.length) break;
    let url = "";
    while (i < value.length && !/\s/.test(value[i] ?? "")) url += value[i++];
    let descriptor = "";
    if (url.endsWith(",")) {
      url = url.replace(/,+$/, "");
    } else {
      while (i < value.length && value[i] !== ",") descriptor += value[i++];
    }
    out.push({ url, descriptor: descriptor.trim() });
  }
  return out;
}

function sanitizeSrcset(value: string): string | null {
  const parts = parseSrcset(value);
  const ok = parts.filter((p) => isSafeUrl(p.url));
  if (ok.length === parts.length) return value;
  return ok.length > 0 ? ok.map((p) => (p.descriptor ? `${p.url} ${p.descriptor}` : p.url)).join(", ") : null;
}

function sanitizeElement(el: Element): void {
  for (const attr of [...el.attributes]) {
    const name = attr.name.toLowerCase();
    const value = attr.value;
    if (name.startsWith("on") || BLOCKED_ATTRS.has(name)) {
      el.removeAttribute(attr.name);
      continue;
    }
    if (name === "style") {
      const css = sanitizeCss(value, { inline: true });
      if (css.trim() === "") el.removeAttribute(attr.name);
      else if (css !== value) el.setAttribute(attr.name, css);
      continue;
    }
    if (name === "srcset" || name === "imagesrcset") {
      const next = sanitizeSrcset(value);
      if (next === null) el.removeAttribute(attr.name);
      else if (next !== value) el.setAttribute(attr.name, next);
      continue;
    }
    if (URL_ATTRS.has(name) || name.endsWith(":href")) {
      if (!isSafeUrl(value)) el.removeAttribute(attr.name);
      continue;
    }
    // 其他属性里出现脚本协议也一律删除（例如 SVG 的 values/to/from）
    const norm = normalizeUrl(value);
    if (norm.includes("javascript:") || norm.includes("vbscript:")) el.removeAttribute(attr.name);
  }
  if (el.localName === "style") {
    el.textContent = sanitizeCss(el.textContent ?? "");
  }
}

function parseFragment(html: string, options: SanitizeOptions): HTMLElement | null {
  // 显式的 <body> 让 <style>/<meta>/<link> 等留在片段里而不是被挪进 <head>
  const doc = resolveParser(options).parseFromString(
    `<!doctype html><html><head></head><body>${html}</body></html>`,
    "text/html",
  );
  return doc.body;
}

/** 只解析再序列化、不做任何清洗；用来判断清洗是否真的改动了内容。 */
export function serializeHtml(html: string, options: SanitizeOptions = {}): string {
  return parseFragment(html, options)?.innerHTML ?? "";
}

/**
 * 清洗一段 HTML 片段（模板渲染后的结果或模板源码），返回片段字符串。
 * 会删除危险元素、所有 on* 属性、javascript:/vbscript:/非图片 data: URL，并清洗内联与 `<style>` 中的 CSS。
 */
export function sanitizeHtml(html: string, options: SanitizeOptions = {}): string {
  const body = parseFragment(html, options);
  if (!body) return "";
  // 先删整棵危险子树，再处理剩余元素的属性
  for (const el of [...body.querySelectorAll("*")]) {
    if (BLOCKED_TAGS.has(el.localName.toLowerCase())) el.remove();
  }
  for (const el of [...body.querySelectorAll("*")]) sanitizeElement(el);
  return body.innerHTML;
}

// ───────────── CSS ─────────────

export interface CssSanitizeOptions {
  /** 内联 style 属性（只有声明，没有选择器与块）。 */
  inline?: boolean;
}

/** 把 CSS 拆成在 `;`、`{`、`}` 处结束的片段（忽略字符串与括号内部的分隔符）。 */
function splitCss(css: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  let quote: string | null = null;
  let depth = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 1;
    } else if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if ((ch === ";" && depth === 0) || ch === "{" || ch === "}") {
      chunks.push(css.slice(start, i + 1));
      start = i + 1;
      depth = 0;
    }
  }
  if (start < css.length) chunks.push(css.slice(start));
  return chunks;
}

/** 生成用于检测的归一化版本：去注释、解码 CSS 转义、去空白、小写。 */
function probeCss(chunk: string): string {
  return chunk
    .replace(/\/\*[\s\S]*?(\*\/|$)/g, "")
    .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex: string) => {
      const cp = Number.parseInt(hex, 16);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
    })
    .replace(/\\(.)/g, "$1")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function urlArgs(probe: string): string[] {
  const out: string[] = [];
  const re = /url\(([^)]*)\)?/g;
  for (let m = re.exec(probe); m; m = re.exec(probe)) out.push((m[1] ?? "").replace(/^["']|["']$/g, ""));
  return out;
}

function dangerousCss(chunk: string): boolean {
  const p = probeCss(chunk);
  if (p.includes("@import")) return true;
  if (p.includes("expression(")) return true;
  if (p.includes("javascript:") || p.includes("vbscript:")) return true;
  if (p.includes("-moz-binding") || p.includes("behavior:")) return true;
  if (/(?:^|[^a-z-])src\(/.test(p)) return true; // CSS src() 函数同样会发起请求
  for (const arg of urlArgs(p)) {
    if (arg.startsWith("#")) continue; // SVG 片段引用（滤镜、渐变）
    if (
      SAFE_DATA_IMAGE.test(arg) ||
      arg.startsWith("data:font/") ||
      arg.startsWith("data:application/font")
    ) {
      continue;
    }
    return true; // 指向外部（含相对路径）的 url()
  }
  if (p.includes("image-set(") && /image-set\([^)]*["'](?!data:)/.test(p)) return true;
  return false;
}

/**
 * 清洗 CSS：删除 `@import`、`expression()`、指向外部的 `url()`（只保留图片/字体 data: 和 `#片段`）、
 * 脚本协议与历史遗留的 binding/behavior。含危险内容的整条声明被删除。
 * 同时转义 `<`，避免 `</style>` 跳出样式块。
 */
export function sanitizeCss(css: string, options: CssSanitizeOptions = {}): string {
  let out = "";
  for (const chunk of splitCss(css)) {
    if (!dangerousCss(chunk)) {
      out += chunk;
      continue;
    }
    // 保留块结构：被删片段若以 { 结束（例如 @import 后面紧跟规则），只删除到 { 之前会破坏结构，
    // 因此整段替换为空并保留结束符号。
    const last = chunk[chunk.length - 1];
    if (last === "{") out += "@media not all {";
    else if (last === "}") out += "}";
  }
  out = out.replace(/</g, "\\3c ");
  return options.inline ? out.replace(/[{}]/g, "") : out;
}
