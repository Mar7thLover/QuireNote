/**
 * 内置使用手册。首页「使用手册」的卡片取每节的 title / summary，点开后在手册里定位到该节。
 * 正文是 Markdown；中英文各一份，结构一致。
 */
import type { LucideIcon } from "lucide-react";
import {
  BookOpenText,
  Command,
  Database,
  FileStack,
  Gauge,
  Globe,
  Highlighter,
  MessageSquareQuote,
  NotebookPen,
  PlugZap,
  Repeat,
  Sparkles,
} from "lucide-react";

export interface ManualSection {
  id: string;
  icon: LucideIcon;
  title: string;
  /** 一两句话，首页卡片用。 */
  summary: string;
  body: string;
}

type Lang = "zh" | "en";

const ICONS: Record<string, LucideIcon> = {
  start: PlugZap,
  sources: FileStack,
  chat: MessageSquareQuote,
  reading: Highlighter,
  notes: NotebookPen,
  studio: Sparkles,
  research: Globe,
  review: Repeat,
  commands: Command,
  usage: Gauge,
  data: Database,
  about: BookOpenText,
};

const ZH: Omit<ManualSection, "icon">[] = [
  {
    id: "start",
    title: "开始使用",
    summary: "连接一个模型、新建 Notebook、导入资料，三步就能对着自己的资料提问。",
    body: `QuireNote 是一本研究笔记本：把资料放进来，对着资料提问、阅读、做笔记、生成学习材料。

### 1. 连接模型
打开 **设置 → 模型与服务**，添加一个提供方（Anthropic、OpenAI、Gemini、Ollama 或任何兼容接口），填入 API Key，再为「对话」分配模型。

只有 Claude 也能用全部核心功能：对话、联网搜索、读图、矢量插图都由 Claude 完成；没有 Embedding 接口时，检索也有替代方案（见「提问与引用」）。

### 2. 新建 Notebook
一个 Notebook 对应一个研究主题。首页点 **新建 Notebook**，或按 \`Ctrl K\` 输入「新建」。

### 3. 导入资料
在 Notebook 里打开 **资料** 面板，点 **添加**：上传文件、粘贴网址、粘贴文本、录音，或者联网搜索。资料处理完成后就可以提问。`,
  },
  {
    id: "sources",
    title: "资料",
    summary: "PDF、网页、文档、音视频、图片都能导入；勾选的资料决定对话和 Studio 的范围。",
    body: `### 支持的资料
- **文件**：PDF、Word、Markdown、纯文本、EPUB 等。
- **网页**：粘贴网址，自动抓取正文；YouTube 链接会取字幕。
- **图片**：由对话模型直接读图，识别文字与内容（Claude 支持读图）。
- **音视频**：需要「语音转写」能力（OpenAI、Gemini 等）。
- **粘贴文本**、**录音**、**联网搜索结果**。

### 勾选范围
资料列表左侧的勾选框决定哪些资料参与对话和 Studio 生成。只勾选相关的几份，回答会更集中。

### 编辑原文
资料全文可以直接修改（例如修正 OCR 错字），随时可以恢复到导入时的原文。`,
  },
  {
    id: "chat",
    title: "提问与引用",
    summary: "回答里的 [n] 可以点开核对原文。资料不多时整份交给模型阅读，资料多时先检索。",
    body: `### 引用
回答中的每个关键结论后面都有 **[n]** 标记。点开可以看到被引用的原文，再点一次跳到资料中的位置。引用由服务端逐条核对，找不到出处的编号会被去掉。

### 模型如何读到资料
- **资料不多时**（合计约 6 万字以内）：所选资料整份交给模型阅读，概括、对比、跨资料的问题都能完整回答。资料部分每轮不变，Claude 会缓存这部分内容，连续追问时这部分按缓存价计费（约为原价的十分之一）。
- **资料较多时**：先检索最相关的片段，再按每份资料均匀补充一些片段，保证「这几份资料分别讲了什么」这类问题也有内容可答。

### 没有 Embedding 模型时
Anthropic 没有 Embedding 接口。这时由对话模型把提问扩展成多组检索词（同义词、上下位概念、中英文对照、全称与缩写），再做全文检索，代替向量检索找到「换了说法」的段落。配置了 Embedding 模型后会自动改用向量检索。

### 分支与重新生成
可以编辑之前的提问、重新生成回答，每个版本都会保留，用箭头切换。`,
  },
  {
    id: "reading",
    title: "阅读、高亮与批注",
    summary: "选中文字即可提问、解释、高亮、批注或摘录为卡片；点击已有高亮可以改色或删除。",
    body: `### 选中文字
在资料里选中一段文字，会出现工具栏：询问 AI、解释、高亮（五种颜色）、批注、摘录为卡片。

### 已有的高亮
点击高亮可以改颜色、写批注或删除。重叠的高亮会自动合并成一段。

### 阅读区保持安静
阅读区不显示计数、提示和动画，只有文字本身。字体、字号、行距在 **设置 → 外观** 里调整。`,
  },
  {
    id: "notes",
    title: "笔记",
    summary: "富文本编辑器，支持斜杠命令、AI 草稿、拖入资料片段；字数统计在首页。",
    body: `### 编辑
输入 \`/\` 打开斜杠菜单，插入标题、列表、引用、代码、表格等。从资料或对话里可以把片段直接拖进笔记。

### AI 草稿
在笔记里可以让 AI 改写、扩写、翻译、总结，结果先以草稿形式出现，确认后才写入。

### 最近打开
首页的「最近打开」按打开时间排列，点一下就回到那条笔记。`,
  },
  {
    id: "studio",
    title: "Studio 生成物",
    summary: "报告、思维导图、闪卡、测验、幻灯片、音频概览……生成后都可以继续编辑和让 AI 修改。",
    body: `### 生成
在 **Studio** 面板选择一种生成物，可以补充要求（例如「面向高中生」「控制在 800 字以内」），基于当前勾选的资料生成。

### 再加工
生成物都可以直接编辑；也可以选中一部分，让 AI 按你的要求修改。

### 多媒体
- **音频概览**：生成双人对谈脚本。配置了语音合成（TTS）时合成为音频文件；没有配置时用系统自带的语音朗读，脚本可以先编辑。
- **配图**：可以用图像模型（OpenAI、Gemini、Flux 等），也可以直接用 Claude 绘制矢量插图（SVG）。
- **视频概览**：幻灯片加旁白，需要服务端安装 ffmpeg。`,
  },
  {
    id: "research",
    title: "联网搜索与深度研究",
    summary: "Claude 自带联网搜索；深度研究会多轮检索、导入网页并写成报告。",
    body: `### 联网搜索
在 **联网搜索** 面板输入问题，结果可以一键导入为资料。搜索后端可以是：
- **Claude**（Anthropic 自带的 web search，按次计费，约每千次 10 美元）
- Tavily、Brave、自托管的 SearXNG

在 **设置 → 模型与服务** 里为「联网搜索」分配一个即可。

### 深度研究
提出一个研究问题，QuireNote 会多轮改写查询、搜索、抓取网页正文导入为资料，最后基于这些资料写一份带引用的报告。`,
  },
  {
    id: "review",
    title: "元素与复习",
    summary: "从资料中抽取概念、人物、事件；闪卡加入复习后按遗忘曲线安排。",
    body: `### 元素
**元素** 面板从资料中抽取概念、术语、人物、事件、数据等，形成关系图。每个元素都能追溯到原文。

### 复习
闪卡、元素都可以加入复习。复习按间隔重复算法安排：记得牢的间隔越来越长，忘记的会更快再出现。首页会显示今天到期的卡片数。`,
  },
  {
    id: "commands",
    title: "命令面板与快捷键",
    summary: "Ctrl K 搜索一切；在 Notebook 里输入一句话，AI 会提出改动并等你确认。",
    body: `### 命令面板
按 \`Ctrl K\` 打开：跳转到笔记、Notebook、设置，打开面板，切换深浅色和语言。

### 用一句话改动
在 Notebook 里，在命令面板输入一句自然语言（例如「把关于图灵测试的笔记合并成一篇」），AI 会给出改动预览，确认后才生效，生效后可以撤销。

### 常用快捷键
按 \`Ctrl /\` 查看全部快捷键。`,
  },
  {
    id: "usage",
    title: "用量与花费",
    summary: "每次调用的 Token 都会记录；按官方价格估算本月花费，可以设置月度预算。",
    body: `### 记录了什么
每次调用模型（对话、生成、检索词扩展、联网搜索、Embedding）都会记录输入、输出、缓存读写的 Token 数，按天汇总。

### 花费如何估算
Claude 模型按 Anthropic 官方标价估算，包含缓存读写的折扣与联网搜索的按次费用。其他提供方的模型只统计 Token，不估价。估算值可能与账单略有出入，以服务商账单为准。

### 月度预算
在首页「本月花费」卡片上设置月度预算，圆环显示已用比例，接近上限时变成警示色。预算只用来提醒，不会阻止调用。

### 省钱的做法
- 连续追问同一批资料时，资料部分会命中缓存。
- 检索词扩展、联网搜索可以分配给更便宜的模型（如 Claude Haiku）。`,
  },
  {
    id: "data",
    title: "数据与备份",
    summary: "所有数据保存在你自己的服务器上；可以整库备份，或单独导出某个 Notebook。",
    body: `### 存储
资料、笔记、对话都保存在服务端的数据目录里；API Key 加密保存，从不回传给浏览器。

### 备份与恢复
**设置 → 数据管理** 可以下载整库备份，或从备份恢复。单个 Notebook 可以在首页卡片的菜单里导出为 zip，再在首页「导入」。`,
  },
];

const EN: Omit<ManualSection, "icon">[] = [
  {
    id: "start",
    title: "Getting started",
    summary: "Connect a model, create a notebook, add sources — then ask questions about your own material.",
    body: `QuireNote is a research notebook: bring in sources, then ask, read, take notes and generate study material from them.

### 1. Connect a model
Open **Settings → Models & services**, add a provider (Anthropic, OpenAI, Gemini, Ollama or any compatible endpoint), enter the API key and assign a model to **Chat**.

Claude alone covers every core feature: chat, web search, reading images and vector illustrations. Without an embedding endpoint, retrieval still has a substitute (see "Asking & citations").

### 2. Create a notebook
One notebook per research topic. Click **New notebook** on the home page, or press \`Ctrl K\` and type "new".

### 3. Add sources
Open the **Sources** panel and click **Add**: upload files, paste a URL or text, record audio, or search the web. Once a source is processed you can start asking.`,
  },
  {
    id: "sources",
    title: "Sources",
    summary:
      "PDFs, web pages, documents, audio, video and images; the checked sources scope chat and Studio.",
    body: `### What you can add
- **Files**: PDF, Word, Markdown, plain text, EPUB and more.
- **Web pages**: paste a URL and the article text is extracted; YouTube links use captions.
- **Images**: the chat model reads the image directly (Claude supports vision).
- **Audio and video**: need a speech-to-text model (OpenAI, Gemini, …).
- **Pasted text**, **recordings**, **web search results**.

### Scope
The checkboxes in the source list decide which sources chat and Studio use. Checking only the relevant ones gives more focused answers.

### Editing the text
A source's full text can be edited (to fix OCR errors, say) and restored to the imported original at any time.`,
  },
  {
    id: "chat",
    title: "Asking & citations",
    summary:
      "Every [n] in an answer opens the quoted passage. Small notebooks are read whole; large ones are searched first.",
    body: `### Citations
Key claims end with an **[n]** marker. Open it to see the quoted passage, and again to jump to it in the source. Citations are checked on the server; numbers without a matching passage are removed.

### How the model sees your sources
- **Small sets** (up to roughly 60,000 characters): the selected sources are given to the model whole, so summaries, comparisons and cross-source questions are answered completely. That part of the prompt stays the same between turns, so Claude caches it and follow-up questions bill it at the cache rate (about a tenth of the normal price).
- **Larger sets**: the most relevant passages are retrieved first, then each source contributes a few evenly spread passages so overview questions still have material to work with.

### Without an embedding model
Anthropic has no embedding endpoint. Instead the chat model expands your question into several search phrasings (synonyms, broader and narrower terms, Chinese and English equivalents, full names and abbreviations) and runs full-text search with each, which finds passages that use different wording. Assign an embedding model and vector search is used automatically.

### Branches and regeneration
Edit an earlier question or regenerate an answer; every version is kept and you can switch between them with the arrows.`,
  },
  {
    id: "reading",
    title: "Reading & highlights",
    summary:
      "Select text to ask, explain, highlight, annotate or save it as a card; click a highlight to recolor or remove it.",
    body: `### Selecting text
Select a passage in a source to get the toolbar: ask AI, explain, highlight (five colors), annotate, save as a card.

### Existing highlights
Click a highlight to change its color, add a note or remove it. Overlapping highlights merge into one.

### A quiet reader
The reader shows no counts, hints or animations — just the text. Font, size and spacing live in **Settings → Appearance**.`,
  },
  {
    id: "notes",
    title: "Notes",
    summary:
      "A rich-text editor with slash commands, AI drafts and drag-in snippets; word counts show on the home page.",
    body: `### Editing
Type \`/\` for headings, lists, quotes, code and tables. Snippets from sources or chat can be dragged straight into a note.

### AI drafts
Ask AI to rewrite, expand, translate or summarize; the result appears as a draft and is only applied when you accept it.

### Recently opened
The home page lists notes by when you last opened them; one click takes you back.`,
  },
  {
    id: "studio",
    title: "Studio",
    summary:
      "Reports, mind maps, flashcards, quizzes, slides, audio overviews… everything stays editable afterwards.",
    body: `### Generating
Pick an output in the **Studio** panel, optionally add instructions ("for high-school students", "under 800 words"), and it is generated from the checked sources.

### Refining
Every output can be edited directly, or you can select part of it and ask AI to change it.

### Media
- **Audio overview**: a two-host script. With a text-to-speech model it is rendered to an audio file; without one, your system voices read it aloud and the script stays editable.
- **Illustration**: use an image model (OpenAI, Gemini, Flux, …) or let Claude draw a vector illustration (SVG).
- **Video overview**: slides with narration; needs ffmpeg on the server.`,
  },
  {
    id: "research",
    title: "Web search & deep research",
    summary:
      "Claude has built-in web search; deep research searches in rounds, imports pages and writes a report.",
    body: `### Web search
Type a question in the **Web search** panel and import results as sources with one click. The backend can be:
- **Claude** (Anthropic's built-in web search, billed per search — about $10 per 1,000)
- Tavily, Brave or a self-hosted SearXNG

Assign one to **Web search** in **Settings → Models & services**.

### Deep research
Ask a research question and QuireNote rewrites queries over several rounds, searches, imports the page text as sources and finally writes a cited report from them.`,
  },
  {
    id: "review",
    title: "Elements & review",
    summary:
      "Extract concepts, people and events from sources; flashcards are scheduled along the forgetting curve.",
    body: `### Elements
The **Elements** panel extracts concepts, terms, people, events, figures and more into a graph. Every element links back to the source text.

### Review
Flashcards and elements can be added to review. Cards are scheduled with spaced repetition: the better you remember, the longer the interval. The home page shows how many are due today.`,
  },
  {
    id: "commands",
    title: "Command palette & shortcuts",
    summary:
      "Ctrl K finds everything; inside a notebook, describe a change in plain words and AI proposes it for review.",
    body: `### Command palette
Press \`Ctrl K\` to jump to notes, notebooks and settings, open panels, and switch theme or language.

### One-sentence changes
Inside a notebook, type a request in plain words ("merge my notes about the Turing test into one"). AI shows a preview of the changes; nothing happens until you accept, and you can undo afterwards.

### Shortcuts
Press \`Ctrl /\` for the full list.`,
  },
  {
    id: "usage",
    title: "Usage & cost",
    summary:
      "Every call's tokens are recorded; this month's cost is estimated at list prices, with an optional budget.",
    body: `### What is recorded
Every model call (chat, generation, query expansion, web search, embeddings) records input, output and cache tokens, summed per day.

### How cost is estimated
Claude models are priced at Anthropic's list prices, including cache discounts and per-search fees. Other providers' models are counted in tokens but not priced. Estimates can differ slightly from your invoice; the provider's bill is authoritative.

### Monthly budget
Set a monthly budget on the home page's "This month" card. The ring shows how much is used and turns to a warning color near the limit. The budget only reminds you; it never blocks calls.

### Saving money
- Follow-up questions on the same sources hit the prompt cache.
- Query expansion and web search can use a cheaper model such as Claude Haiku.`,
  },
  {
    id: "data",
    title: "Data & backup",
    summary: "Everything lives on your own server; back up the whole library or export a single notebook.",
    body: `### Storage
Sources, notes and conversations are stored in the server's data directory; API keys are encrypted and never sent to the browser.

### Backup and restore
**Settings → Data** downloads a full backup or restores one. A single notebook can be exported as a zip from its card menu on the home page and brought back with **Import**.`,
  },
];

export function manualSections(lang: Lang): ManualSection[] {
  return (lang === "en" ? EN : ZH).map((s) => ({ ...s, icon: ICONS[s.id] ?? BookOpenText }));
}
