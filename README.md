# QuireNote

前端优先、多模型、可自托管的 AI Notebook。功能对标 NotebookLM，体验上追求超越：可拆分的工作区、AI 贯穿编辑器与阅读器、所有生成物可编辑、可定制的卡片渲染层。

> QuireNote = quire（书帖，装订成册的一叠书页）+ note。代码、包名（`@quirenote/*`）、环境变量（`QUIRENOTE_*`）和主题文件（`.quirenote-theme`）统一使用这个名字。

## 功能一览

| 模块 | 内容 |
| --- | --- |
| 资料 | PDF / URL / 文本 / Markdown / DOCX / EPUB / 图片 OCR / 音视频转写 / YouTube 字幕；阅读器支持原文对照、划词提问、高亮批注、摘录卡片、AI 标注重点 |
| 对话 | 只依据勾选资料回答，关键结论带可点击引用（悬浮预览、跳转原文高亮）；消息树支持分支、编辑、重新生成；任意消息一键存为卡片 / 笔记 |
| 编辑器 | Tiptap 块编辑；`/` 斜杠命令；选中文字弹出 AI 菜单（解释、改写、扩写、精简、翻译、找出处、出题）；`Ctrl+J` 自定义指令；引用 / 卡片 / 元素标签等自定义节点；AI 结果需确认后写入 |
| Agent | `Ctrl+K` 命令面板支持自然语言操作，AI 的增删改先以 diff 预览，确认后生效，并可撤销 |
| Studio | 报告、简报、学习指南、FAQ、时间线、思维导图、闪卡、测验、数据表格、信息图、幻灯片、音频概览、视频概览、配图；全部可编辑，可用自然语言让 AI 修改局部 |
| 学习 | FSRS 间隔重复复习；闪卡、测验、元素可一键加入复习，掌握度回写到元素 |
| 元素分析 | 抽取概念、术语、人物、事件、日期、数据、论点、公式、问题；列表 / 表格 / 关系图；合并、补充定义、追问、批量出卡、回溯出处 |
| 数据库视图 | 笔记 / 资料 / 生成物 / 元素都可用表格、看板、画廊、日历查看，支持自定义属性、筛选、排序、分组 |
| 自定义渲染 | 正则规则（Web Worker 执行 + 超时 + ReDoS 检测）+ 沙箱 iframe 卡片模板（禁脚本、严格 CSP）；内置 7 套模板；`.quirenote-theme` 导入导出；全局主题（配色、字体、圆角、密度、背景） |
| 联网搜索 | Tavily / Brave / SearXNG，快速搜索结果一键加入资料；深度研究多轮检索后自动导入并出报告 |
| 模型 | Claude、OpenAI、Gemini、Ollama、OpenAI 兼容、ElevenLabs、fal、Replicate、ComfyUI 等；按能力（对话 / Embedding / 搜索 / TTS / STT / 图像 / 视频）分别指定；内置无需 Key 的 Local 模型用于离线演示 |
| 工作区 | dockview 可拆分、拖拽、浮动的面板与标签页；布局预设（研究 / 写作 / 学习 / 专注）和自定义预设；专注模式；移动端底部导航 + 推入式详情页 |
| 离线 | 查询缓存持久化到 IndexedDB，离线可浏览；连接恢复后自动同步 |

## 目录结构

```
apps/web         React 19 + Vite + TanStack Router/Query + Tailwind 4 + dockview + Tiptap + React Flow
apps/server      Hono (Node) + better-sqlite3 + sqlite-vec + FTS5，进程内任务队列，SSE 推送
apps/mobile      Capacitor 壳（iOS / Android）
packages/core    共享 zod schema 与类型、示例数据
packages/ui      设计系统：tokens、组件、动效
packages/render  正则规则引擎、模板渲染、HTML/CSS 清洗、.quirenote-theme
packages/ai      基于 Vercel AI SDK 的多 Provider 抽象与内置 Local 模型
e2e/             Playwright 端到端测试
docs/API.md      前后端接口契约
```

## 快速开始

需要 Node 22.12+ 和 pnpm 11。

```bash
pnpm install
pnpm dev
```

- 前端：http://localhost:5173（`/api` 自动代理到 8787）
- 服务端：http://localhost:8787/api/health
- 首次启动会创建一个示例 Notebook「人工智能简史」。不配置任何 Key 也能完整体验：内置 Local 模型提供哈希 Embedding 和抽取式带引用回答。
- 在「设置 → 模型与服务」添加 Claude / OpenAI / Gemini / Ollama 等，并为每种能力分配模型。Anthropic 没有 Embedding 接口，Embedding 请选 OpenAI、Gemini、Ollama 或 Local。

### Docker 一键部署

```bash
cp .env.example .env   # 可选：填入 Key，或之后在界面里添加
docker compose up -d --build
```

访问 http://localhost:8787。数据保存在 `quirenote-data` 卷中。服务端会同时托管前端页面（`QUIRENOTE_WEB_DIST`）。

### 环境变量

见 [.env.example](.env.example)。常用：`PORT`、`QUIRENOTE_DATA_DIR`、`QUIRENOTE_SECRET`（Key 加密主密钥）、`QUIRENOTE_SEED=0`（不建示例数据）、`QUIRENOTE_JOB_CONCURRENCY`、`FFMPEG_PATH`；以及 `ANTHROPIC_API_KEY` 等启动时自动添加的 Provider（均支持 `*_FILE`）。

## 开发命令

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 同时启动 web 与 server |
| `pnpm lint` / `pnpm format` | Biome 检查 / 自动修复 |
| `pnpm typecheck` | 全部包的 TypeScript 严格模式检查 |
| `pnpm test` | Vitest 单元测试 |
| `pnpm e2e` | Playwright 端到端测试（自动启动独立的服务端和前端，数据目录 `data-e2e`） |
| `node scripts/tour.mjs [--dark]` | 对运行中的开发服务器做界面巡检截图，输出到 `e2e/.screens/` |

首次运行 E2E 前需要 `pnpm exec playwright install chromium`。

## 技术选型说明（相对默认方案的调整）

- **Biome 代替 ESLint + Prettier**：一个工具同时负责 lint 和格式化，速度快，monorepo 只需一份配置。
- **dockview 作为工作区面板**：原生支持标签页、拖拽拆分、浮动组和布局序列化。
- **存储层没有使用 Drizzle**：服务端定义了 repository 接口，SQLite 实现直接使用 better-sqlite3。FTS5 虚表、sqlite-vec 向量表和触发器都需要手写 SQL，ORM 带来的收益有限。要换成 Postgres + pgvector 时，新增一个 repository 实现即可。
- **TypeScript 7（原生编译器）**、**Vite 8**、**AI SDK 7**：均为当前最新稳定版本。

## 安全

- API Key 用 AES-256-GCM 加密存储，任何接口都只返回 `hasKey` 和末四位。
- 模板在 `sandbox="allow-same-origin"`（无 `allow-scripts`）的 iframe 中渲染，srcdoc 带严格 CSP，HTML/CSS 先经过清洗。
- 正则在 Web Worker 中执行，单条规则超时 300ms 即终止并重建 Worker。
- 服务端 CORS 只放行本机来源和 Capacitor；默认单用户，所有表预留 `owner_id`。
