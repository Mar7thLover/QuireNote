import { type CardTemplate, QuireNoteTheme, type RenderRule, type ThemeSettings } from "@quirenote/core";
import { analyzePattern } from "./analyze";
import { BUILTIN_TEMPLATE_PREFIX, builtinTemplates } from "./builtin/templates";
import { hasHtmlParser, type SanitizeOptions, sanitizeCss, sanitizeHtml, serializeHtml } from "./sanitize";

export const THEME_FILE_EXTENSION = ".quirenote-theme";
export const THEME_FILE_MAX_BYTES = 1024 * 1024;

export interface ExportThemeInput {
  name: string;
  author?: string;
  theme?: Partial<ThemeSettings>;
  templates?: readonly CardTemplate[];
  rules?: readonly RenderRule[];
}

/**
 * 生成 `.quirenote-theme` 文件内容（格式化的 JSON）。内置模板不会被导出（导入方本来就有）。
 * 输入不符合 schema 时抛出异常。
 */
export function exportTheme({
  name,
  author = "",
  theme,
  templates = [],
  rules = [],
}: ExportThemeInput): string {
  const file = QuireNoteTheme.parse({
    format: "quirenote-theme",
    version: 1,
    name,
    author,
    ...(theme ? { theme } : {}),
    templates: templates.filter((t) => !t.builtin).map((t) => ({ ...t, builtin: false })),
    rules: rules.map((r) => ({ ...r })),
  });
  return `${JSON.stringify(file, null, 2)}\n`;
}

export type ConflictStrategy = "rename" | "replace" | "skip";

export interface ImportThemeOptions extends SanitizeOptions {
  /** 本地已有的模板 id（不含内置模板，内置 id 总是视为已占用）。 */
  existingTemplateIds?: Iterable<string>;
  /** 本地已有的规则 id。 */
  existingRuleIds?: Iterable<string>;
  /**
   * id 冲突时的处理方式，默认 rename：
   * - rename：改名为 `id-2`、`id-3`…，并同步更新文件内引用它的规则；
   * - replace：沿用原 id，由调用方覆盖本地同名条目；
   * - skip：丢弃冲突的条目。
   * 与内置模板 / 规则冲突时始终改名（内置条目不可覆盖）。
   */
  onConflict?: ConflictStrategy;
  maxBytes?: number;
}

export type ImportThemeResult =
  | {
      ok: true;
      theme: QuireNoteTheme;
      warnings: string[];
      /** 旧 id → 新 id。 */
      renamed: { templates: Record<string, string>; rules: Record<string, string> };
      /** 因冲突被跳过的 id（onConflict 为 skip 时）。 */
      skipped: { templates: string[]; rules: string[] };
      /** 需要覆盖本地条目的 id（onConflict 为 replace 时）。 */
      replaced: { templates: string[]; rules: string[] };
    }
  | { ok: false; error: string; issues: string[] };

const BUILTIN_RULE_PREFIX = "builtin.";

function uniqueId(base: string, taken: Set<string>): string {
  const stem = base.startsWith(BUILTIN_TEMPLATE_PREFIX)
    ? `imported.${base.slice(BUILTIN_TEMPLATE_PREFIX.length)}`
    : base;
  if (!taken.has(stem)) return stem;
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function fail(error: string, issues: string[] = []): ImportThemeResult {
  return { ok: false, error, issues };
}

/** 解析并校验 `.quirenote-theme` 文本：zod 校验、模板清洗、id 冲突处理、规则风险检查。 */
export function importTheme(text: string, options: ImportThemeOptions = {}): ImportThemeResult {
  const maxBytes = options.maxBytes ?? THEME_FILE_MAX_BYTES;
  if (text.length > maxBytes) return fail(`主题文件过大（上限 ${Math.round(maxBytes / 1024)} KB）`);

  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^﻿/, ""));
  } catch (e) {
    return fail(`不是合法的 JSON：${e instanceof Error ? e.message : String(e)}`);
  }
  const parsed = QuireNoteTheme.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (i) => `${i.path.length > 0 ? i.path.join(".") : "(根)"}：${i.message}`,
    );
    return fail("不是有效的 .quirenote-theme 文件", issues);
  }

  const file = parsed.data;
  const warnings: string[] = [];
  const strategy = options.onConflict ?? "rename";
  const renamed = { templates: {} as Record<string, string>, rules: {} as Record<string, string> };
  const skipped = { templates: [] as string[], rules: [] as string[] };
  const replaced = { templates: [] as string[], rules: [] as string[] };
  const canSanitize = hasHtmlParser(options);
  if (!canSanitize) warnings.push("当前环境没有 DOMParser，模板 HTML 未在导入时清洗（渲染时仍会清洗）");

  // ── 模板 ──
  const builtinIds = new Set(builtinTemplates.map((t) => t.id));
  const existingTemplates = new Set(options.existingTemplateIds ?? []);
  const takenTemplates = new Set([...builtinIds, ...existingTemplates]);
  const templates: CardTemplate[] = [];
  const seenInFile = new Set<string>();
  for (const original of file.templates) {
    const t: CardTemplate = { ...original, slots: original.slots.map((s) => ({ ...s })) };
    if (t.builtin) {
      warnings.push(`模板「${t.name}」声明为内置模板，已改为普通模板`);
      t.builtin = false;
    }
    const reserved = t.id.startsWith(BUILTIN_TEMPLATE_PREFIX) || builtinIds.has(t.id);
    const dupInFile = seenInFile.has(t.id);
    const conflict = existingTemplates.has(t.id);
    if (reserved || dupInFile || (conflict && strategy === "rename")) {
      const next = uniqueId(t.id, new Set([...takenTemplates, ...seenInFile]));
      if (!dupInFile) renamed.templates[t.id] = next;
      warnings.push(
        `模板 id「${t.id}」${reserved ? "与内置模板保留前缀冲突" : "已存在"}，重命名为「${next}」`,
      );
      t.id = next;
    } else if (conflict && strategy === "skip") {
      skipped.templates.push(t.id);
      warnings.push(`模板 id「${t.id}」已存在，已跳过`);
      continue;
    } else if (conflict && strategy === "replace") {
      replaced.templates.push(t.id);
      warnings.push(`模板 id「${t.id}」已存在，将覆盖本地模板`);
    }
    seenInFile.add(t.id);

    if (canSanitize) {
      const clean = sanitizeHtml(t.html, options);
      if (clean !== serializeHtml(t.html, options)) {
        warnings.push(`模板「${t.name}」包含不安全的 HTML（脚本、事件属性或危险链接），已清除`);
        t.html = clean;
      }
    }
    const cleanCss = sanitizeCss(t.css);
    if (cleanCss !== t.css) {
      warnings.push(`模板「${t.name}」的 CSS 包含 @import、expression() 或外部 url()，已清除`);
      t.css = cleanCss;
    }
    templates.push(t);
  }

  // ── 规则 ──
  const existingRules = new Set(options.existingRuleIds ?? []);
  const takenRules = new Set(existingRules);
  const seenRules = new Set<string>();
  const knownTemplates = new Set([...takenTemplates, ...templates.map((t) => t.id)]);
  const rules: RenderRule[] = [];
  for (const original of file.rules) {
    const r: RenderRule = { ...original, slots: { ...original.slots }, scopes: [...original.scopes] };
    const reserved = r.id.startsWith(BUILTIN_RULE_PREFIX);
    const dupInFile = seenRules.has(r.id);
    const conflict = existingRules.has(r.id);
    if (reserved || dupInFile || (conflict && strategy === "rename")) {
      const next = uniqueId(r.id, new Set([...takenRules, ...seenRules]));
      if (!dupInFile) renamed.rules[r.id] = next;
      warnings.push(`规则 id「${r.id}」${reserved ? "使用了内置保留前缀" : "已存在"}，重命名为「${next}」`);
      r.id = next;
    } else if (conflict && strategy === "skip") {
      skipped.rules.push(r.id);
      warnings.push(`规则 id「${r.id}」已存在，已跳过`);
      continue;
    } else if (conflict && strategy === "replace") {
      replaced.rules.push(r.id);
      warnings.push(`规则 id「${r.id}」已存在，将覆盖本地规则`);
    }
    seenRules.add(r.id);

    if (r.templateId) {
      const mapped = renamed.templates[r.templateId];
      if (mapped) r.templateId = mapped;
      else if (!knownTemplates.has(r.templateId)) {
        warnings.push(`规则「${r.name}」引用的模板「${r.templateId}」不存在`);
      }
    }
    const analysis = analyzePattern(r.pattern, r.flags);
    if (!analysis.valid) {
      r.enabled = false;
      warnings.push(`规则「${r.name}」的正则无效，已禁用：${analysis.error ?? ""}`);
    } else if (analysis.risk === "danger") {
      r.enabled = false;
      warnings.push(
        `规则「${r.name}」有灾难性回溯风险，已禁用：${analysis.issues.map((i) => i.message).join("；")}`,
      );
    } else if (analysis.risk === "warning") {
      warnings.push(`规则「${r.name}」可能较慢：${analysis.issues.map((i) => i.message).join("；")}`);
    }
    rules.push(r);
  }

  return {
    ok: true,
    theme: { ...file, templates, rules },
    warnings,
    renamed,
    skipped,
    replaced,
  };
}
