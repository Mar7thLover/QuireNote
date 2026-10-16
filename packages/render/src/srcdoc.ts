import type { CardTemplate, ThemeSettings } from "@quirenote/core";
import { type SanitizeOptions, sanitizeCss, sanitizeHtml } from "./sanitize";
import { renderTemplate } from "./template";

/**
 * 推荐的 iframe sandbox 属性：`<iframe sandbox={SANDBOX_ATTR} srcdoc={...}>`。
 *
 * 安全理由：
 * - 不带 `allow-scripts`，卡片内任何脚本（包括清洗遗漏的）都不会执行。`allow-same-origin` 的风险在于
 *   "脚本 + 同源" 可以拆掉沙箱，而没有脚本时同源无法被利用。
 * - 保留 `allow-same-origin` 是为了让宿主读取 `iframe.contentDocument` 的高度做自适应。
 * - 不带 `allow-forms` / `allow-popups` / `allow-top-navigation`：卡片不能提交表单、弹窗或劫持页面。
 * - 外部请求由 srcdoc 中的 CSP（`default-src 'none'`）阻断，只放行内联样式与 data: 图片/字体。
 */
export const SANDBOX_ATTR = "allow-same-origin";

export interface CspOptions {
  /** 允许 https: 远程图片（默认只允许 data:）。 */
  allowRemoteImages?: boolean;
}

/** 卡片 iframe 的 CSP。默认 `default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:`。 */
export function buildCsp({ allowRemoteImages = false }: CspOptions = {}): string {
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    allowRemoteImages ? "img-src data: https:" : "img-src data:",
    "font-src data:",
    // 以下两项不受 default-src 兜底，显式关闭
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

/** 宿主注入卡片的主题变量名。模板 CSS 应只用这些变量取色，深浅色才能跟随应用主题。 */
export const CARD_THEME_VARS = [
  "--card-bg",
  "--card-fg",
  "--card-muted",
  "--card-accent",
  "--card-border",
  "--card-radius",
  "--font-sans",
  "--font-serif",
  "--font-mono",
] as const;

export type CardThemeVars = Partial<Record<(typeof CARD_THEME_VARS)[number], string>> &
  Record<string, string>;

const SANS =
  '"Inter", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", system-ui, -apple-system, "Segoe UI", sans-serif';
const SERIF =
  '"Source Serif 4", "Noto Serif SC", "Songti SC", "STSong", "Source Han Serif SC", Georgia, serif';
const MONO = '"JetBrains Mono", "Cascadia Code", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';

export const defaultThemeSettings: ThemeSettings = {
  mode: "system",
  accent: "#5b5bd6",
  fontSans: SANS,
  fontSerif: SERIF,
  fontMono: MONO,
  radius: 12,
  density: "comfortable",
  background: { type: "none", value: "", opacity: 1 },
};

/** 默认卡片配色：浅色与深色同样精致，不依赖纯黑纯白。 */
export const defaultCardThemeVars: Record<"light" | "dark", CardThemeVars> = {
  light: {
    "--card-bg": "#fcfcfb",
    "--card-fg": "#1d1d1f",
    "--card-muted": "#6e6e73",
    "--card-accent": "#5b5bd6",
    "--card-border": "rgba(29, 29, 31, 0.1)",
    "--card-radius": "12px",
    "--font-sans": SANS,
    "--font-serif": SERIF,
    "--font-mono": MONO,
  },
  dark: {
    "--card-bg": "#1c1c1f",
    "--card-fg": "#ececef",
    "--card-muted": "#9b9ba3",
    "--card-accent": "#8b8cf0",
    "--card-border": "rgba(236, 236, 239, 0.12)",
    "--card-radius": "12px",
    "--font-sans": SANS,
    "--font-serif": SERIF,
    "--font-mono": MONO,
  },
};

/** 由全局主题设置得到卡片主题变量。`mode` 为 system 时由宿主解析出实际的 light / dark 传入。 */
export function cardThemeVars(
  settings: Partial<ThemeSettings> = defaultThemeSettings,
  resolvedMode: "light" | "dark" = "light",
): CardThemeVars {
  const base = defaultCardThemeVars[resolvedMode];
  const vars: CardThemeVars = { ...base };
  if (settings.accent) vars["--card-accent"] = settings.accent;
  if (settings.radius !== undefined) vars["--card-radius"] = `${settings.radius}px`;
  if (settings.fontSans) vars["--font-sans"] = settings.fontSans;
  if (settings.fontSerif) vars["--font-serif"] = settings.fontSerif;
  if (settings.fontMono) vars["--font-mono"] = settings.fontMono;
  return vars;
}

/** 只接受形如 `--name: value` 的安全变量，值经过 CSS 清洗且不能包含结构字符。 */
function themeVarsCss(vars: Readonly<Record<string, string>>): string {
  let out = "";
  for (const [name, raw] of Object.entries(vars)) {
    if (!/^--[a-zA-Z0-9_-]+$/.test(name)) continue;
    const value = String(raw);
    if (/[;{}<>\\]/.test(value)) continue;
    if (sanitizeCss(`${name}: ${value};`, { inline: true }).trim() === "") continue;
    out += `${name}: ${value};`;
  }
  return out;
}

const BASE_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{color-scheme:light dark;-webkit-text-size-adjust:100%;overflow:hidden}
html,body{margin:0;padding:0;background:transparent}
body{display:flow-root;padding:2px;font-family:var(--font-sans,system-ui,sans-serif);color:var(--card-fg,#1d1d1f);
font-size:15px;line-height:1.65;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;
font-kerning:normal;overflow-wrap:anywhere}
img{max-width:100%;height:auto}
`;

export interface SrcdocOptions extends SanitizeOptions, CspOptions {
  /** 宿主注入的主题变量（`cardThemeVars()` 的结果或自定义）。 */
  themeVars?: Readonly<Record<string, string>>;
  /** 文档语言，影响中文字形与断行；默认 zh-CN。 */
  lang?: string;
}

/** 渲染并清洗卡片正文（不含外层文档），用于预览或非 iframe 场景。 */
export function renderCardHtml(
  template: Pick<CardTemplate, "html">,
  vars: Readonly<Record<string, string>>,
  options: SanitizeOptions = {},
): string {
  return sanitizeHtml(renderTemplate(template.html, vars), options);
}

/**
 * 生成卡片 iframe 的完整 srcdoc：严格 CSP、主题变量、基础排版、模板 CSS 与清洗后的 HTML。
 * 变量先经模板转义，渲染结果再整体清洗一次（拦截通过变量拼出的 javascript: 链接等）。
 */
export function buildSrcdoc(
  template: Pick<CardTemplate, "html" | "css">,
  vars: Readonly<Record<string, string>>,
  options: SrcdocOptions = {},
): string {
  const csp = buildCsp(options);
  const body = renderCardHtml(template, vars, options);
  const css = sanitizeCss(template.css);
  const themeCss = themeVarsCss(options.themeVars ?? defaultCardThemeVars.light);
  const lang = /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(options.lang ?? "") ? options.lang : "zh-CN";
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><style>:root{${themeCss}}${BASE_CSS}</style><style>${css}</style></head><body>${body}</body></html>`;
}
