// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { builtinTemplates } from "./builtin/templates";
import { isSafeUrl, sanitizeCss, sanitizeHtml, serializeHtml } from "./sanitize";
import { buildCsp, buildSrcdoc, cardThemeVars, defaultThemeSettings, SANDBOX_ATTR } from "./srcdoc";

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

describe("sanitizeHtml", () => {
  it("删除危险元素", () => {
    const dirty = `<p>ok</p><script>alert(1)</script><iframe src="https://x"></iframe><object data="x"></object>
<embed src="x"><link rel="stylesheet" href="https://x/a.css"><meta http-equiv="refresh" content="0;url=https://x">
<base href="https://evil/"><form action="https://x"><input name="a"></form><template><script>x</script></template>
<svg><script>alert(1)</script><animate attributeName="href" to="javascript:alert(1)"/></svg><noscript>n</noscript>`;
    const doc = parse(sanitizeHtml(dirty));
    for (const tag of [
      "script",
      "iframe",
      "object",
      "embed",
      "link",
      "meta",
      "base",
      "form",
      "input",
      "template",
      "animate",
      "noscript",
    ]) {
      expect(doc.querySelector(tag), tag).toBeNull();
    }
    expect(doc.querySelector("p")?.textContent).toBe("ok");
  });

  it("删除所有 on* 属性（不分大小写）", () => {
    const out = sanitizeHtml(
      `<img src="data:image/png;base64,AA" onerror="alert(1)" ONLOAD="x"><div onclick="y" class="c">t</div>`,
    );
    expect(out).not.toMatch(/on(error|load|click)/i);
    expect(out).toContain('class="c"');
    expect(out).toContain('src="data:image/png;base64,AA"');
  });

  it("删除 javascript: / vbscript: / 非图片 data: 链接，保留安全链接", () => {
    const html = [
      '<a id="a1" href="javascript:alert(1)">1</a>',
      '<a id="a2" href=" jav&#x09;ascript:alert(1)">2</a>',
      '<a id="a3" href="JaVaScRiPt:alert(1)">3</a>',
      '<a id="a4" href="vbscript:msgbox">4</a>',
      '<a id="a5" href="data:text/html,<script>alert(1)</script>">5</a>',
      '<img id="i1" src="data:image/svg+xml;base64,AA">',
      '<a id="a6" href="https://example.com">6</a>',
      '<img id="i2" srcset="data:image/png;base64,AA 1x, javascript:alert(1) 2x">',
      '<svg><a id="s1" xlink:href="javascript:alert(1)"><text>x</text></a></svg>',
    ].join("");
    const doc = parse(sanitizeHtml(html));
    for (const id of ["a1", "a2", "a3", "a4", "a5"])
      expect(doc.getElementById(id)?.hasAttribute("href"), id).toBe(false);
    expect(doc.getElementById("i1")?.getAttribute("src")).toBe("data:image/svg+xml;base64,AA");
    expect(doc.getElementById("a6")?.getAttribute("href")).toBe("https://example.com");
    expect(doc.getElementById("i2")?.getAttribute("srcset")).toBe("data:image/png;base64,AA 1x");
    expect(doc.getElementById("s1")?.getAttributeNames()).toEqual(["id"]);
  });

  it("清洗内联 style 和 <style> 元素", () => {
    const out = sanitizeHtml(
      `<div style="color:red;background:url(https://evil/x.png)">a</div><style>@import url(https://x);.a{color:blue}</style>`,
    );
    expect(out).toContain('style="color:red;"');
    expect(out).not.toContain("evil");
    expect(out).not.toContain("@import");
    expect(out).toContain(".a{color:blue}");
  });

  it("isSafeUrl", () => {
    expect(isSafeUrl("/relative.png")).toBe(true);
    expect(isSafeUrl("mailto:a@b.c")).toBe(true);
    expect(isSafeUrl("data:image/webp;base64,AA")).toBe(true);
    expect(isSafeUrl("data:application/pdf;base64,AA")).toBe(false);
    expect(isSafeUrl("\u0001javascript:x")).toBe(false);
    expect(isSafeUrl("file:///etc/passwd")).toBe(false);
  });

  it("内置模板在清洗前后不变（模板本身是安全的）", () => {
    for (const t of builtinTemplates) {
      expect(sanitizeHtml(t.html), t.id).toBe(serializeHtml(t.html));
      expect(sanitizeCss(t.css), t.id).toBe(t.css);
    }
  });
});

describe("sanitizeCss", () => {
  it("删除 @import、expression()、外部 url()", () => {
    const css = `@import "https://evil/a.css";
@import url(evil.css)
.a{width:expression(alert(1));color:red}
.b{background:url("https://evil/x.png") no-repeat;border:1px solid}
.c{background-image:url(data:image/png;base64,AA)}
.d{fill:url(#grad)}
.e{background:url(relative.png)}`;
    const out = sanitizeCss(css);
    expect(out).not.toMatch(/@import|expression|evil|relative\.png/);
    expect(out).toContain("color:red");
    expect(out).toContain("border:1px solid");
    expect(out).toContain("url(data:image/png;base64,AA)");
    expect(out).toContain("url(#grad)");
  });

  it("识别 CSS 转义和注释绕过", () => {
    expect(sanitizeCss(".a{background:\\75 rl(https://evil/x)}")).not.toContain("evil");
    expect(sanitizeCss(".a{width:expr/**/ession(alert(1))}")).not.toContain("alert");
    expect(sanitizeCss("@\\69mport 'x.css';.a{color:red}")).toBe(".a{color:red}");
    expect(sanitizeCss(".a{background:image-set('https://evil/x.png' 1x)}")).not.toContain("evil");
    expect(sanitizeCss("@font-face{font-family:x;src:url(https://evil/f.woff)}")).not.toContain("evil");
  });

  it("转义 < 防止跳出 <style>", () => {
    expect(sanitizeCss(".a{content:'</style><script>alert(1)</script>'}")).not.toContain("</style");
  });
});

describe("buildSrcdoc", () => {
  const template = {
    html: `<div class="x"><a href="{{link}}">{{label}}</a><p>{{body}}</p></div>`,
    css: `.x{color:var(--card-fg)}`,
  };

  it("包含严格 CSP meta，默认只允许内联样式与 data: 图片/字体", () => {
    const doc = parse(buildSrcdoc(template, { label: "a", body: "b", link: "#" }));
    const meta = doc.querySelector('meta[http-equiv="Content-Security-Policy"]');
    const csp = meta?.getAttribute("content") ?? "";
    expect(
      csp.startsWith("default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:"),
    ).toBe(true);
    expect(csp).not.toContain("script-src");
    expect(csp).not.toContain("https:");
    // CSP 必须是 head 里的第一个资源相关元素
    expect(doc.head.firstElementChild?.getAttribute("charset")).toBe("utf-8");
    expect(doc.head.children[1]).toBe(meta);
  });

  it("allowRemoteImages 时 img-src 加入 https:", () => {
    expect(buildCsp({ allowRemoteImages: true })).toContain("img-src data: https:");
    expect(buildSrcdoc(template, {}, { allowRemoteImages: true })).toContain("img-src data: https:");
  });

  it("变量中的 <script> 被转义，变量拼出的 javascript: 链接被清洗", () => {
    const html = buildSrcdoc(template, {
      label: "<script>alert(1)</script>",
      body: "<img src=x onerror=alert(1)>",
      link: "javascript:alert(1)",
    });
    const doc = parse(html);
    expect(doc.querySelectorAll("script")).toHaveLength(0);
    expect(doc.querySelectorAll("img")).toHaveLength(0);
    expect(doc.querySelector("a")?.textContent).toBe("<script>alert(1)</script>");
    expect(doc.querySelector("a")?.hasAttribute("href")).toBe(false);
    expect(doc.querySelector("p")?.textContent).toBe("<img src=x onerror=alert(1)>");
  });

  it("注入主题变量，拒绝不安全的变量名或值", () => {
    const html = buildSrcdoc(
      template,
      {},
      {
        themeVars: {
          "--card-bg": "#111",
          "--card-accent": "oklch(0.7 0.1 250)",
          "--evil": "red;} body{background:url(https://evil)",
          "--x": "url(https://evil/img.png)",
          color: "red",
        },
      },
    );
    expect(html).toContain("--card-bg: #111;");
    expect(html).toContain("--card-accent: oklch(0.7 0.1 250);");
    expect(html).not.toContain("evil");
    expect(html).not.toMatch(/[{;]color: red/);
  });

  it("cardThemeVars 根据主题设置与深浅色生成变量", () => {
    const dark = cardThemeVars({ ...defaultThemeSettings, accent: "#ff6600", radius: 6 }, "dark");
    expect(dark["--card-accent"]).toBe("#ff6600");
    expect(dark["--card-radius"]).toBe("6px");
    expect(dark["--card-bg"]).not.toBe(cardThemeVars(defaultThemeSettings, "light")["--card-bg"]);
    const html = buildSrcdoc(template, {}, { themeVars: dark });
    expect(html).toContain("--card-accent: #ff6600;");
  });

  it("所有内置模板用示例数据渲染后没有残留的模板标签", () => {
    for (const t of builtinTemplates) {
      const vars = Object.fromEntries(t.slots.map((s) => [s.name, s.sample]));
      const html = buildSrcdoc(t, vars);
      expect(html, t.id).not.toContain("{{");
      const doc = parse(html);
      expect(doc.body.textContent?.trim().length, t.id).toBeGreaterThan(0);
    }
  });

  it("SANDBOX_ATTR 不允许脚本", () => {
    expect(SANDBOX_ATTR).toBe("allow-same-origin");
    expect(SANDBOX_ATTR).not.toContain("allow-scripts");
  });
});
