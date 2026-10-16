import type { RenderRule } from "@quirenote/core";

/**
 * 内置规则。字段分隔符同时支持中文全角竖线「｜」和英文「|」；
 * 列表项之间用英文双竖线「||」分隔（因此单个「|」才是字段分隔符）。冒号支持「：」和「:」。
 *
 * 所有模式都通过 `analyzePattern` 检查，没有嵌套量词或重叠交替。
 */

/** 字段分隔符：「｜」或单独的「|」（前后都不是「|」）。 */
const SEP = "(?:｜|(?<!\\|)\\|(?!\\|))";
/** 普通字段：不含分隔符与右括号。 */
const F = "([^｜|】]+)";
/** 列表字段：允许内部出现「||」。 */
const L = "((?:\\|\\||[^｜|】])+)";
const COLON = "[：:]";
const ALL_SCOPES: RenderRule["scopes"] = ["chat", "note", "artifact"];

type RuleDraft = Omit<RenderRule, "enabled" | "flags" | "replacement" | "scopes" | "slots"> &
  Partial<RenderRule>;

const rule = (r: RuleDraft): RenderRule => ({
  enabled: true,
  flags: "g",
  replacement: "",
  scopes: ALL_SCOPES,
  slots: {},
  ...r,
});

export const builtinRules: readonly RenderRule[] = [
  rule({
    id: "builtin.rule.callout",
    name: "提示框 > [!tip]",
    // 行首的 GitHub 风格提示：> [!tip] 内容（tip / note / important / warning / caution，大小写不限）
    pattern: "^> ?\\[!(?<kind>tip|note|important|warning|caution)\\][ \\t]*(?<content>\\S.*)$",
    flags: "gim",
    templateId: "builtin.callout",
    order: 10,
  }),
  rule({
    id: "builtin.rule.compare",
    name: "对比卡【对比：A｜B｜A要点||…｜B要点||…】",
    pattern: `【(?:对比|[Cc]ompare|VS|vs)${COLON}${F}${SEP}${F}${SEP}${L}${SEP}${L}】`,
    templateId: "builtin.compare",
    slots: { "1": "leftTitle", "2": "rightTitle", "3": "leftPoints", "4": "rightPoints" },
    order: 20,
  }),
  rule({
    id: "builtin.rule.timeline",
    name: "时间线卡【时间线：标题｜时间::事件||…】",
    pattern: `【(?:时间线|[Tt]imeline)${COLON}(?:${F}${SEP})?${L}】`,
    templateId: "builtin.timeline",
    slots: { "1": "title", "2": "events" },
    order: 30,
  }),
  rule({
    id: "builtin.rule.term",
    name: "术语卡【术语：名称｜定义】",
    pattern: `【(?:术语|[Tt]erm)${COLON}${F}${SEP}${F}(?:${SEP}${F})?】`,
    templateId: "builtin.term",
    slots: { "1": "term", "2": "definition", "3": "alias" },
    order: 40,
  }),
  rule({
    id: "builtin.rule.stat",
    name: "数据卡【数据：数值｜说明】",
    pattern: `【(?:数据|[Ss]tat|[Dd]ata)${COLON}${F}${SEP}${F}(?:${SEP}${F})?】`,
    templateId: "builtin.stat",
    slots: { "1": "value", "2": "label", "3": "note" },
    order: 50,
  }),
  rule({
    id: "builtin.rule.quote",
    name: "引用卡【引用：内容｜出处】",
    pattern: `【(?:引用|[Qq]uote)${COLON}${F}(?:${SEP}${F})?】`,
    templateId: "builtin.quote",
    slots: { "1": "quote", "2": "source" },
    order: 60,
  }),
  rule({
    id: "builtin.rule.knowledge",
    name: "知识卡【知识：标题｜正文｜要点||…】",
    pattern: `【(?:知识|[Nn]ote)${COLON}${F}${SEP}${F}(?:${SEP}${L})?】`,
    templateId: "builtin.knowledge",
    slots: { "1": "title", "2": "body", "3": "points" },
    order: 70,
  }),
  rule({
    id: "builtin.rule.points",
    name: "要点卡【要点：标题｜要点||要点】",
    // 命名捕获组直接成为模板变量（title / points），无需 slots。
    pattern: `【(?:要点|[Kk]ey ?[Pp]oints)${COLON}(?<title>[^｜|】]+)${SEP}(?<points>(?:\\|\\||[^｜|】])+)】`,
    templateId: "builtin.knowledge",
    order: 80,
  }),
];

/** 每条内置规则的示例文本，用于编辑器演示和测试。 */
export const builtinRuleSamples: Record<string, string> = {
  "builtin.rule.callout": "> [!tip] 先回忆，再看答案。",
  "builtin.rule.compare": "【对比：TCP｜UDP｜面向连接||可靠传输｜无连接||开销小】",
  "builtin.rule.timeline": "【时间线：AI 简史｜1950::图灵测试||1956::达特茅斯会议】",
  "builtin.rule.term": "【术语：熵｜衡量不确定性的量】",
  "builtin.rule.stat": "【数据：71%｜地球表面被海洋覆盖的比例】",
  "builtin.rule.quote": "【引用：知识就是力量｜培根】",
  "builtin.rule.knowledge": "【知识：注意力机制｜按相关度为输入分配权重｜Q/K/V||softmax】",
  "builtin.rule.points": "【要点：复习方法｜主动回忆||间隔重复||交错练习】",
};
