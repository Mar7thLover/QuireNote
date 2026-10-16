import type { RenderRule } from "@quirenote/core";
import { collectMatches, expandReplacement } from "./matcher";
import type { ApplyOptions, MatchInfo, RenderResult, RuleError, Segment } from "./types";

/** 过滤出要执行的规则：启用、作用域匹配，按 order 升序（相同 order 保持原顺序）。 */
export function planRules(rules: readonly RenderRule[], options: ApplyOptions = {}): RenderRule[] {
  return rules
    .map((rule, index) => ({ rule, index }))
    .filter(
      ({ rule }) => rule.enabled && (options.scope === undefined || rule.scopes.includes(options.scope)),
    )
    .sort((a, b) => a.rule.order - b.rule.order || a.index - b.index)
    .map(({ rule }) => rule);
}

/** 在主线程上校验正则能否编译（编译本身不会回溯，安全）。返回错误信息或 null。 */
export function validateRulePattern(pattern: string, flags: string): string | null {
  if (!/^[dgimsuvy]*$/.test(flags) || new Set(flags).size !== flags.length) {
    return `非法的正则标志 "${flags}"`;
  }
  if (flags.includes("u") && flags.includes("v")) return "标志 u 与 v 不能同时使用";
  try {
    new RegExp(pattern, flags);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export function toSegments(input: string | readonly Segment[]): Segment[] {
  if (typeof input === "string") return input === "" ? [] : [{ type: "text", text: input }];
  return input.map((s) => (s.type === "text" ? { ...s } : { ...s, vars: { ...s.vars } }));
}

/** 合并相邻文本段并去掉空文本段。 */
export function normalizeSegments(segments: readonly Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const seg of segments) {
    if (seg.type === "text") {
      if (seg.text === "") continue;
      const last = out[out.length - 1];
      if (last?.type === "text") {
        last.text += seg.text;
        continue;
      }
      out.push({ type: "text", text: seg.text });
    } else {
      out.push(seg);
    }
  }
  return out;
}

export function textsOf(segments: readonly Segment[]): string[] {
  const texts: string[] = [];
  for (const s of segments) if (s.type === "text") texts.push(s.text);
  return texts;
}

/** 由一次匹配构造卡片变量：命名组直接用组名，slots 把组号（或组名）映射成变量名并可覆盖。 */
export function varsFromMatch(rule: RenderRule, m: MatchInfo): Record<string, string> {
  const vars: Record<string, string> = {};
  if (m.named) {
    for (const [name, value] of Object.entries(m.named)) vars[name] = (value ?? "").trim();
  }
  for (const [key, varName] of Object.entries(rule.slots)) {
    if (!varName) continue;
    const value = /^\d+$/.test(key) ? m.groups[Number(key) - 1] : m.named?.[key];
    vars[varName] = (value ?? "").trim();
  }
  return vars;
}

/**
 * 把一条规则的匹配结果应用到分段上。`results[i]` 对应第 i 个文本段的匹配；
 * card 段原样保留，因此前面规则产出的卡片不会被后面的规则再处理。
 */
export function applyMatches(
  segments: readonly Segment[],
  rule: RenderRule,
  results: MatchInfo[][],
): Segment[] {
  const global = rule.flags.includes("g");
  const out: Segment[] = [];
  let textIndex = 0;
  let consumedFirst = false;
  for (const seg of segments) {
    if (seg.type !== "text") {
      out.push(seg);
      continue;
    }
    const all = results[textIndex++] ?? [];
    const matches = global ? all : consumedFirst ? [] : all.slice(0, 1);
    if (matches.length > 0) consumedFirst = true;
    let cursor = 0;
    for (const m of matches) {
      if (m.index < cursor) continue;
      if (rule.templateId && m.match === "") continue; // 空匹配不产出卡片
      out.push({ type: "text", text: seg.text.slice(cursor, m.index) });
      if (rule.templateId) {
        out.push({
          type: "card",
          templateId: rule.templateId,
          vars: varsFromMatch(rule, m),
          raw: m.match,
          ruleId: rule.id,
        });
      } else {
        out.push({ type: "text", text: expandReplacement(rule.replacement, m, seg.text) });
      }
      cursor = m.index + m.match.length;
    }
    out.push({ type: "text", text: seg.text.slice(cursor) });
  }
  return normalizeSegments(out);
}

export function ruleError(rule: RenderRule, kind: RuleError["kind"], message: string): RuleError {
  return { ruleId: rule.id, ruleName: rule.name, kind, message };
}

/**
 * 同步执行规则。**仅用于测试和服务端可信场景**：灾难性回溯会阻塞当前线程。
 * 浏览器中请使用 `createRuleRunner`（Web Worker + 超时）。
 */
export function applyRulesSync(
  input: string | readonly Segment[],
  rules: readonly RenderRule[],
  options: ApplyOptions = {},
): RenderResult {
  let segments = normalizeSegments(toSegments(input));
  const errors: RuleError[] = [];
  for (const rule of planRules(rules, options)) {
    const invalid = validateRulePattern(rule.pattern, rule.flags);
    if (invalid) {
      errors.push(ruleError(rule, "invalid-pattern", invalid));
      continue;
    }
    const texts = textsOf(segments);
    if (texts.length === 0) break;
    const res = collectMatches({ pattern: rule.pattern, flags: rule.flags, texts });
    if (!res.ok) {
      errors.push(ruleError(rule, "invalid-pattern", res.error));
      continue;
    }
    segments = applyMatches(segments, rule, res.results);
  }
  return { segments, errors };
}
