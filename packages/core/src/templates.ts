/**
 * 写作模板：笔记模板（带占位符的 Markdown）和 Notebook 模板（一张 Quire 卡：几篇笔记、AI 说明、默认预设，
 * 小说项目还带稿件结构）。内置模板跟随界面语言，自定义的存在设置里。
 */
import { QUIRE_CARD_SPEC, QUIRE_CARD_VERSION, QuireCard } from "./card";

export interface NoteTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  markdown: string;
  kind: "note" | "card";
  builtin: boolean;
}

export interface NotebookTemplateInfo {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  builtin: boolean;
}

export interface NotebookTemplate extends NotebookTemplateInfo {
  card: QuireCard;
}

const en = (lang?: string) => !!lang?.toLowerCase().startsWith("en");

/** 占位符：{{日期}} {{时间}} {{星期}} {{标题}}，英文写法 {{date}} {{time}} {{weekday}} {{title}} 也认。 */
export function fillTemplate(
  markdown: string,
  opts: { title?: string; now?: Date; lang?: string } = {},
): string {
  const now = opts.now ?? new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const weekday = en(opts.lang)
    ? ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][now.getDay()]!
    : `星期${"日一二三四五六"[now.getDay()]}`;
  const map: Record<string, string> = {
    日期: date,
    date,
    时间: time,
    time,
    星期: weekday,
    weekday,
    标题: opts.title ?? "",
    title: opts.title ?? "",
  };
  return markdown.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (m, k: string) => map[k] ?? m);
}

// ───────────── 内置笔记模板 ─────────────

type T = { id: string; icon: string; zh: [string, string, string]; en: [string, string, string] };

const NOTE_TEMPLATES: T[] = [
  {
    id: "builtin.reading",
    icon: "📖",
    zh: [
      "读书笔记",
      "书名、主要观点、摘录与自己的想法",
      "## 基本信息\n\n- 书名：\n- 作者：\n- 读完日期：{{日期}}\n\n## 一句话总结\n\n\n\n## 主要观点\n\n1. \n\n## 摘录\n\n> \n\n## 我的想法\n\n",
    ],
    en: [
      "Reading notes",
      "Title, key ideas, quotes and your own thoughts",
      "## About the book\n\n- Title:\n- Author:\n- Finished: {{date}}\n\n## In one sentence\n\n\n\n## Key ideas\n\n1. \n\n## Quotes\n\n> \n\n## My thoughts\n\n",
    ],
  },
  {
    id: "builtin.lecture",
    icon: "🎓",
    zh: [
      "课程笔记",
      "要点、疑问和课后复习",
      "## {{日期}} · 主题\n\n## 要点\n\n- \n\n## 例子\n\n\n\n## 还没弄懂的地方\n\n- \n\n## 课后复习\n\n",
    ],
    en: [
      "Lecture notes",
      "Key points, open questions and review",
      "## {{date}} · Topic\n\n## Key points\n\n- \n\n## Examples\n\n\n\n## Still unclear\n\n- \n\n## Review\n\n",
    ],
  },
  {
    id: "builtin.meeting",
    icon: "🗓️",
    zh: [
      "会议记录",
      "参会人、议题、决定和待办",
      "## {{日期}} {{时间}}\n\n- 参会人：\n\n## 议题\n\n1. \n\n## 决定\n\n- \n\n## 待办\n\n- [ ] \n",
    ],
    en: [
      "Meeting notes",
      "Attendees, agenda, decisions and action items",
      "## {{date}} {{time}}\n\n- Attendees:\n\n## Agenda\n\n1. \n\n## Decisions\n\n- \n\n## Action items\n\n- [ ] \n",
    ],
  },
  {
    id: "builtin.character",
    icon: "🧑",
    zh: [
      "人物小传",
      "写小说用：外貌、性格、背景、动机和关系",
      "## 基本\n\n- 姓名：\n- 年龄：\n- 身份：\n\n## 外貌\n\n\n\n## 性格\n\n\n\n## 背景\n\n\n\n## 想要什么，害怕什么\n\n\n\n## 和其他人物的关系\n\n- \n\n## 说话的样子\n\n",
    ],
    en: [
      "Character profile",
      "For fiction: looks, personality, background, motives and relationships",
      "## Basics\n\n- Name:\n- Age:\n- Role:\n\n## Appearance\n\n\n\n## Personality\n\n\n\n## Background\n\n\n\n## Wants and fears\n\n\n\n## Relationships\n\n- \n\n## How they talk\n\n",
    ],
  },
  {
    id: "builtin.world",
    icon: "🗺️",
    zh: [
      "世界观条目",
      "地点、势力、物品或规则的设定",
      "## 概述\n\n- 类别：\n\n## 细节\n\n\n\n## 相关人物\n\n- \n\n## 相关事件\n\n- \n",
    ],
    en: [
      "World entry",
      "A place, faction, object or rule in your setting",
      "## Overview\n\n- Kind:\n\n## Details\n\n\n\n## Related characters\n\n- \n\n## Related events\n\n- \n",
    ],
  },
];

export function builtinNoteTemplates(lang?: string): NoteTemplate[] {
  return NOTE_TEMPLATES.map((t) => {
    const [name, description, markdown] = en(lang) ? t.en : t.zh;
    return { id: t.id, icon: t.icon, name, description, markdown, kind: "note", builtin: true };
  });
}

// ───────────── 内置 Notebook 模板 ─────────────

function card(data: Record<string, unknown>): QuireCard {
  return QuireCard.parse({ spec: QUIRE_CARD_SPEC, spec_version: QUIRE_CARD_VERSION, data });
}

const noteMd = (lang: string | undefined, id: string) =>
  builtinNoteTemplates(lang).find((t) => t.id === id)?.markdown ?? "";

export function builtinNotebookTemplates(lang?: string): NotebookTemplate[] {
  const E = en(lang);
  const research: NotebookTemplate = {
    id: "builtin.research",
    icon: "🔬",
    color: "indigo",
    builtin: true,
    name: E ? "Research project" : "研究课题",
    description: E
      ? "A research question, literature notes and a progress log"
      : "研究问题、文献笔记和进展日志",
    card: card({
      kind: "notebook",
      name: E ? "Research project" : "研究课题",
      notebook: {
        title: E ? "Research project" : "研究课题",
        icon: "🔬",
        color: "indigo",
        default_preset_id: "builtin.research",
      },
      notes: [
        {
          id: "question",
          title: E ? "Research question" : "研究问题",
          markdown: E
            ? "## Question\n\n\n\n## Why it matters\n\n\n\n## What I expect\n\n\n\n## How I'll find out\n\n"
            : "## 问题\n\n\n\n## 为什么重要\n\n\n\n## 我的预期\n\n\n\n## 打算怎么验证\n\n",
        },
        {
          id: "reading",
          title: E ? "Literature notes" : "文献笔记",
          markdown: noteMd(lang, "builtin.reading"),
        },
        {
          id: "log",
          title: E ? "Progress log" : "进展日志",
          markdown: E ? "## {{date}}\n\n- \n" : "## {{日期}}\n\n- \n",
        },
      ],
      ai_instructions: E
        ? "When answering, keep facts from the sources apart from your own inferences, and point out where sources disagree."
        : "回答时区分资料里的事实和你的推断；资料之间有分歧时指出来。",
    }),
  };
  const club: NotebookTemplate = {
    id: "builtin.reading-club",
    icon: "📚",
    color: "amber",
    builtin: true,
    name: E ? "Reading club" : "读书会",
    description: E ? "A reading plan, discussion questions and shared notes" : "阅读计划、讨论问题和共读笔记",
    card: card({
      kind: "notebook",
      name: E ? "Reading club" : "读书会",
      notebook: {
        title: E ? "Reading club" : "读书会",
        icon: "📚",
        color: "amber",
        default_preset_id: "builtin.plain",
      },
      notes: [
        {
          id: "plan",
          title: E ? "Reading plan" : "阅读计划",
          markdown: E
            ? "| Week | Chapters | Who leads |\n| --- | --- | --- |\n| 1 |  |  |\n| 2 |  |  |\n"
            : "| 周次 | 章节 | 领读 |\n| --- | --- | --- |\n| 1 |  |  |\n| 2 |  |  |\n",
        },
        {
          id: "questions",
          title: E ? "Discussion questions" : "讨论问题",
          markdown: E ? "## Week 1\n\n1. \n" : "## 第一周\n\n1. \n",
        },
        { id: "notes", title: E ? "Shared notes" : "共读笔记", markdown: noteMd(lang, "builtin.reading") },
      ],
    }),
  };
  const novel: NotebookTemplate = {
    id: "builtin.novel",
    icon: "✒️",
    color: "rose",
    builtin: true,
    name: E ? "Novel project" : "小说项目",
    description: E
      ? "Manuscript, outline, characters and setting, with a writing partner"
      : "稿件、大纲、人物与设定，配好写作搭档",
    card: card({
      kind: "notebook",
      name: E ? "Novel project" : "小说项目",
      notebook: {
        title: E ? "Novel project" : "小说项目",
        icon: "✒️",
        color: "rose",
        default_preset_id: "builtin.writer",
        manuscript: {
          volumes: [
            {
              title: E ? "Part one" : "第一卷",
              chapters: [{ note_id: "chapter-1", synopsis: "", beats: [] }],
            },
          ],
        },
      },
      notes: [
        {
          id: "premise",
          title: E ? "Premise" : "故事梗概",
          markdown: E
            ? "## In one sentence\n\n\n\n## Theme\n\n\n\n## How it begins\n\n\n\n## How it ends\n\n"
            : "## 一句话故事\n\n\n\n## 主题\n\n\n\n## 开端\n\n\n\n## 结局\n\n",
        },
        {
          id: "protagonist",
          title: E ? "Protagonist" : "主角",
          markdown: noteMd(lang, "builtin.character"),
        },
        { id: "world", title: E ? "Setting" : "世界观", markdown: noteMd(lang, "builtin.world") },
        { id: "chapter-1", title: E ? "Chapter 1" : "第一章", markdown: "" },
      ],
      ai_instructions: E
        ? "This notebook is a novel in progress. Characters and setting follow the lorebook and notes; when continuing the story, keep the existing style, point of view and tense."
        : "这是一部正在写的小说。人物和设定以知识书和笔记为准；续写时保持已有的文风、人称和时态。",
      lorebook: { name: E ? "Characters & setting" : "人物与设定", recursive: true, entries: [] },
    }),
  };
  return [research, club, novel];
}
