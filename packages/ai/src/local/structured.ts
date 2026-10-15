/**
 * local provider 的启发式结构化生成。目标：结构合法、内容来自资料、绝不为空。
 * 所有函数都是纯函数、确定性的，便于测试。
 */
import type { ArtifactKind, ElementType } from "@folio/core";
import {
  type AgentDraft,
  type AgentOpDraft,
  type ElementsDraft,
  type EnrichDraft,
  emptyAgentOp,
  type FlashcardsDraft,
  type MindmapDraft,
  type PodcastDraft,
  type QuizDraft,
  type SlidesDraft,
  type TableDraft,
  type TimelineDraft,
} from "../drafts";
import {
  findYears,
  isChinese,
  keywordOverlap,
  keywords,
  splitSentences,
  stripMarkdown,
  truncate,
} from "../text";
import type { Passage } from "../types";
import { cosine, localEmbed } from "./embedding";
import {
  inDocumentOrder,
  type PassageSentence,
  passageSentences,
  pickRepresentative,
  rankByQuery,
} from "./rank";

// ───────────── 公共工具 ─────────────

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function zhOf(passages: Passage[], extra = ""): boolean {
  return isChinese(extra + passages.map((p) => p.text.slice(0, 400)).join(""));
}

export function topicOf(passages: Passage[], fallback?: string): string {
  if (fallback?.trim()) return fallback.trim();
  const titles = [...new Set(passages.map((p) => p.title).filter((t): t is string => !!t))];
  if (titles.length === 1) return titles[0]!;
  if (titles.length > 1) return `${titles[0]} 等 ${titles.length} 份资料`;
  const first = passages[0]?.text.split("\n").find((l) => l.trim());
  return first ? truncate(stripMarkdown(first), 30) : "资料概览";
}

/** 句子第一个分句，作为简短标题。 */
function clause(text: string, max = 28): string {
  const t = stripMarkdown(text)
    .replace(/^(?:在|于)?\s*(?:1[0-9]{3}|20[0-9]{2})\s*年(?:前后|代|夏天|春天|秋天|冬天)?[，,、\s]*/, "")
    .replace(/^(?:in\s+)?(?:1[0-9]{3}|20[0-9]{2})[,\s]+/i, "");
  const first = t.split(/[，,；;：:。.!?！？]/)[0] ?? t;
  return truncate(first.trim() || t, max);
}

/** 按所属标题分组的句子（保持原文顺序）。 */
function groupByHeading(sents: PassageSentence[]): { heading: string; items: PassageSentence[] }[] {
  const groups: { heading: string; items: PassageSentence[] }[] = [];
  for (const s of inDocumentOrder(sents)) {
    const h = s.heading ?? s.passage.title ?? "要点";
    const last = groups[groups.length - 1];
    if (last && last.heading === h) last.items.push(s);
    else {
      const existing = groups.find((g) => g.heading === h);
      if (existing) existing.items.push(s);
      else groups.push({ heading: h, items: [s] });
    }
  }
  return groups;
}

function sentencesOf(passages: Passage[]): PassageSentence[] {
  return passageSentences(passages);
}

function ensureSentences(passages: Passage[]): PassageSentence[] {
  const s = sentencesOf(passages);
  if (s.length) return s;
  // 没有可用句子（极短资料）：把每个片段整体当成一句。
  return passages
    .filter((p) => p.text.trim())
    .map((p, i) => ({
      text: p.text.trim(),
      start: 0,
      end: p.text.trim().length,
      n: p.n,
      passage: p,
      clean: stripMarkdown(p.text),
      heading: p.heading ?? null,
      vec: localEmbed(p.text),
      order: i,
    }));
}

// ───────────── 术语与定义 ─────────────

interface TermHit {
  term: string;
  sentence: PassageSentence;
  kind: ElementType;
  definition: string;
}

const DEF_RE = /^(.{2,20}?)(?:是指|指的是|是|即|被称为|称为|又称)(.{4,})$/;
const TERM_SPLIT = /和|与|及|的|了|是|在|等|对|从|把|被|将|向|于|为|以|、|无法|解决|提出|使用|称为|叫做/;
const NAME_PREFIX_STOP = /^.*[者如年在和与的是由及位名被对、，,]/;
const NAME_SUFFIX_STOP = /[在提发的和与等是于认证说曾将把被也都就对从向以为了着].*$/;

function isGoodSubject(s: string): boolean {
  return (
    !/[，,。；;：:]/.test(s) &&
    !/^(这|那|它|他|她|其|此|该|我|你|每|所|一)/.test(s) &&
    !/的|至今|仍|也|都|就|已|曾|还|才|又|将|正|被|后来/.test(s)
  );
}

/** 识别带间隔号的中文译名，并修剪前后粘连的虚词、动词。 */
function transliteratedNames(text: string): string[] {
  const out: string[] = [];
  const re = /[一-鿿]{1,6}·[一-鿿]{1,8}/g;
  let m: RegExpExecArray | null = re.exec(text);
  while (m !== null) {
    const [given, family] = m[0].split("·") as [string, string];
    const g = given.replace(NAME_PREFIX_STOP, "");
    const f = family.replace(NAME_SUFFIX_STOP, "");
    if (g.length >= 1 && g.length <= 4 && f.length >= 1 && f.length <= 6) out.push(`${g}·${f}`);
    // 从修剪后的结尾继续扫描，避免吞掉后面紧跟的下一个人名。
    re.lastIndex = m.index + given.length + 1 + Math.max(1, f.length);
    m = re.exec(text);
  }
  return out;
}

/** 从句子中找出术语、人物、日期等候选。 */
function findTerms(sents: PassageSentence[]): TermHit[] {
  const hits: TermHit[] = [];
  const seen = new Set<string>();
  const add = (term: string, s: PassageSentence, kind: ElementType, definition: string) => {
    const t = term.trim().replace(/^[“"《「『]|[”"》」』]$/g, "");
    const key = t.toLowerCase();
    if (t.length < 2 || t.length > 40 || seen.has(key)) return;
    seen.add(key);
    hits.push({ term: t, sentence: s, kind, definition });
  };
  for (const s of sents) {
    const text = s.clean;
    // 引号 / 书名号中的术语
    for (const m of text.matchAll(/[“"「『]([^”"」』]{2,20})[”"」』]/g)) add(m[1]!, s, "term", text);
    for (const m of text.matchAll(/《([^》]{2,30})》/g)) add(`《${m[1]}》`, s, "concept", text);
    // 中文名 + 英文括注：异或（XOR）、人类反馈强化学习（RLHF）
    for (const m of text.matchAll(/([一-鿿]{2,16})[（(]([A-Za-z][A-Za-z\s-]{1,40})[)）]/g)) {
      const term = m[1]!.split(TERM_SPLIT).pop() ?? "";
      if (term.length >= 2) add(term, s, "term", text);
    }
    // 带间隔号的译名：艾伦·图灵、弗兰克·罗森布拉特
    for (const name of transliteratedNames(text)) add(name, s, "person", text);
    // 英文人名：Alan Turing（只在英文句子中识别，中文句子里的英文多为术语括注）
    if (!isChinese(text)) {
      for (const m of text.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/g)) {
        if (!/^(The|In|On|At|This|That|It|By|For|From|After|Before)\b/.test(m[1]!))
          add(m[1]!, s, "person", text);
      }
    }
    // 定义句：X 是 Y
    const def = DEF_RE.exec(text);
    if (def && isGoodSubject(def[1]!)) add(def[1]!, s, "concept", text);
  }
  return hits;
}

// ───────────── Markdown 类生成物 ─────────────

export function localMarkdownArtifact(
  kind: ArtifactKind,
  passages: Passage[],
  opts: { title?: string; instructions?: string } = {},
): string {
  const zh = zhOf(passages, opts.title);
  const topic = topicOf(passages, opts.title);
  const sents = ensureSentences(passages);
  if (!sents.length)
    return zh ? `# ${topic}\n\n（资料中没有可用的文本内容。）` : `# ${topic}\n\n(No text content.)`;
  const key = pickRepresentative(sents, 6, opts.instructions);
  const groups = groupByHeading(sents).slice(0, 8);
  const L = (zhText: string, en: string) => (zh ? zhText : en);
  const lines: string[] = [];
  switch (kind) {
    case "briefing": {
      lines.push(`# ${L("简报", "Briefing")}：${topic}`, "");
      lines.push(`**${L("核心结论", "Key takeaways")}**`, "");
      for (const s of key.slice(0, 3)) lines.push(`- ${s.clean}`);
      lines.push("", `**${L("背景", "Context")}**`, "");
      for (const g of groups.slice(0, 4)) {
        const s = pickRepresentative(g.items, 1)[0];
        if (s) lines.push(`- **${g.heading}**：${truncate(s.clean, 120)}`);
      }
      break;
    }
    case "study_guide": {
      lines.push(`# ${L("学习指南", "Study guide")}：${topic}`, "");
      const terms = findTerms(sents).slice(0, 8);
      lines.push(`## ${L("核心概念", "Key concepts")}`, "");
      if (terms.length) for (const t of terms) lines.push(`- **${t.term}**：${truncate(t.definition, 100)}`);
      else for (const s of key.slice(0, 4)) lines.push(`- ${s.clean}`);
      lines.push("", `## ${L("知识要点", "Main points")}`, "");
      for (const g of groups) {
        lines.push(`### ${g.heading}`, "");
        for (const s of pickRepresentative(g.items, 2)) lines.push(`- ${s.clean}`);
        lines.push("");
      }
      lines.push(`## ${L("自测问题", "Review questions")}`, "");
      groups.slice(0, 5).forEach((g, i) => {
        lines.push(
          `${i + 1}. ${zh ? `关于「${g.heading}」，资料的主要观点是什么？` : `What is the main point about "${g.heading}"?`}`,
        );
      });
      break;
    }
    case "faq": {
      lines.push(`# FAQ：${topic}`, "");
      const terms = findTerms(sents).slice(0, 4);
      for (const t of terms) {
        lines.push(`## ${zh ? `什么是${t.term}？` : `What is ${t.term}?`}`, "", t.definition, "");
      }
      for (const g of groups.slice(0, Math.max(2, 6 - terms.length))) {
        const s = pickRepresentative(g.items, 2);
        if (!s.length) continue;
        lines.push(`## ${zh ? `${g.heading}的要点是什么？` : `What about ${g.heading}?`}`, "");
        lines.push(s.map((x) => x.clean).join(" "), "");
      }
      break;
    }
    case "infographic": {
      lines.push(`# ${topic}`, "");
      const years = sents.filter((s) => findYears(s.clean).length).slice(0, 6);
      const nums = sents
        .filter((s) => /\d+(?:\.\d+)?\s*(?:%|％|万|亿|倍|个|项|周|年)/.test(s.clean))
        .slice(0, 4);
      lines.push(`## ${L("一句话", "In one line")}`, "", `> ${key[0]?.clean ?? topic}`, "");
      if (years.length) {
        lines.push(`## ${L("关键年份", "Key dates")}`, "");
        for (const s of inDocumentOrder(years))
          lines.push(`- **${findYears(s.clean)[0]}** · ${clause(s.clean, 40)}`);
        lines.push("");
      }
      if (nums.length) {
        lines.push(`## ${L("关键数字", "Key numbers")}`, "");
        for (const s of nums) lines.push(`- ${truncate(s.clean, 80)}`);
        lines.push("");
      }
      lines.push(`## ${L("要点", "Highlights")}`, "");
      for (const s of key.slice(0, 4)) lines.push(`- ${truncate(s.clean, 90)}`);
      break;
    }
    default: {
      // report 及其他
      lines.push(`# ${topic}`, "");
      if (opts.instructions?.trim()) lines.push(`> ${opts.instructions.trim()}`, "");
      lines.push(
        `## ${L("概述", "Overview")}`,
        "",
        key
          .slice(0, 3)
          .map((s) => s.clean)
          .join(""),
        "",
      );
      for (const g of groups) {
        lines.push(`## ${g.heading}`, "");
        for (const s of pickRepresentative(g.items, 3)) lines.push(`- ${s.clean}`);
        lines.push("");
      }
      lines.push(`## ${L("结论", "Conclusion")}`, "", key[key.length - 1]?.clean ?? "");
    }
  }
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ───────────── 结构化生成物 ─────────────

export function localMindmap(
  passages: Passage[],
  opts: { title?: string; query?: string } = {},
): MindmapDraft {
  const topic = topicOf(passages, opts.title);
  const nodes: MindmapDraft["nodes"] = [{ key: "root", label: topic, note: "", parentKey: null }];
  const sents = ensureSentences(passages);
  let k = 0;
  const bySource = new Map<string, PassageSentence[]>();
  for (const s of sents) {
    const t = s.passage.title ?? "资料";
    bySource.set(t, [...(bySource.get(t) ?? []), s]);
  }
  const multi = bySource.size > 1;
  for (const [title, items] of bySource) {
    let parent = "root";
    if (multi) {
      parent = `n${++k}`;
      nodes.push({ key: parent, label: truncate(title, 30), note: "", parentKey: "root" });
    }
    const groups = groupByHeading(items).filter((g) => g.heading !== title);
    if (groups.length > 1) {
      for (const g of groups.slice(0, 6)) {
        const gk = `n${++k}`;
        nodes.push({ key: gk, label: truncate(g.heading, 30), note: "", parentKey: parent });
        for (const s of pickRepresentative(g.items, 3, opts.query)) {
          nodes.push({ key: `n${++k}`, label: clause(s.clean, 24), note: s.clean, parentKey: gk });
        }
      }
    } else {
      for (const s of pickRepresentative(items, 5, opts.query)) {
        nodes.push({ key: `n${++k}`, label: clause(s.clean, 24), note: s.clean, parentKey: parent });
      }
    }
    if (nodes.length > 60) break;
  }
  if (nodes.length === 1) nodes.push({ key: "n1", label: "要点", note: "", parentKey: "root" });
  return { nodes };
}

export function localTimeline(passages: Passage[], opts: { query?: string } = {}): TimelineDraft {
  const sents = ensureSentences(passages);
  const events: (TimelineDraft["events"][number] & { y: number; n: number; s: number })[] = [];
  const seen = new Set<string>();
  for (const s of sents) {
    const years = findYears(s.clean);
    const y = years[0];
    if (!y) continue;
    const title = clause(s.clean, 30);
    const key = `${y}|${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push({ date: y, title, detail: s.clean, y: Number(y), n: s.n, s: s.start });
  }
  let out = events.sort((a, b) => a.y - b.y || a.n - b.n || a.s - b.s);
  if (opts.query) {
    const q = opts.query;
    const scored = out.map((e) => ({ e, sc: keywordOverlap(q, e.detail) }));
    if (scored.some((x) => x.sc > 0)) out = scored.filter((x) => x.sc > 0).map((x) => x.e);
  }
  if (out.length > 16) out = out.slice(0, 16);
  if (!out.length) {
    // 没有年份：按资料顺序列出关键节点。
    return {
      events: inDocumentOrder(pickRepresentative(sents, 6)).map((s, i) => ({
        date: `#${i + 1}`,
        title: clause(s.clean, 30),
        detail: s.clean,
      })),
    };
  }
  return { events: out.map(({ date, title, detail }) => ({ date, title, detail })) };
}

export function localFlashcards(
  passages: Passage[],
  opts: { query?: string; max?: number } = {},
): FlashcardsDraft {
  const zh = zhOf(passages);
  const sents = ensureSentences(passages);
  const max = opts.max ?? 12;
  const cards: FlashcardsDraft["cards"] = [];
  const fronts = new Set<string>();
  const push = (front: string, back: string) => {
    if (cards.length >= max || fronts.has(front)) return;
    fronts.add(front);
    cards.push({ front, back });
  };
  let terms = findTerms(sents);
  if (opts.query) terms = terms.filter((t) => keywordOverlap(opts.query!, `${t.term} ${t.definition}`) > 0);
  for (const t of terms) {
    if (t.kind === "person") push(zh ? `${t.term}有什么贡献或观点？` : `Who is ${t.term}?`, t.definition);
    else push(zh ? `什么是「${t.term}」？` : `What is "${t.term}"?`, t.definition);
  }
  for (const s of sents) {
    const y = findYears(s.clean)[0];
    if (!y) continue;
    push(zh ? `${y} 年发生了什么？` : `What happened in ${y}?`, s.clean);
  }
  // 补足：完形填空
  for (const s of pickRepresentative(sents, max, opts.query)) {
    const kw = keywords(s.clean).filter((k) => k.length >= 2)[0];
    if (!kw) continue;
    const idx = s.clean.toLowerCase().indexOf(kw);
    if (idx < 0) continue;
    const front = `${s.clean.slice(0, idx)}____${s.clean.slice(idx + kw.length)}`;
    push(front, `${s.clean.slice(idx, idx + kw.length)} —— ${s.clean}`);
  }
  if (!cards.length) {
    const s = sents[0];
    cards.push({
      front: zh ? "这份资料的主要内容是什么？" : "What is this source about?",
      back: s?.clean ?? topicOf(passages),
    });
  }
  return { cards };
}

export function localQuiz(passages: Passage[], opts: { query?: string; max?: number } = {}): QuizDraft {
  const zh = zhOf(passages);
  const sents = ensureSentences(passages);
  const max = opts.max ?? 8;
  const questions: QuizDraft["questions"] = [];
  const allYears = [...new Set(sents.flatMap((s) => findYears(s.clean)))];
  const terms = findTerms(sents).filter((t) => t.kind !== "person" || true);
  const termNames = [...new Set(terms.map((t) => t.term))];

  const shuffle = (correct: string, distractors: string[], seed: string) => {
    const opts3 = distractors.filter((d) => d !== correct).slice(0, 3);
    const pos = hash(seed) % (opts3.length + 1);
    const options = [...opts3];
    options.splice(pos, 0, correct);
    return { options, answer: pos };
  };

  // 年份题
  for (const s of sents) {
    if (questions.length >= Math.ceil(max / 2)) break;
    const y = findYears(s.clean)[0];
    if (!y) continue;
    if (opts.query && keywordOverlap(opts.query, s.clean) === 0) continue;
    let distract = allYears.filter((x) => x !== y);
    if (distract.length < 3) {
      const n = Number(y);
      distract = [
        ...new Set([...distract, String(n - 10), String(n + 7), String(n + 15), String(n - 4)]),
      ].filter((x) => x !== y);
    }
    distract = distract.sort((a, b) => Math.abs(Number(a) - Number(y)) - Math.abs(Number(b) - Number(y)));
    const { options, answer } = shuffle(y, distract, s.clean);
    questions.push({
      question: zh
        ? `以下事件发生在哪一年：「${clause(s.clean, 40)}」？`
        : `When did this happen: "${clause(s.clean, 60)}"?`,
      options,
      answer,
      explanation: s.clean,
    });
  }
  // 术语填空题
  for (const t of terms) {
    if (questions.length >= max) break;
    if (termNames.length < 2) break;
    const text = t.sentence.clean;
    const idx = text.indexOf(t.term);
    if (idx < 0) continue;
    const blanked = `${text.slice(0, idx)}____${text.slice(idx + t.term.length)}`;
    // 优先用同类型的术语作干扰项，不足时再用其他术语。
    const sameKind = terms.filter((x) => x.kind === t.kind && x.term !== t.term).map((x) => x.term);
    const distract = [...new Set([...sameKind, ...termNames.filter((x) => x !== t.term)])];
    const { options, answer } = shuffle(t.term, distract, text);
    questions.push({
      question: zh ? `填空：${truncate(blanked, 120)}` : `Fill in the blank: ${truncate(blanked, 160)}`,
      options,
      answer,
      explanation: text,
    });
  }
  // 兜底：判断题
  if (!questions.length) {
    for (const s of pickRepresentative(sents, Math.min(3, max), opts.query)) {
      questions.push({
        question: zh ? `判断：${s.clean}` : `True or false: ${s.clean}`,
        options: zh ? ["正确", "错误"] : ["True", "False"],
        answer: 0,
        explanation: zh ? "该句直接摘自资料原文。" : "Quoted directly from the source.",
      });
    }
  }
  return { questions };
}

export function localTable(passages: Passage[], opts: { query?: string } = {}): TableDraft {
  const zh = zhOf(passages);
  const sents = ensureSentences(passages);
  const bySource = new Map<string, PassageSentence[]>();
  for (const s of sents) {
    const t = s.passage.title ?? (zh ? "资料" : "Source");
    bySource.set(t, [...(bySource.get(t) ?? []), s]);
  }
  const columns: TableDraft["columns"] = zh
    ? [
        { name: "主题", type: "text" },
        { name: "要点", type: "text" },
        { name: "年份", type: "text" },
        { name: "句数", type: "number" },
      ]
    : [
        { name: "Topic", type: "text" },
        { name: "Key point", type: "text" },
        { name: "Years", type: "text" },
        { name: "Sentences", type: "number" },
      ];
  const rows: string[][] = [];
  const addRow = (name: string, items: PassageSentence[]) => {
    const best = pickRepresentative(items, 1, opts.query)[0];
    const years = [...new Set(items.flatMap((s) => findYears(s.clean)))].slice(0, 4).join(", ");
    rows.push([name, truncate(best?.clean ?? "", 120), years, String(items.length)]);
  };
  if (bySource.size > 1) for (const [t, items] of bySource) addRow(t, items);
  else for (const g of groupByHeading(sents).slice(0, 12)) addRow(g.heading, g.items);
  if (!rows.length) rows.push([topicOf(passages), "", "", "0"]);
  return { columns, rows };
}

export function localSlides(passages: Passage[], opts: { title?: string; query?: string } = {}): SlidesDraft {
  const zh = zhOf(passages, opts.title);
  const topic = topicOf(passages, opts.title);
  const sents = ensureSentences(passages);
  const slides: SlidesDraft["slides"] = [];
  const key = pickRepresentative(sents, 3, opts.query);
  slides.push({
    title: topic,
    bullets: key.map((s) => truncate(s.clean, 60)),
    notes: key.map((s) => s.clean).join(" "),
  });
  for (const g of groupByHeading(sents).slice(0, 8)) {
    const pts = pickRepresentative(g.items, 3, opts.query);
    if (!pts.length) continue;
    slides.push({
      title: truncate(g.heading, 40),
      bullets: inDocumentOrder(pts).map((s) => truncate(s.clean, 60)),
      notes: inDocumentOrder(pts)
        .map((s) => s.clean)
        .join(" "),
    });
  }
  slides.push({
    title: zh ? "总结" : "Summary",
    bullets: key.slice(0, 2).map((s) => clause(s.clean, 40)),
    notes: zh ? `以上就是关于「${topic}」的要点。` : `That's the overview of ${topic}.`,
  });
  return { slides };
}

export function localPodcast(passages: Passage[], opts: { title?: string } = {}): PodcastDraft {
  const zh = zhOf(passages, opts.title);
  const topic = topicOf(passages, opts.title);
  const sents = ensureSentences(passages);
  const script: PodcastDraft["script"] = [];
  const key = pickRepresentative(sents, 3);
  if (zh) {
    script.push({ speaker: "A", text: `欢迎收听。今天我们来聊聊「${topic}」。` });
    script.push({ speaker: "B", text: "听起来很有意思。先说说，这些资料主要讲了什么？" });
    script.push({
      speaker: "A",
      text:
        key
          .slice(0, 2)
          .map((s) => s.clean)
          .join("") || topic,
    });
  } else {
    script.push({ speaker: "A", text: `Welcome back. Today we're talking about ${topic}.` });
    script.push({ speaker: "B", text: "Sounds interesting. So what are these sources mainly about?" });
    script.push({
      speaker: "A",
      text:
        key
          .slice(0, 2)
          .map((s) => s.clean)
          .join(" ") || topic,
    });
  }
  for (const g of groupByHeading(sents).slice(0, 5)) {
    const pts = inDocumentOrder(pickRepresentative(g.items, 2));
    if (!pts.length) continue;
    script.push({ speaker: "B", text: zh ? `那关于「${g.heading}」呢？` : `What about "${g.heading}"?` });
    script.push({ speaker: "A", text: pts.map((s) => s.clean).join(zh ? "" : " ") });
  }
  const last = key[key.length - 1];
  if (zh) {
    script.push({ speaker: "B", text: `所以简单来说：${last ? clause(last.clean, 50) : topic}。` });
    script.push({ speaker: "A", text: "没错。感谢收听，我们下次再见。" });
  } else {
    script.push({ speaker: "B", text: `So in short: ${last ? clause(last.clean, 80) : topic}.` });
    script.push({ speaker: "A", text: "Exactly. Thanks for listening, see you next time." });
  }
  return { script };
}

export function localImagePrompt(
  passages: Passage[],
  opts: { title?: string; instructions?: string } = {},
): string {
  if (opts.instructions?.trim()) return opts.instructions.trim();
  const topic = topicOf(passages, opts.title);
  const terms = findTerms(ensureSentences(passages))
    .slice(0, 5)
    .map((t) => t.term);
  return `Editorial illustration about "${topic}"${terms.length ? `, featuring ${terms.join(", ")}` : ""}. Clean, minimal, soft lighting, muted palette, no text.`;
}

// ───────────── 元素抽取 ─────────────

export function localElements(passages: Passage[], opts: { max?: number } = {}): ElementsDraft {
  const max = opts.max ?? 30;
  const sents = ensureSentences(passages);
  const out: ElementsDraft["elements"] = [];
  const names = new Set<string>();
  const add = (type: ElementType, name: string, definition: string, s: PassageSentence) => {
    const key = name.toLowerCase();
    if (names.has(key) || out.length >= max) return;
    names.add(key);
    out.push({ type, name, definition: truncate(definition, 200), quote: s.text, passage: s.n });
  };
  for (const t of findTerms(sents)) add(t.kind, t.term, t.definition, t.sentence);
  for (const s of sents) {
    for (const y of findYears(s.clean).slice(0, 1)) add("date", `${y}`, s.clean, s);
    const data = s.clean.match(/\d+(?:\.\d+)?\s*(?:%|％|万|亿|倍)/);
    if (data) add("data", data[0], s.clean, s);
    if (/[？?]$/.test(s.clean)) add("question", truncate(s.clean, 60), s.clean, s);
    if (/(?:认为|证明|表明|指出|提出|主张|argue|show|prove)/i.test(s.clean) && out.length < max) {
      add("claim", clause(s.clean, 40), s.clean, s);
    }
  }
  // 标题作为概念
  for (const s of sents)
    if (s.heading && s.heading !== s.passage.title) add("concept", s.heading, s.clean, s);
  if (!out.length) {
    const s = sents[0];
    const kw = s ? (keywords(s.clean)[0] ?? topicOf(passages)) : topicOf(passages);
    if (s) add("concept", kw, s.clean, s);
    else
      out.push({
        type: "concept",
        name: topicOf(passages),
        definition: "",
        quote: passages[0]?.text.slice(0, 100) ?? "",
        passage: passages[0]?.n ?? 1,
      });
  }
  return { elements: out };
}

export function localEnrich(name: string, passages: Passage[]): EnrichDraft {
  const sents = ensureSentences(passages);
  const mentions = sents.filter((s) => s.clean.includes(name));
  const ranked = mentions.length ? mentions : rankByQuery(name, sents).map((r) => r.item);
  const defSent =
    ranked.find((s) => new RegExp(`${escapeRe(name)}\\s*(?:是指|指的是|是|即|被称为|称为)`).test(s.clean)) ??
    ranked[0];
  const aliases = new Set<string>();
  for (const s of mentions) {
    const m = new RegExp(`${escapeRe(name)}[（(]([^)）]{2,40})[)）]`).exec(s.clean);
    if (m) aliases.add(m[1]!.trim());
  }
  const related = new Set<string>();
  for (const t of findTerms(mentions.length ? mentions : ranked.slice(0, 3))) {
    if (t.term !== name && related.size < 5) related.add(t.term);
  }
  return {
    definition:
      defSent?.clean ??
      (isChinese(name) ? `${name}：资料中未找到明确定义。` : `${name}: no definition found.`),
    aliases: [...aliases],
    related: [...related],
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ───────────── 自动标注 / 摘要 ─────────────

export function localHighlights(text: string, max = 6): { start: number; end: number; note: string }[] {
  const zh = isChinese(text);
  const sents = passageSentences([{ n: 1, text }]);
  if (!sents.length) return [];
  const k = Math.max(1, Math.min(max, Math.round(sents.length * 0.12)));
  return pickRepresentative(sents, k)
    .sort((a, b) => a.start - b.start)
    .map((s) => ({ start: s.start, end: s.end, note: zh ? "要点" : "Key point" }));
}

export function localSummary(text: string, maxSentences = 2): string {
  const sents = passageSentences([{ n: 1, text }]);
  if (!sents.length) return truncate(stripMarkdown(text), 160);
  return inDocumentOrder(pickRepresentative(sents, maxSentences))
    .map((s) => s.clean)
    .join(isChinese(text) ? "" : " ");
}

export function localResearchQueries(question: string, round: number, gathered: string[]): string[] {
  if (round <= 1 || !gathered.length) return [question];
  const q = new Set(keywords(question));
  const freq = new Map<string, number>();
  for (const t of gathered)
    for (const k of keywords(t)) if (!q.has(k) && k.length > 1) freq.set(k, (freq.get(k) ?? 0) + 1);
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const queries = top.slice(0, 2).map(([k]) => `${question} ${k}`);
  return queries.length ? queries : [question];
}

// ───────────── 就地 AI（transform） ─────────────

export type TransformAction =
  | "explain"
  | "rewrite"
  | "expand"
  | "translate"
  | "summarize"
  | "find_source"
  | "quiz"
  | "custom";

export function localTransform(
  action: TransformAction,
  text: string,
  passages: Passage[],
  opts: { instruction?: string; targetLang?: string } = {},
): string {
  const zh = isChinese(text);
  const related = () => {
    const ranked = rankByQuery(`${opts.instruction ?? ""} ${text}`, passageSentences(passages));
    const out: PassageSentence[] = [];
    for (const r of ranked) {
      if (out.length >= 3) break;
      if (r.score < 0.1) break;
      if (r.item.clean === stripMarkdown(text).trim()) continue;
      if (out.some((o) => cosine(o.vec, r.item.vec) > 0.85)) continue;
      out.push(r.item);
    }
    return out;
  };
  const textSummary = () => localSummary(text, 1);
  switch (action) {
    case "summarize":
      return localSummary(text, Math.max(1, Math.min(3, Math.round(splitSentences(text).length / 4))));
    case "rewrite": {
      const sentences = splitSentences(text).map((s) => stripMarkdown(s.text).replace(/\s+/g, zh ? "" : " "));
      return [...new Set(sentences)].join(zh ? "" : " ");
    }
    case "expand": {
      const rel = related();
      if (!rel.length) return text;
      return `${text.trim()}\n\n${rel.map((s) => `${s.clean} [${s.n}]`).join(zh ? "" : " ")}`;
    }
    case "translate":
      return zh
        ? `（内置 local 模型无法翻译${opts.targetLang ? `为 ${opts.targetLang}` : ""}，请在设置中为“对话”能力分配一个真实模型。）\n\n${text}`
        : `(The built-in local model cannot translate${opts.targetLang ? ` to ${opts.targetLang}` : ""}. Assign a real chat model in Settings.)\n\n${text}`;
    case "find_source": {
      const rel = related();
      if (!rel.length) return zh ? "没有在资料中找到与所选文字相关的出处。" : "No matching source found.";
      return [
        zh ? "以下资料片段与所选文字最相关：" : "Most relevant source passages:",
        "",
        ...rel.map((s, i) => `${i + 1}. ${s.clean} [${s.n}]`),
      ].join("\n");
    }
    case "quiz": {
      const q = localQuiz([{ n: 1, text }], { max: 3 });
      return q.questions
        .map(
          (x, i) =>
            `${i + 1}. ${x.question}\n${x.options.map((o, j) => `   ${String.fromCharCode(65 + j)}. ${o}`).join("\n")}\n   ${zh ? "答案" : "Answer"}：${String.fromCharCode(65 + x.answer)}`,
        )
        .join("\n\n");
    }
    default: {
      // explain / custom
      const rel = related();
      const head = zh ? `**要点**：${textSummary()}` : `**Gist**: ${textSummary()}`;
      if (!rel.length) return head;
      return [
        head,
        "",
        zh ? "**资料中的相关内容**：" : "**Related in sources**:",
        ...rel.map((s) => `- ${s.clean} [${s.n}]`),
      ].join("\n");
    }
  }
}

// ───────────── Agent 命令 ─────────────

export interface AgentNote {
  id: string;
  title: string;
  markdown: string;
}

export function localAgent(
  instruction: string,
  notes: AgentNote[],
  passages: Passage[],
  selection?: string,
): AgentDraft {
  const zh = isChinese(instruction) || !instruction.trim();
  const lower = instruction.toLowerCase();
  const has = (re: RegExp) => re.test(lower);
  const notePassages: Passage[] = notes.map((n, i) => ({ n: i + 1, text: n.markdown, title: n.title }));
  const material: Passage[] = selection?.trim()
    ? [{ n: 1, text: selection, title: zh ? "选中内容" : "Selection" }]
    : notePassages.length
      ? notePassages
      : passages;
  const ops: AgentOpDraft[] = [];

  if (has(/删除|删掉|移除|delete|remove/) && notes.length) {
    for (const n of notes) ops.push({ ...emptyAgentOp("delete_note"), noteId: n.id, title: n.title });
    return { summary: zh ? `删除 ${notes.length} 条笔记` : `Delete ${notes.length} note(s)`, ops };
  }
  if (has(/表格|对比|比较|table|compare|comparison/)) {
    const cols = zh ? ["名称", "要点", "关键词"] : ["Name", "Key point", "Keywords"];
    const rows = (notes.length ? notePassages : material).map((p) => {
      const best = localSummary(p.text, 1);
      const kws = [...new Set(keywords(p.text))].slice(0, 4).join(", ");
      return [p.title ?? `#${p.n}`, truncate(best, 120), kws];
    });
    const title = zh
      ? notes.length
        ? `对比：${notes.map((n) => n.title).join(" / ")}`
        : "对比表"
      : "Comparison";
    ops.push({ ...emptyAgentOp("create_table"), title: truncate(title, 60), table: { columns: cols, rows } });
    return {
      summary: zh ? `新建一张对比表（${rows.length} 行）` : `Create a comparison table (${rows.length} rows)`,
      ops,
    };
  }
  if (has(/元素|术语|概念|人物|element|term|concept/)) {
    const els = localElements(material, { max: 6 }).elements;
    for (const e of els)
      ops.push({
        ...emptyAgentOp("create_element"),
        elementType: e.type,
        name: e.name,
        definition: e.definition,
      });
    return { summary: zh ? `抽取 ${els.length} 个元素` : `Extract ${els.length} element(s)`, ops };
  }
  if (has(/合并|整合|merge|combine/) && notes.length > 1) {
    const md = notes.map((n) => `## ${n.title}\n\n${n.markdown.trim()}`).join("\n\n");
    ops.push({
      ...emptyAgentOp("create_note"),
      title: truncate((zh ? "合并：" : "Merged: ") + notes.map((n) => n.title).join(" + "), 80),
      markdown: md,
    });
    return { summary: zh ? `把 ${notes.length} 条笔记合并成一份新笔记` : `Merge ${notes.length} notes`, ops };
  }
  if (notes.length === 1 && has(/改写|润色|整理|补充|更新|rewrite|polish|update|improve/)) {
    const n = notes[0]!;
    const summary = localSummary(n.markdown, 2);
    ops.push({
      ...emptyAgentOp("update_note"),
      noteId: n.id,
      title: n.title,
      markdown: `${n.markdown.trim()}\n\n## ${zh ? "要点" : "Key points"}\n\n${summary}`,
    });
    return { summary: zh ? `整理笔记「${n.title}」` : `Update note "${n.title}"`, ops };
  }
  // 默认：根据指令新建一条笔记（总结 / 摘要 / 其他）
  const sents = ensureSentences(material);
  const picked = inDocumentOrder(pickRepresentative(sents, 5, instruction));
  const body = picked.length
    ? picked.map((s) => `- ${s.clean}`).join("\n")
    : truncate(material[0]?.text ?? "", 300);
  ops.push({
    ...emptyAgentOp("create_note"),
    title: truncate(instruction.trim() || (zh ? "新笔记" : "New note"), 60),
    markdown: body || (zh ? "（暂无内容）" : "(empty)"),
  });
  return { summary: zh ? "根据指令新建一条笔记" : "Create a note from the instruction", ops };
}
