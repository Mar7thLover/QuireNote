/**
 * 面向业务的 AI 任务：组织提示词、调用模型，输出统一的 core 数据结构。
 */
import {
  AgentOp,
  type AgentProposal,
  ARTIFACT_KIND_META,
  type ArtifactData,
  type ArtifactKind,
  type ElementType,
  MARKDOWN_ARTIFACTS,
  newId,
} from "@quirenote/core";
import { generateChatText, generateStructured, streamChat } from "./chat";
import {
  AgentDraft,
  type AgentOpDraft,
  ElementsDraft,
  EnrichDraft,
  FlashcardsDraft,
  HighlightsDraft,
  ImagePromptDraft,
  MindmapDraft,
  PodcastDraft,
  QuizDraft,
  ResearchQueriesDraft,
  SlidesDraft,
  TableDraft,
  TimelineDraft,
} from "./drafts";
import { isChinese, truncate } from "./text";
import type { ModelRef, Passage } from "./types";

// ───────────── 提示词工具 ─────────────

export function formatPassages(passages: Passage[], maxChars = 24_000): string {
  const out: string[] = [];
  let used = 0;
  for (const p of passages) {
    const head = `[${p.n}]${p.title ? ` 《${p.title}》` : ""}${p.heading ? ` · ${p.heading}` : ""}`;
    const block = `${head}\n${p.text.trim()}`;
    if (used + block.length > maxChars && out.length) break;
    out.push(block);
    used += block.length;
  }
  return out.join("\n\n");
}

function langHint(passages: Passage[], extra = ""): string {
  return isChinese(extra + passages.map((p) => p.text.slice(0, 300)).join(""))
    ? "请用简体中文回答。"
    : "Answer in English.";
}

/** 带引用对话的系统提示词：编号片段 + 引用规则。 */
export function buildCitationSystemPrompt(passages: Passage[], question = ""): string {
  const rules = [
    "你是 QuireNote 的研究助手，只依据下方编号资料片段回答用户问题。",
    "规则：",
    "1. 每个关键结论后用方括号标注来源编号，例如 [1] 或 [2, 3]，编号必须来自下方片段。",
    "2. 资料中没有的信息不要编造；如果资料不足以回答，请直接说明。",
    "3. 回答使用 Markdown，简洁、结构清晰。",
    langHint(passages, question),
  ].join("\n");
  if (!passages.length) return `${rules}\n\n（当前没有可用的资料片段。）`;
  return `${rules}\n\n# 资料片段\n\n${formatPassages(passages)}`;
}

// ───────────── Studio 生成物 ─────────────

export interface ArtifactInput {
  kind: ArtifactKind;
  passages: Passage[];
  title?: string;
  instructions?: string;
}

const KIND_GUIDE: Record<ArtifactKind, string> = {
  report: "写一份结构完整的研究报告：概述、分节论述、结论。使用 Markdown 标题和列表。",
  briefing: "写一份简报：先列 3–5 条核心结论，再给背景与影响。篇幅精炼。",
  study_guide: "写一份学习指南：核心概念及解释、知识要点、自测问题（含简短答案）。",
  faq: "写一份 FAQ：6–10 个常见问题，每个用二级标题提问，下面给出回答。",
  infographic: "写一份信息图文案（Markdown）：一句话总结、关键数字、关键年份、3–5 个要点，每条极简。",
  timeline: "按时间顺序抽取关键事件，date 用年份或具体日期。",
  mindmap: "生成思维导图：一个根节点（主题），2–3 层子节点，标签简短（不超过 15 字），说明放在 note。",
  flashcards: "生成 8–15 张闪卡：正面是问题或术语，背面是简洁准确的答案。",
  quiz: "生成 5–10 道单选题，每题 4 个选项，answer 为正确选项下标（从 0 开始），附解析。",
  table: "把资料中的关键信息整理成一张对比表格，选择合适的列，行数 3–15。",
  slides: "生成 6–10 页幻灯片：每页标题 + 3–5 条要点，notes 为演讲者备注。",
  audio: "写一段两位主持人（A 和 B）的播客对话脚本，自然口语化，15–30 句，A 引导话题，B 提问并回应。",
  video: "生成视频概览的幻灯片：6–8 页，每页标题 + 2–4 条要点，notes 为该页的旁白文字。",
  image: "为资料写一段英文图像生成提示词：描述画面主体、风格与构图，不要出现文字。",
};

function artifactSystem(kind: ArtifactKind, passages: Passage[], title?: string): string {
  const meta = ARTIFACT_KIND_META[kind];
  return [
    `你是 QuireNote 的 Studio 助手，负责根据资料生成「${meta.label}」(${meta.labelEn})。`,
    KIND_GUIDE[kind],
    "只使用资料中的信息，不要编造。",
    kind === "image" ? "" : langHint(passages, title),
  ]
    .filter(Boolean)
    .join("\n");
}

function artifactPrompt(input: ArtifactInput): string {
  return [
    input.title ? `标题：${input.title}` : "",
    input.instructions?.trim() ? `用户要求：${input.instructions.trim()}` : "",
    `# 资料\n\n${formatPassages(input.passages)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** 草稿 → core 的 ArtifactData（补 id、修正结构）。 */
export function draftToArtifactData(kind: ArtifactKind, draft: unknown): ArtifactData {
  switch (kind) {
    case "mindmap":
      return { kind: "mindmap", nodes: normalizeMindmap(MindmapDraft.parse(draft)) };
    case "flashcards":
      return {
        kind: "flashcards",
        cards: FlashcardsDraft.parse(draft)
          .cards.filter((c) => c.front.trim())
          .map((c) => ({ id: newId("fc"), front: c.front.trim(), back: c.back.trim(), elementId: null })),
      };
    case "quiz":
      return {
        kind: "quiz",
        questions: QuizDraft.parse(draft)
          .questions.filter((q) => q.options.length >= 2)
          .map((q) => ({
            id: newId("qz"),
            question: q.question,
            options: q.options,
            answer: Math.max(0, Math.min(q.options.length - 1, q.answer)),
            explanation: q.explanation,
          })),
      };
    case "timeline":
      return {
        kind: "timeline",
        events: TimelineDraft.parse(draft).events.map((e) => ({ id: newId("ev"), ...e })),
      };
    case "table":
      return { kind: "table", table: tableFromDraft(TableDraft.parse(draft)) };
    case "slides":
      return { kind: "slides", slides: slidesFromDraft(SlidesDraft.parse(draft)) };
    case "video":
      return { kind: "video", slides: slidesFromDraft(SlidesDraft.parse(draft)), videoUrl: null };
    case "audio":
      return {
        kind: "audio",
        script: PodcastDraft.parse(draft).script.filter((l) => l.text.trim()),
        audioUrl: null,
      };
    case "image":
      return { kind: "image", prompt: ImagePromptDraft.parse(draft).prompt, imageUrl: null };
    default: {
      const md = typeof draft === "string" ? draft : String((draft as { markdown?: string }).markdown ?? "");
      return { kind: "markdown", markdown: md };
    }
  }
}

function slidesFromDraft(d: SlidesDraft) {
  return d.slides.map((s) => ({
    id: newId("sl"),
    title: s.title,
    bullets: s.bullets,
    notes: s.notes,
    image: null,
  }));
}

export function tableFromDraft(d: TableDraft) {
  const columns = d.columns.map((c, i) => ({ id: `c${i + 1}`, name: c.name, type: c.type }));
  const rows = d.rows.map((r) => {
    const rec: Record<string, string | number | null> = {};
    columns.forEach((c, i) => {
      const v = r[i] ?? null;
      if (v !== null && c.type === "number" && v.trim() !== "" && !Number.isNaN(Number(v)))
        rec[c.id] = Number(v);
      else rec[c.id] = v;
    });
    return rec;
  });
  return { columns, rows };
}

function normalizeMindmap(d: MindmapDraft) {
  const idOf = new Map<string, string>();
  for (const n of d.nodes) if (!idOf.has(n.key)) idOf.set(n.key, newId("mm"));
  let roots = d.nodes.filter((n) => !n.parentKey || !idOf.has(n.parentKey) || n.parentKey === n.key);
  const nodes = d.nodes.map((n) => ({
    id: idOf.get(n.key)!,
    label: n.label,
    note: n.note,
    parentId: n.parentKey && idOf.has(n.parentKey) && n.parentKey !== n.key ? idOf.get(n.parentKey)! : null,
    collapsed: false,
  }));
  if (roots.length !== 1) {
    // 没有或有多个根：补一个总根。
    const rootId = newId("mm");
    for (const n of nodes) if (n.parentId === null) n.parentId = rootId;
    nodes.unshift({
      id: rootId,
      label: roots[0]?.label ?? "主题",
      note: "",
      parentId: null,
      collapsed: false,
    });
    roots = [];
  }
  // 去重 id（模型可能重复 key）
  const seen = new Set<string>();
  return nodes.filter((n) => {
    if (seen.has(n.id)) return false;
    seen.add(n.id);
    return true;
  });
}

const DRAFT_SCHEMA = {
  mindmap: MindmapDraft,
  flashcards: FlashcardsDraft,
  quiz: QuizDraft,
  timeline: TimelineDraft,
  table: TableDraft,
  slides: SlidesDraft,
  video: SlidesDraft,
  audio: PodcastDraft,
  image: ImagePromptDraft,
} as const;

/** 生成 Studio 生成物数据（音频只到脚本、视频只到幻灯片、图片只到提示词，媒体合成由服务端完成）。 */
export async function generateArtifactData(ref: ModelRef, input: ArtifactInput): Promise<ArtifactData> {
  const system = artifactSystem(input.kind, input.passages, input.title);
  const prompt = artifactPrompt(input);
  if (MARKDOWN_ARTIFACTS.includes(input.kind)) {
    const md = await generateChatText(ref, {
      system: `${system}\n直接输出 Markdown 正文，不要用代码块包裹。`,
      prompt,
    });
    return { kind: "markdown", markdown: stripFence(md) };
  }
  const schema = DRAFT_SCHEMA[input.kind as keyof typeof DRAFT_SCHEMA];
  const draft = await generateStructured(ref, {
    schema,
    name: input.kind,
    system,
    prompt,
  });
  return draftToArtifactData(input.kind, draft);
}

function stripFence(md: string): string {
  const m = /^\s*```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/.exec(md);
  return (m ? m[1]! : md).trim();
}

// ───────────── 生成物再加工（refine） ─────────────

export interface RefineInput {
  kind: ArtifactKind;
  data: ArtifactData;
  instruction: string;
  /** 用户选中的部分（Markdown 文本、节点标签、卡片正面等）。 */
  selection?: string;
  passages: Passage[];
  title?: string;
}

/** 把现有数据转成草稿（去 id），让模型在此基础上修改。 */
export function artifactDataToDraft(data: ArtifactData): unknown {
  switch (data.kind) {
    case "markdown":
      return data.markdown;
    case "mindmap":
      return {
        nodes: data.nodes.map((n) => ({ key: n.id, label: n.label, note: n.note, parentKey: n.parentId })),
      };
    case "flashcards":
      return { cards: data.cards.map((c) => ({ front: c.front, back: c.back })) };
    case "quiz":
      return {
        questions: data.questions.map((q) => ({
          question: q.question,
          options: q.options,
          answer: q.answer,
          explanation: q.explanation,
        })),
      };
    case "timeline":
      return { events: data.events.map((e) => ({ date: e.date, title: e.title, detail: e.detail })) };
    case "table":
      return {
        columns: data.table.columns.map((c) => ({ name: c.name, type: c.type })),
        rows: data.table.rows.map((r) =>
          data.table.columns.map((c) => (r[c.id] == null ? "" : String(r[c.id]))),
        ),
      };
    case "slides":
    case "video":
      return { slides: data.slides.map((s) => ({ title: s.title, bullets: s.bullets, notes: s.notes })) };
    case "audio":
      return { script: data.script };
    case "image":
      return { prompt: data.prompt };
  }
}

export async function refineArtifactData(ref: ModelRef, input: RefineInput): Promise<ArtifactData> {
  const current = artifactDataToDraft(input.data);
  const system = [
    artifactSystem(input.kind, input.passages, input.title),
    "你要在现有内容的基础上按用户指令修改。只改动与指令相关的部分，其余保持原样。",
  ].join("\n");
  const prompt = [
    `用户指令：${input.instruction}`,
    input.selection?.trim() ? `只修改这一部分：\n${input.selection.trim()}` : "",
    `现有内容：\n${typeof current === "string" ? current : JSON.stringify(current, null, 2)}`,
    input.passages.length ? `# 资料\n\n${formatPassages(input.passages, 12_000)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  if (input.data.kind === "markdown") {
    const md = await generateChatText(ref, {
      system: `${system}\n输出修改后的完整 Markdown 正文，不要用代码块包裹。`,
      prompt,
    });
    return { kind: "markdown", markdown: stripFence(md) };
  }
  const kind = input.kind === "video" || input.kind === "slides" ? input.kind : input.data.kind;
  const schema = DRAFT_SCHEMA[kind];
  const draft = await generateStructured(ref, {
    schema,
    name: kind,
    system,
    prompt,
  });
  const next = draftToArtifactData(input.kind, draft);
  // 保留媒体地址（脚本改动后由服务端决定是否重新合成）。
  if (next.kind === "audio" && input.data.kind === "audio") next.audioUrl = null;
  if (next.kind === "image" && input.data.kind === "image") next.imageUrl = input.data.imageUrl;
  return next;
}

// ───────────── 元素 ─────────────

export async function extractElements(ref: ModelRef, passages: Passage[]): Promise<ElementsDraft> {
  return generateStructured(ref, {
    schema: ElementsDraft,
    name: "elements",
    system: [
      "从资料中抽取结构化知识元素：concept（概念）、term（术语）、person（人物）、event（事件）、date（日期）、data（数据）、claim（论点）、formula（公式）、question（待解决的问题）。",
      "每个元素给出简洁的定义，quote 必须逐字摘自资料，passage 为出处片段编号。抽取 10–30 个最重要的元素，不要重复。",
      langHint(passages),
    ].join("\n"),
    prompt: formatPassages(passages),
  });
}

export async function enrichElement(
  ref: ModelRef,
  input: { name: string; type: ElementType; definition: string; passages: Passage[] },
): Promise<EnrichDraft> {
  return generateStructured(ref, {
    schema: EnrichDraft,
    name: "enrich",
    system: [
      "为一个知识元素补充定义：给出准确、完整但简洁的定义（2–4 句），常见别名，以及资料中相关的其他概念。",
      "优先依据资料；资料不足时可用通识补充，但不要编造具体事实。",
      langHint(input.passages, input.name),
    ].join("\n"),
    prompt: [
      `元素：${input.name}（类型：${input.type}）`,
      input.definition ? `现有定义：${input.definition}` : "",
      `# 资料\n\n${formatPassages(input.passages, 12_000)}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
}

// ───────────── Agent 命令 ─────────────

export interface AgentNote {
  id: string;
  title: string;
  markdown: string;
}

export interface AgentInput {
  instruction: string;
  notes: AgentNote[];
  selection?: string;
  passages: Passage[];
  /** 可供 add_mindmap_node 使用的思维导图。 */
  mindmaps?: { id: string; title: string; nodes: { id: string; label: string }[] }[];
}

export function agentOpFromDraft(d: AgentOpDraft): AgentOp | null {
  const candidate: Record<string, unknown> = { op: d.op };
  switch (d.op) {
    case "create_note":
      Object.assign(candidate, { title: d.title ?? "新笔记", markdown: d.markdown ?? "" });
      break;
    case "update_note":
      Object.assign(candidate, {
        noteId: d.noteId,
        markdown: d.markdown ?? "",
        ...(d.title ? { title: d.title } : {}),
      });
      break;
    case "delete_note":
      Object.assign(candidate, { noteId: d.noteId });
      break;
    case "create_table":
      if (!d.table) return null;
      Object.assign(candidate, {
        title: d.title ?? "表格",
        table: tableFromDraft({
          columns: d.table.columns.map((name) => ({ name, type: "text" })),
          rows: d.table.rows,
        }),
      });
      break;
    case "add_mindmap_node":
      Object.assign(candidate, { artifactId: d.artifactId, parentId: d.parentId, label: d.label ?? "" });
      break;
    case "create_element":
      Object.assign(candidate, {
        type: d.elementType ?? "concept",
        name: d.name ?? "",
        definition: d.definition ?? "",
      });
      break;
  }
  const parsed = AgentOp.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export async function proposeAgentOps(ref: ModelRef, input: AgentInput): Promise<AgentProposal> {
  const draft = await generateStructured(ref, {
    schema: AgentDraft,
    name: "agent_proposal",
    system: [
      "你是 QuireNote 的笔记 Agent。根据用户的自然语言指令，提出一组对笔记 / 表格 / 思维导图 / 元素的改动。",
      "可用操作：create_note(title, markdown)、update_note(noteId, title?, markdown 为完整新内容)、delete_note(noteId)、create_table(title, table.columns, table.rows)、add_mindmap_node(artifactId, parentId, label)、create_element(elementType, name, definition)。",
      "不用的字段填 null。noteId / artifactId / parentId 必须来自给定内容。改动会以 diff 形式给用户确认。",
      langHint(input.passages, input.instruction),
    ].join("\n"),
    prompt: [
      `指令：${input.instruction}`,
      input.selection ? `选中内容：\n${input.selection}` : "",
      input.notes.length
        ? `# 笔记\n\n${input.notes.map((n) => `## [${n.id}] ${n.title}\n${n.markdown}`).join("\n\n")}`
        : "",
      input.mindmaps?.length
        ? `# 思维导图\n\n${input.mindmaps
            .map((m) => `## [${m.id}] ${m.title}\n${m.nodes.map((n) => `- [${n.id}] ${n.label}`).join("\n")}`)
            .join("\n\n")}`
        : "",
      input.passages.length ? `# 资料\n\n${formatPassages(input.passages, 10_000)}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
  const noteIds = new Set(input.notes.map((n) => n.id));
  const ops = draft.ops
    .map(agentOpFromDraft)
    .filter((op): op is AgentOp => !!op)
    .filter((op) => !("noteId" in op) || noteIds.has(op.noteId));
  return { id: newId("prop"), summary: draft.summary, ops };
}

// ───────────── 就地 AI ─────────────

export type TransformAction =
  | "explain"
  | "rewrite"
  | "expand"
  | "translate"
  | "summarize"
  | "find_source"
  | "quiz"
  | "custom";

export interface TransformInput {
  action: TransformAction;
  text: string;
  passages: Passage[];
  instruction?: string;
  targetLang?: string;
}

const ACTION_PROMPT: Record<TransformAction, string> = {
  explain: "解释下面这段文字的含义，必要时结合资料补充背景。",
  rewrite: "改写下面这段文字，使其更清晰流畅，保持原意。只输出改写结果。",
  expand: "扩写下面这段文字，补充细节与例子，可引用资料。",
  translate: "翻译下面这段文字。只输出译文。",
  summarize: "用 1–3 句话总结下面这段文字。",
  find_source: "在资料片段中找出支持或涉及下面这段文字的出处，逐条列出并引用编号。",
  quiz: "根据下面这段文字出 3 道单选题，附答案。",
  custom: "按用户指令处理下面这段文字。",
};

export function transformStream(ref: ModelRef, input: TransformInput): AsyncGenerator<string> {
  const target = input.targetLang ? `目标语言：${input.targetLang}。` : "";
  const system = [
    "你是嵌在编辑器里的写作助手。",
    ACTION_PROMPT[input.action],
    target,
    input.passages.length ? "引用资料时用 [n] 标注编号，编号必须来自给定片段。" : "",
    input.action === "translate" ? "" : langHint([], input.text),
    input.passages.length ? `# 资料片段\n\n${formatPassages(input.passages, 12_000)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const user = [input.instruction ? `指令：${input.instruction}` : "", `文字：\n${input.text}`]
    .filter(Boolean)
    .join("\n\n");
  return streamChat(ref, {
    system,
    messages: [{ role: "user", content: user }],
  });
}

// ───────────── 自动标注 / 摘要 / 研究 ─────────────

export async function autoHighlights(
  ref: ModelRef,
  text: string,
): Promise<{ start: number; end: number; note: string }[]> {
  const draft = await generateStructured(ref, {
    schema: HighlightsDraft,
    name: "highlights",
    system: `标注资料中的 3–8 个最关键的句子。quote 必须逐字摘录原文中的一整句，note 用几个字说明为什么重要。${langHint([], text)}`,
    prompt: text.slice(0, 30_000),
  });
  const out: { start: number; end: number; note: string }[] = [];
  for (const h of draft.highlights) {
    const q = h.quote.trim();
    if (!q) continue;
    const start = text.indexOf(q);
    if (start >= 0) out.push({ start, end: start + q.length, note: h.note });
  }
  return out;
}

export async function summarizeText(ref: ModelRef, text: string, title?: string): Promise<string> {
  return generateChatText(ref, {
    system: `用 2–3 句话概括这份资料的主要内容，不要使用列表或标题。${langHint([], text)}`,
    prompt: `${title ? `标题：${title}\n\n` : ""}${text.slice(0, 16_000)}`,
  });
}

export async function researchQueries(
  ref: ModelRef,
  question: string,
  round: number,
  gathered: { title: string; snippet: string }[],
): Promise<string[]> {
  if (round <= 1) return [question];
  const draft = await generateStructured(ref, {
    schema: ResearchQueriesDraft,
    name: "queries",
    system: "你在做多轮网络研究。根据研究问题与已获得的结果，提出 1–3 个新的搜索查询，覆盖尚未回答的方面。",
    prompt: `研究问题：${question}\n\n已有结果：\n${gathered
      .slice(0, 20)
      .map((g) => `- ${g.title}: ${truncate(g.snippet, 160)}`)
      .join("\n")}`,
  });
  const qs = draft.queries.map((q) => q.trim()).filter(Boolean);
  return qs.length ? qs.slice(0, 3) : [question];
}
