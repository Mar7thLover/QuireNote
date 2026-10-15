/**
 * @folio/render — 正则规则引擎与沙箱卡片模板渲染（框架无关）。
 *
 * - 规则引擎：applyRulesSync / createRuleRunner / analyzePattern
 * - 模板与沙箱：renderTemplate / sanitizeHtml / sanitizeCss / buildSrcdoc / SANDBOX_ATTR
 * - 内置模板与规则：builtinTemplates / builtinRules
 * - 主题文件：exportTheme / importTheme / defaultThemeSettings
 */

export { analyzePattern, type PatternAnalysis, type PatternIssue, type PatternIssueCode } from "./analyze";
export { builtinRuleSamples, builtinRules } from "./builtin/rules";
export {
  BUILTIN_TEMPLATE_PREFIX,
  builtinTemplates,
  calloutTemplate,
  compareTemplate,
  knowledgeTemplate,
  quoteTemplate,
  statTemplate,
  termTemplate,
  timelineTemplate,
} from "./builtin/templates";
export { applyRulesSync, planRules, validateRulePattern } from "./engine";
export { collectMatches, expandReplacement } from "./matcher";
export {
  createRuleRunner,
  DEFAULT_RULE_TIMEOUT_MS,
  type RuleRunner,
  type RuleRunnerOptions,
  type WorkerLike,
} from "./runner";
export {
  type CssSanitizeOptions,
  type HtmlParser,
  isSafeUrl,
  type SanitizeOptions,
  sanitizeCss,
  sanitizeHtml,
  setDefaultHtmlParser,
} from "./sanitize";
export {
  buildCsp,
  buildSrcdoc,
  CARD_THEME_VARS,
  type CardThemeVars,
  type CspOptions,
  cardThemeVars,
  defaultCardThemeVars,
  defaultThemeSettings,
  renderCardHtml,
  SANDBOX_ATTR,
  type SrcdocOptions,
} from "./srcdoc";
export { escapeHtml, renderTemplate, splitList, templateVariables } from "./template";
export {
  type ConflictStrategy,
  type ExportThemeInput,
  exportTheme,
  type ImportThemeOptions,
  type ImportThemeResult,
  importTheme,
  THEME_FILE_EXTENSION,
  THEME_FILE_MAX_BYTES,
} from "./theme-file";
export type {
  ApplyOptions,
  CardSegment,
  MatchInfo,
  MatchRequest,
  MatchResponse,
  RenderResult,
  RuleError,
  RuleErrorKind,
  Segment,
  TextSegment,
} from "./types";
