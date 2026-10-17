/**
 * 内置使用手册。首页「使用手册」的卡片取每节的 title / summary，点开后在手册里定位到该节。
 * 正文是 Markdown；中英文各一份，结构一致。
 */
import type { LucideIcon } from "lucide-react";
import {
  BookOpenText,
  Command,
  Database,
  Drama,
  FileStack,
  Gauge,
  Globe,
  Highlighter,
  LibraryBig,
  MessageSquareQuote,
  NotebookPen,
  PlugZap,
  Repeat,
  Share2,
  Sparkles,
} from "lucide-react";

export interface ManualSection {
  id: string;
  icon: LucideIcon;
  title: string;
  /** 一两句话，首页卡片用。 */
  summary: string;
  body: string;
  /** 属于某个插件的章节，只在插件启用时出现。 */
  plugin?: string;
}

type Lang = "zh" | "en";

const ICONS: Record<string, LucideIcon> = {
  start: PlugZap,
  sources: FileStack,
  chat: MessageSquareQuote,
  reading: Highlighter,
  notes: NotebookPen,
  lorebook: LibraryBig,
  cards: Share2,
  studio: Sparkles,
  research: Globe,
  review: Repeat,
  commands: Command,
  usage: Gauge,
  data: Database,
  sillytavern: Drama,
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

### 笔记也算资料
你写的笔记和资料一样交给模型阅读，接在资料片段后面编号，也能被引用；点开笔记的引用会打开那条笔记。没有勾选任何资料时，回答就依据这本 Notebook 的笔记和知识书——导入别人分享的笔记本后可以直接提问。

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

### 图片、视频与网页
- **图片**：直接粘贴或拖进笔记，或用斜杠菜单「图片 / 视频 / 音频」上传；文件保存在 Notebook 里，分享卡片时一起带走。
- **视频、音频**：上传后显示播放器；单独一行的 YouTube、Bilibili 链接会变成嵌入播放器。
- **网页链接**：单独一行的网址显示为带标题和缩略图的预览卡。
- **HTML 块**：斜杠菜单「HTML 块」，在沙箱里显示，不会执行脚本。
- **提示框**：行首输入 \`> [!tip]\`（还有 note、important、warning、caution）。

### 卡片语法与正则规则
写 \`【术语：名称｜定义】\` 这样的格式会显示成卡片；在 **设置 → 正则规则** 里可以自己定义「什么文字显示成什么样」。规则只改显示，存下来和交给 AI 的仍是原文。点一下卡片就回到原文编辑。

### 最近打开
首页的「最近打开」按打开时间排列，点一下就回到那条笔记。`,
  },
  {
    id: "lorebook",
    title: "知识书与 AI 说明",
    summary: "写下设定、术语和规矩：对话里出现关键词时，对应的条目才交给 AI；AI 说明每次都会附上。",
    body: `### 知识书是什么
知识书是一组「关键词 → 背景文字」条目，用法和酒馆（SillyTavern）的世界书一样。对话里出现关键词时，对应的文字才交给 AI，作为背景参考；它不会被当成可以引用的资料，回答里的 [n] 仍只指向资料原文。

在 Notebook 里打开 **知识书** 面板：
- **新建条目**：填关键词（用顿号或逗号分隔，写成 \`/正则/\` 按正则匹配）和正文。
- **常驻**：不看关键词，每轮都插入。
- **插入位置**：资料片段之前、之后，或插在对话的倒数第几条消息处。
- **更多选项**：次关键词、触发概率、分组、保持与冷却轮数等。
- **从元素生成**：把这本 Notebook 已有的元素（概念、人物、术语）变成条目。

顶部的测试栏可以输入一句话，看会触发哪些条目、哪些因为超出预算被裁掉。

### AI 说明
知识书面板的「AI 说明」页写给 AI 的要求，例如语气、扮演的角色、回答格式，每次对话和 Studio 生成都会附上。

### 回答里用到了哪些条目
每条回答下方可以展开「用到的知识书」。没有勾选资料时，有知识书或 AI 说明的 Notebook 也能对话，这时回答依据知识书，不带引用。`,
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
**设置 → 数据管理** 可以下载整库备份，或从备份恢复。单个 Notebook 可以在首页卡片的菜单里导出为 zip，再在首页「导入」。备份是本机搬家用的完整快照；要分享给别人，用「Quire 卡」。`,
  },
  {
    id: "cards",
    title: "分享与导入卡片",
    summary: "把笔记或整本 Notebook 分享成一个文件（PNG 卡发图即分享），对方导入后就能完整阅读。",
    body: `### 分享为 Quire 卡
- **单条笔记**：笔记右上角「…」→「分享为 Quire 卡…」。
- **整本 Notebook**：首页卡片的菜单 →「分享为 Quire 卡…」。默认把整本都带上：笔记、资料（全文、高亮和原始文件）、Studio 生成物、元素和复习卡、知识书、AI 说明、渲染规则，不想带的可以取消勾选。对方导入后就是一本能直接阅读、直接提问的笔记本。对话记录不会导出；分享别人的资料时注意版权。

三种格式：
- **.quire**（整本的默认格式）：压缩包，资料的 PDF 等原始文件、图片、音视频原样打包。
- **PNG 图片**：带封面，数据藏在图片里，发图即分享；资料只带文字和高亮。微信、QQ 等会压缩图片，请按「原图」或「文件」发送。
- **JSON**：纯文本，适合放进 Git；资料同样只带文字和高亮。

### 分享链接
在同一个对话框里选「链接」→「生成链接」，会在你自己的服务器上生成一个只读页 \`/share/…\`。对方用浏览器直接阅读，不需要安装 QuireNote，也能从页面右上角下载 PNG / JSON / .quire 卡。
- 页面显示的是当前内容：笔记改了，对方刷新就能看到；资料可以展开阅读（带你的高亮），文字类的生成物也直接显示。带哪些部分在生成时定下。
- 正文里的 HTML 和卡片模板放在沙箱里显示，脚本不会执行；只有分享内容用到的图片和视频能被访问。
- **设置 → 分享链接** 里列出所有链接，可以复制或撤销；撤销后链接立即失效。
- 对方要能从公网访问你的服务器。在设置里填上公开访问地址（比如 \`https://notes.example.com\`）。QuireNote 没有登录，整个服务器暴露出去等于公开所有笔记——建议用反向代理只放行 \`/share/\`、\`/api/public/\`、\`/assets/\` 和 \`/favicon.svg\`。

### 导入
把卡片拖进首页，或点「导入」、在命令面板选「导入卡片…」。导入前会先显示预览：作者、包含的笔记、资料、生成物和元素，常驻的知识书条目、AI 说明，以及会被停用的规则。可以导入成新的 Notebook，或合并进已有的。导入后资料直接能读，高亮都在。

### 卡片带来的规则
卡片里的渲染规则只在它自己的 Notebook 里生效，不会改变你其他笔记的显示。想在所有 Notebook 里使用，到 **设置 → 正则规则 → Notebook 自带的规则** 点「设为全局」。`,
  },
  {
    id: "sillytavern",
    plugin: "sillytavern",
    title: "酒馆兼容（插件）",
    summary: "启用后可以导入 SillyTavern 的角色卡、世界书、正则脚本和预设，并导出回去。",
    body: `这是一个插件，在 **设置 → 插件** 里开关。关掉只隐藏入口，已经导入的内容都会保留。

### 角色卡
导入角色卡（PNG、JSON、CHARX）时，可以在预览里选：
- **导入为 Notebook**：角色设定和开场白是笔记，角色书是知识书，系统提示词是 AI 说明，头像是封面。
- **导入为问答风格**：变成一个对话预设，在任何 Notebook 的对话里都能切换成这个角色的口吻。

### 世界书与正则脚本
- 世界书导入为知识书条目；知识书面板的「导出」里多出「酒馆世界书」。
- 正则脚本变成这本 Notebook 自己的渲染规则；只改显示的直接启用，改写提示词的导入为停用。

### 预设
**设置 → 预设与模板** 里可以导入酒馆的对话预设（JSON），也能把预设导出成酒馆格式。`,
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

### Notes count as material
Your notes are given to the model just like sources — numbered after the source passages and citable; opening a note citation opens that note. With no sources selected, answers draw on the notebook's notes and lorebook, so you can ask questions right after importing someone's shared notebook.

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

### Images, video and web pages
- **Images**: paste or drop them into a note, or use the slash menu's "Image / video / audio" upload; files are stored in the notebook and travel with shared cards.
- **Video and audio**: uploaded files show a player; a YouTube or Bilibili link on its own line becomes an embedded player.
- **Links**: a URL on its own line shows a preview with title and thumbnail.
- **HTML blocks**: slash menu "HTML block", rendered in a sandbox with scripts disabled.
- **Callouts**: start a line with \`> [!tip]\` (also note, important, warning, caution).

### Card syntax and regex rules
Text like \`【术语：name｜definition】\` renders as a card, and **Settings → Regex rules** lets you define your own "this text shows like that". Rules only change the display; what's stored and sent to the AI stays the original text. Click a card to edit the source.

### Recently opened
The home page lists notes by when you last opened them; one click takes you back.`,
  },
  {
    id: "lorebook",
    title: "Lorebook & AI instructions",
    summary:
      "Write down settings, terms and rules: entries reach the AI only when their keywords come up; AI instructions go with every turn.",
    body: `### What a lorebook is
A lorebook is a set of "keywords → background text" entries, the same idea as SillyTavern's world info. When a keyword comes up in chat, its text is given to the AI as background. Entries are never treated as citable sources; the [n] markers in answers still point only at your sources.

Open the **Lorebook** panel in a notebook:
- **New entry**: keywords (comma-separated; write \`/regex/\` for a regular expression) and the content.
- **Always on**: inserted every turn, regardless of keywords.
- **Position**: before or after the sources, or a given number of messages from the end of the chat.
- **More options**: secondary keywords, probability, groups, sticky and cooldown turns.
- **From elements**: turn the notebook's elements (concepts, people, terms) into entries.

The test bar at the top shows which entries a sentence would trigger, and which would be cut for budget.

### AI instructions
The "AI instructions" tab holds what the AI should always know — tone, a role to play, answer format. It's added to every chat and Studio generation.

### Which entries an answer used
Expand "Lorebook used" under an answer. Without any sources selected, a notebook with a lorebook or AI instructions can still chat; answers then draw on the lorebook and carry no citations.`,
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
**Settings → Data** downloads a full backup or restores one. A single notebook can be exported as a zip from its card menu on the home page and brought back with **Import**. Backups are full snapshots for moving between your own machines; to share with others, use a Quire card.`,
  },
  {
    id: "cards",
    title: "Sharing & importing cards",
    summary:
      "Share a note or a whole notebook as one file (a PNG card shares like a picture); whoever imports it can read it in full.",
    body: `### Share as a Quire card
- **One note**: the note's "…" menu → "Share as Quire card…".
- **A whole notebook**: the card menu on the home page → "Share as Quire card…". By default everything goes in: notes, sources (text, highlights and original files), Studio outputs, elements and review cards, the lorebook, AI instructions and render rules — untick what you'd rather leave out. The recipient gets a notebook they can read and ask questions about right away. Conversations are never exported; mind copyright when sharing other people's sources.

Three formats:
- **.quire** (the default for notebooks): a zip with original source files such as PDFs, images, audio and video.
- **PNG image**: has a cover and hides the data inside the image, so it shares like a picture; sources carry their text and highlights only. Chat apps that recompress images strip the data; send the original file.
- **JSON**: plain text, good for Git; sources carry their text and highlights only.

### Share links
In the same dialog, choose "Link" → "Create link" to get a read-only page \`/share/…\` on your own server. Others read it right in their browser — no QuireNote needed — and can download the PNG / JSON / .quire card from the top-right corner.
- The page shows the current content: edit the note and they see the change on reload. Sources can be expanded and read with your highlights, and text-based Studio outputs show inline. Which parts are included is fixed when you create the link.
- HTML and card templates in the text render in a sandbox with scripts disabled; only images and videos used by the shared content can be fetched.
- **Settings → Share links** lists every link so you can copy or revoke it; revoking takes effect immediately.
- Your server must be reachable from the internet. Enter its public address in settings (for example \`https://notes.example.com\`). QuireNote has no login, so exposing the whole server publishes every note — put a reverse proxy in front that only lets \`/share/\`, \`/api/public/\`, \`/assets/\` and \`/favicon.svg\` through.

### Importing
Drop a card onto the home page, click **Import**, or pick "Import card…" in the command palette. A preview comes first: the creator, the notes, sources, Studio outputs and elements inside, always-on lorebook entries, AI instructions and any rules that will be turned off. Import into a new notebook or merge into an existing one. Imported sources are ready to read, highlights included.

### Rules that come with a card
A card's render rules only apply inside its own notebook and never change how your other notes look. To use one everywhere, go to **Settings → Regex rules → Notebook rules** and choose "Make global".`,
  },
  {
    id: "sillytavern",
    plugin: "sillytavern",
    title: "SillyTavern compatibility (plugin)",
    summary:
      "Once on, import SillyTavern character cards, world info, regex scripts and presets — and export back.",
    body: `This is a plugin; turn it on or off in **Settings → Plugins**. Turning it off only hides its entry points; everything you imported stays.

### Character cards
When importing a character card (PNG, JSON, CHARX), choose in the preview:
- **Import as a notebook**: the character and greetings become notes, the character book the lorebook, the system prompt the AI instructions, the avatar the cover.
- **Import as an answering style**: it becomes a chat preset you can switch to in any notebook's chat to answer in that character's voice.

### World info and regex scripts
- World info becomes lorebook entries; the lorebook panel's "Export" gains "SillyTavern world info".
- Regex scripts become the notebook's own render rules; display-only ones are enabled, ones that rewrite the prompt are imported turned off.

### Presets
**Settings → Presets & templates** imports SillyTavern chat presets (JSON) and exports presets in SillyTavern format.`,
  },
];

export function manualSections(
  lang: Lang,
  enabled: (plugin: string) => boolean = () => false,
): ManualSection[] {
  return (lang === "en" ? EN : ZH)
    .filter((s) => !s.plugin || enabled(s.plugin))
    .map((s) => ({ ...s, icon: ICONS[s.id] ?? BookOpenText }));
}
