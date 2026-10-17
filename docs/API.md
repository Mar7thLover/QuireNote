# QuireNote HTTP API 契约

前后端共享的接口约定。类型名均指 `@quirenote/core` 中的 zod schema。

- 基础路径 `/api`，JSON 请求/响应；上传用 `multipart/form-data`。
- 错误统一为 `{ "error": { "code": string, "message": string } }`，配合 4xx/5xx 状态码。
- 时间均为 ISO 字符串。id 由服务端生成（`newId(prefix)`）。
- 流式接口用 SSE（`text/event-stream`），每个事件为 `event: <name>\ndata: <json>\n\n`。

## Notebook

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/notebooks` | `Notebook[]`，带 `stats` |
| POST | `/notebooks` | body `NotebookInput` → `Notebook` |
| GET / PATCH / DELETE | `/notebooks/:nb` | PATCH body 为 `NotebookInput` 的部分字段 + `pinned` |
| GET | `/notebooks/:nb/export` | 整本导出 zip（Markdown + 原始文件 + `notebook.json`） |
| POST | `/import` | multipart `file`（导出的 zip）→ `Notebook` |

## 资料 Sources

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/notebooks/:nb/sources` | `Source[]` |
| POST | `/notebooks/:nb/sources` | multipart `file`（pdf/docx/md/txt/epub/图片/音视频），或 JSON：`{kind:"url",url}` / `{kind:"text"\|"markdown",title,text}` / `{kind:"youtube",url}` / `{kind:"search",title,url,text}` → `Source`（`status: pending`，后台任务解析） |
| GET / PATCH / DELETE | `/sources/:id` | PATCH `{title?, selected?, props?}` |
| GET | `/sources/:id/content` | `SourceContent`（全文 + 页偏移 + 高亮） |
| GET | `/sources/:id/file` | 原始文件 |
| GET | `/sources/:id/chunks` | `Chunk[]` |
| POST | `/sources/:id/highlights` | `{start,end,color,note?}` → highlight |
| PATCH / DELETE | `/sources/:id/highlights/:hid` | PATCH `{color?, note?}` |
| PUT | `/sources/:id/content` | `{text}` 编辑全文 → `{source, job, highlights: {kept, removed}}` |
| POST | `/sources/:id/content/revert` | 恢复到第一次编辑前的原文，返回同上 |
| POST | `/sources/:id/auto-highlight` | AI 自动标注重点 → `Job` |

## 检索

`POST /notebooks/:nb/retrieve` body `{query, sourceIds?, k?}` →
`{ results: { chunk: Chunk, sourceTitle: string, score: number, vectorRank: number|null, keywordRank: number|null }[] }`
混合检索：向量（sqlite-vec）+ 关键词（FTS5 trigram），RRF 融合。没有 Embedding 模型时，由对话模型把提问扩展成 4–8 组检索词（同义词、上下位概念、中英对照、全称缩写），各做一次关键词检索后一并融合（权重 0.6）。

## 对话

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET / POST | `/notebooks/:nb/conversations` | POST `{title?}` |
| PATCH / DELETE | `/conversations/:id` | PATCH `{title?, activeLeafId?, model?}` |
| GET | `/conversations/:id/messages` | 全部消息（树，按 createdAt） |
| POST | `/conversations/:id/messages` | SSE，见下 |

POST body：`{ content?: string, parentId: string|null, sourceIds?: string[], regenerateOf?: string }`

- 普通发送 / 编辑消息：传 `content` + `parentId`（编辑 = 以原消息的 parent 为父节点新建分支）。
- 重新生成：传 `regenerateOf: <assistantMessageId>`，生成该消息的兄弟节点。

SSE 事件：`user`（已保存的用户消息 `Message`）→ `start` `{id}` → 多个 `delta` `{text}` →
`citations` `Citation[]`（服务端已校验编号真实存在，未知编号被剔除）→ `done`（最终 `Message`）；出错时 `error` `{message}`。

## 笔记

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET / POST | `/notebooks/:nb/notes` | POST body `NoteInput` |
| GET / PATCH / DELETE | `/notes/:id` | PATCH body 为 `NoteInput` 的部分字段 |

## Studio 生成物

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET / POST | `/notebooks/:nb/artifacts` | POST `{kind, sourceIds?, instructions?, title?}` → `Artifact`（generating，后台任务） |
| GET / PATCH / DELETE | `/artifacts/:id` | PATCH `{title?, data?}`（用户手动编辑） |
| POST | `/artifacts/:id/refine` | `{instruction, selection?}` AI 改写其中一部分 → `Artifact` |

## 复习（FSRS）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/notebooks/:nb/review/due` | 到期卡片 `ReviewCard[]` |
| GET | `/notebooks/:nb/review/stats` | `{total, due, learned, retention}` |
| POST | `/notebooks/:nb/review/cards` | `{cards:[{front,back,elementId?,artifactId?}]}` → `ReviewCard[]` |
| POST | `/review/:cardId` | `{rating: 1-4}` → `ReviewCard`（同步更新关联元素 mastery） |

## 元素

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET / POST | `/notebooks/:nb/elements` | |
| PATCH / DELETE | `/elements/:id` | |
| POST | `/notebooks/:nb/elements/extract` | `{sourceIds?, noteIds?, conversationId?}` → `Job` |
| POST | `/notebooks/:nb/elements/merge` | `{ids, intoId}` → `Element` |
| POST | `/elements/:id/enrich` | 补充定义 → `Element` |
| POST | `/notebooks/:nb/elements/cards` | `{ids}` 批量生成复习卡 → `ReviewCard[]` |

## 数据库视图

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET / POST | `/notebooks/:nb/views` | `DbView` |
| PATCH / DELETE | `/views/:id` | |
| GET / POST | `/notebooks/:nb/properties` | `PropertyDef` |
| PATCH / DELETE | `/properties/:id` | |

## 就地 AI

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/ai/transform` | `{notebookId, action, text, instruction?, targetLang?}`，action ∈ explain/rewrite/expand/translate/summarize/find_source/quiz/custom；SSE `delta`/`citations`/`done` |
| POST | `/ai/command` | `{notebookId, instruction, noteIds?, selection?}` → `AgentProposal`（不落库） |
| POST | `/ai/apply` | `{notebookId, proposal}` → `{applied: {op, id}[], undoToken}` |
| POST | `/ai/undo` | `{undoToken}` → `{ok}` |

## 联网搜索与深度研究

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/search/web` | `{query, providerId?}` → `{results:{title,url,snippet,content?}[]}` |
| POST | `/notebooks/:nb/research` | `{question, rounds?}` → `Job`；完成后生成 `search` 类资料与一份报告 |

## 模型与 Provider

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/providers/catalog` | 各 provider 类型的能力、默认 baseUrl、示例模型、说明 |
| GET / POST | `/providers` | `ProviderConfig[]` / body `ProviderInput`。**永不返回明文 Key** |
| PATCH / DELETE | `/providers/:id` | PATCH `{name?, baseUrl?, apiKey?, enabled?, models?, headers?}` |
| POST | `/providers/:id/test` | `{ok, latencyMs, error?, models?}` |
| GET | `/providers/:id/models` | 向服务查询可用模型：`ProviderModel[]`（用途为推测值），不改动已登记的列表 |
| GET / PUT | `/models/assignments` | `ModelAssignment[]` / body `ModelAssignment` |
| DELETE | `/models/assignments/:capability` | 清除分配，返回完整列表 |

没有内置模型：AI 功能需要先添加 provider 并分配模型。未分配对话模型时相关接口返回 `400 model_not_configured`；未分配 Embedding 时检索由对话模型扩展检索词（见「检索」）。

## 任务、设置、数据管理

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/jobs?notebookId=` | `Job[]` |
| GET | `/events` | SSE：`job`（`Job`）、`source`（`Source`）、`artifact`（`Artifact`）变更推送 |
| GET / PUT | `/settings/:key` | 任意 JSON（theme / templates / rules / layouts / locale） |
| GET | `/admin/stats` | `{dbBytes, filesBytes, notebooks, sources, chunks, embedded, notes, artifacts, elements, pendingJobs, embeddingModel}` |
| POST | `/admin/reindex` | `{notebookId?}` 重建 Embedding → `Job` |
| GET | `/admin/backup` | 全量备份 zip |
| POST | `/admin/restore` | multipart `file` |
| GET | `/files/:name` | 生成的音频/图片/视频 |
| GET | `/health` | `{ok, version}` |
| GET | `/usage/summary` | AI 用量与估算花费：`{today, budget, month, week, prevWeek, daily, byModel}` |
| GET | `/overview` | 首页数据：`{writing: {words, notes, editedThisWeek, wordsThisWeek}, recent: RecentNote[]}` |
| POST | `/notes/:id/opened` | 记录「最近打开」→ `{ok: true}` |

---

## 补充约定（服务端实现时补全，只做补充，不改变上文语义）

### 通用

- 状态码：创建类 POST 返回 `201`；排入后台任务的 POST（新建资料、新建生成物、`auto-highlight`、`extract`、`research`、`reindex`、`render`）返回 `202`。前端按 `res.ok` 判断即可。
- 删除类接口统一返回 `{ "ok": true }`；对象不存在时 `404 not_found`。
- 请求体校验失败：`400`，`error.code = "validation_error"`，`message` 列出字段路径；非法 JSON 为 `invalid_json`。
- 需要模型但未配置时：`400`，`error.code = "model_not_configured"`，`message` 说明去哪里配置。
- CORS：只允许 `http(s)://localhost`、`127.0.0.1`、`[::1]`（任意端口）以及 `capacitor://localhost`、`ionic://localhost`。
- SSE 中的 `data` 一律是 JSON。

### 资料

- `POST /notebooks/:nb/sources`：
  - multipart 每次一个 `file`，可带 `title` 字段；按扩展名 / MIME 判断类型（pdf / docx / md / txt / epub / png·jpg·webp·gif / mp3·wav·m4a·ogg·flac / mp4·mov·webm·mkv），其他类型 `400 unsupported_type`。
  - JSON `{kind:"url"}` 若是 YouTube 链接会自动转为 `youtube` 类型。`text` / `markdown` / `search` 的文本也会保存为原始文件（`hasFile: true`）。
  - 解析失败时资料 `status: "error"`，`error` 为可读原因（例如 "无法获取该视频的字幕…"、"图片 OCR 需要支持视觉的对话模型…"、"音视频转写需要…语音转写（STT）模型…"）。
- 补充：`POST /sources/:id/reprocess` → `Job`，重新解析（失败重试 / 换模型后重建）。
- `GET /sources/:id/file`：带 `Content-Security-Policy: sandbox`，抓取的网页 HTML 不会在 API 源下执行脚本。URL 资料保存的是抓取到的页面（`page.html` / `.pdf` / `.txt`）。
- `SourceContent.pageOffsets`：PDF 每页起始偏移，页与页之间以一个空行（`\n\n`）分隔；非分页资料为 `[0]`。`Chunk.page` 从 1 开始，非分页资料为 `null`。分块不跨页，`chunk.text === content.text.slice(chunk.start, chunk.end)`。
- `POST /sources/:id/highlights` 返回与 `SourceContent.highlights[]` 相同的结构 `{id,start,end,color,note,by:"user"}`，外加 `replaced: string[]`：与新范围重叠的用户高亮会合并成这一条（取并集、用新颜色、批注拼接），被合并的旧 id 列在这里；`auto-highlight` 会替换上一次的 AI 标注（`by:"ai"`），保留用户高亮。
- `PUT /sources/:id/content`：编辑的是解析出的全文，原始文件不变。资料必须是 `ready`（否则 `409 busy`），内容不能为空；与现有内容相同时 `job: null`。高亮按文本差异移到新位置，原文被删改的高亮删除（返回 `removed` 数量）；分页偏移随之移动。第一次编辑前的原文保存在 `files/source-edits/<id>.json`（随备份与 Notebook 导出）；`Source.props.edited = true`。之后排入 `ingest` 任务（`reuseContent`）重建分块、向量和摘要。
- `POST /sources/:id/content/revert`：没有编辑过时 `400`；恢复后清除 `props.edited`，高亮同样按差异移动。`POST /sources/:id/reprocess`（重新解析原始文件）也会移动高亮，并丢弃编辑。

### 检索

- 响应可能带 `warning: string`（例如向量检索失败、已退回纯关键词）。
- 关键词检索：FTS5 trigram；少于 3 个字符的词（如"图灵"、"AI"）退化为子串匹配。`vectorRank` / `keywordRank` 从 1 开始，按资料范围过滤后的名次计算。
- 未传 `sourceIds` 时检索笔记本内全部 `ready` 资料；对话默认只用已勾选（`selected`）的资料。

### 对话

- `GET /conversations/:id` 补充：返回单个 `Conversation`。新建时 `title` 默认为 `"新对话"`，第一次提问后自动改为问题前 40 字。
- `PATCH /conversations/:id` 的 `activeLeafId` 必须是该对话中的消息，否则 `400`。
- `Conversation.model`：`{providerId, model} | null`，该对话使用的对话模型；`null` 跟随 `chat` 分配。创建（`POST /notebooks/:nb/conversations` 的 `model`）和 `PATCH` 时校验 provider 存在且支持对话，否则 `400`。provider 之后被删除或停用时，发送消息退回 `chat` 分配。
- `POST /conversations/:id/messages`：参数错误（空内容、parentId 不属于该对话、`regenerateOf` 不是助手消息）在开始 SSE **之前**以普通 JSON 错误返回。
  - 重新生成时不发 `user` 事件，直接从 `start` 开始；其余事件顺序不变。
  - `delta` 是模型原始输出；`done` 中的 `content` 是校验后的最终文本（不存在的编号已从文本中删除，例如 `[1, 7]` → `[1]`、`[7]` → 删除）。前端应以 `done` 为准。
  - `Citation.quote/start/end` 指向资料全文中与该结论最匹配的**一句话**（不是整个分块），可直接用于跳转高亮；`page` 为该分块所在页。
  - 出错时：`error` 事件 `{message, messageId?}`，对应助手消息 `status: "error"`、保留已生成的部分内容。
  - `Message.model` 形如 `"<providerId>:<model>"`，例如 `"prov_xxx:claude-sonnet-5-5"`（模型名本身可能含冒号，按第一个冒号拆分）。

### Studio 生成物

- `POST /notebooks/:nb/artifacts`：未传 `sourceIds` 时使用已勾选且就绪的资料；没有可用资料时 `400`（`image` 除外）。未传 `title` 时生成完成后自动命名为 `"<类型名>：<主题>"`；`instructions` 保存在 `props.instructions`。
- 数据形态：`report / briefing / study_guide / faq / infographic` → `{kind:"markdown"}`；其余与 `kind` 同名。`PATCH` 的 `data.kind` 必须与之匹配，否则 `400`。
- 音频概览：先生成双人脚本（`script`），再逐句 TTS（A/B 两个音色）并拼接（mp3 直接拼帧；wav / PCM 合并并在句间插 0.35s 静音）。**未配置 TTS 时**：`status: "ready"`、`audioUrl: null`，`error` 字段给出提示（脚本可编辑，配置 TTS 后调用 `render` 合成）。音色可用设置 `PUT /settings/ttsVoices` `{A?, B?}` 覆盖。
- 视频概览：生成幻灯片（`notes` 为旁白）；检测到 ffmpeg（PATH 或 `FFMPEG_PATH`）才合成 mp4（每页纯色背景 + 文字，有 TTS 时配旁白）。没有 ffmpeg 时 `status: "error"`，`error` 说明原因，`data.slides` 仍保留。
- 配图：根据资料生成英文提示词，再调用 `image` 能力的模型；未配置时 `status: "error"`。
- 媒体中、合成完成前 `status` 保持 `generating`（`data` 已写入，可提前展示脚本 / 幻灯片）。
- `POST /artifacts/:id/refine`：同步返回修改后的 `Artifact`。`selection` 可以是 Markdown 片段、思维导图节点标签或幻灯片标题；音频脚本修改后 `audioUrl` 置空，需要 `render` 重新合成。
- 补充：`POST /artifacts/:id/render` → `Job`，按当前 `data` 重新合成媒体（仅 audio / video / image）。

### 复习（FSRS）

- 卡片 `state`：0 新卡 / 1 学习中 / 2 复习 / 3 重学（ts-fsrs）。`due` 到期即出现在 `/review/due`（新卡立即到期）。
- `stats.learned` = 处于复习态（state 2）的卡片数；`retention` = 复习态卡片评分中非 Again（rating > 1）的比例，没有复习态记录时用全部记录，没有记录时为 0。
- 元素 `mastery` = 其所有卡片掌握度的平均值；单卡掌握度 = `stability / (stability + 7)`，新卡为 0，重学态减半。
- 补充：`GET /notebooks/:nb/review/cards` → 全部 `ReviewCard[]`；`DELETE /review/:cardId` 删除卡片。

### 元素

- 抽取任务：`sourceIds / noteIds / conversationId` 都不传时，从已勾选资料中抽取。与已有元素同名（含别名，忽略大小写与引号）时合并出处而不新建。每个 `ref.quote` 为原文摘录，`sourceId/chunkId` 或 `noteId` 或 `messageId` 指明出处。
- `merge`：被合并元素的名字与别名进入 `aliases`，出处、关系合并；指向它们的关系与复习卡改指向 `intoId`；被合并元素删除。
- `enrich`：同步返回更新后的 `Element`（`definition`、`aliases`，以及与已有元素的 `relations`，label 为 `"相关"`）。
- `cards`：每个元素一张卡（正面 `"名称（类型）"`，背面为定义或第一条出处）；已有卡片的元素跳过，因此可能返回空数组。
- `DELETE /elements/:id` 会同时移除其他元素指向它的关系，并解除复习卡的关联。

### 就地 AI

- `/ai/transform` 补充参数 `sourceIds?: string[]`（限定参考资料）。`explain / expand / find_source / quiz / custom` 会检索资料并可引用 `[n]`；`rewrite / translate / summarize` 只处理文本本身。
  - `done` 事件：`{ text, model }`，`text` 为剔除无效编号后的最终文本；`citations` 事件与对话相同。
- `/ai/command`：返回的 `AgentProposal.ops` 只引用请求中 `noteIds` 里的笔记；`add_mindmap_node` 的 `artifactId / parentId` 来自本笔记本已有的思维导图。
- `/ai/apply`：先整体校验（引用的笔记 / 节点不存在 → `400 bad_proposal`，不做部分应用）。各操作返回的 `id`：`create_note` / `update_note` / `delete_note` → 笔记 id；`create_table` → 新建的 `table` 生成物 id；`add_mindmap_node` → 新节点 id；`create_element` → 元素 id。`update_note` 会把 `doc` 置为 `null`（由前端从 markdown 重建）。
- `/ai/undo`：每个 `undoToken` 只能使用一次；之后 `404`。

### 联网搜索与研究

- `/search/web` 未传 `providerId` 时使用 `search` 能力的分配；都没有时 `400 model_not_configured`。
- `/notebooks/:nb/research`：未配置搜索时直接 `400`（不排队）。任务每轮先由对话模型提出查询（第 1 轮即原问题），收集结果；只有摘要的结果会再抓取正文；每条结果成为一个 `search` 资料（`url` 为原链接）；最后创建一个 `report` 生成物（标题 `"研究报告：<问题>"`，任务完成消息中包含其 id，生成过程见 `artifact` 事件）。`rounds` 取值 1–5，默认 2。

### 模型与 Provider

- `GET /providers/catalog` 元素：`{kind, label, capabilities, defaultBaseUrl, baseUrlRequired, requiresKey, models: {<capability>: string[]}（第一个为默认）, voices?: {A, B, options}, notes, docsUrl}`。
- `ProviderKind` 新增 `anthropic-compatible`：兼容 Anthropic Messages API 的服务（中转、DeepSeek / Kimi / GLM 的 Anthropic 端点），必须有 `baseUrl`，Key 可选（以 `x-api-key` 发送）。`openai-compatible` 现在也支持 `tts` / `stt`（`/audio/speech`、`/audio/transcriptions`）。
- `ProviderConfig` 新增 `models: ProviderModel[]`（`{id, label, capabilities}`，登记在该 provider 下的模型）与 `headerNames: string[]`（自定义请求头只回传名称）。新建时省略 `models` 则预置目录示例模型；早期记录没有该字段时同样按目录示例返回。保存时同 ID 合并用途、去掉该类型不支持的用途；某模型的用途全部不受支持时 `400`。
- `PATCH /providers/:id`：`{name?, baseUrl?, apiKey?, enabled?, models?, headers?}`；`apiKey: ""` 或 `null` 表示清除 Key；`models` 整体替换；`headers` 按名称合并（不区分大小写），值为 `null` 删除该项，`headers: null` 清除全部。请求头与 Key 一样加密保存，值不回传。`openai-compatible` / `anthropic-compatible` 必须有 `baseUrl`。
- `POST /providers/:id/test` 永远返回 200：`{ok, latencyMs, error?, models?}`；错误信息不包含 Key。fal 没有免费探测接口，只检查是否填写了 Key；Edge TTS 暂不支持（返回 `ok:false` 及说明）。
- `GET /models/assignments` 只返回已分配的能力。`PUT` 校验 provider 存在且支持该能力，返回更新后的完整列表。更换 Embedding 模型会自动排入全库 `reindex` 任务（期间检索退回关键词）。
- `DELETE /models/assignments/:capability` 清除分配（该能力回到未配置），返回完整列表。删除 provider 时，引用它的分配一并清除。
- `POST /providers` 新建后，若该 provider 支持 `chat` / `search` / `image` 而这些能力尚未分配，自动用它的默认模型补上（Embedding / TTS / STT 不自动分配：前者会触发重建索引，后两者会产生合成费用）。
- Anthropic 的能力为 `chat`、`search`（Claude 服务端 web search 工具；Haiku 用 `web_search_20250305`，其他用 `web_search_20260209`；搜索结果正文加密，摘要由 Claude 撰写，URL 只保留工具真实返回的页面）、`image`（Claude 绘制的 SVG 插图，保存前去掉脚本、事件属性与外链；`/files/*.svg` 另带 `content-security-policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`）。`anthropic-compatible` 支持 `chat`、`image`。启动时为现有 provider 补上目录新增的能力（每个目录版本只做一次）。
- Anthropic 对话请求带两个缓存断点：系统提示词（含资料片段）与最后一条消息。
- 早期版本的内置 `local` provider 已移除：启动时删除指向它的分配和它生成的向量（`local:*`）。
- 启动时可从环境变量引导 provider（Docker 部署）：`ANTHROPIC_API_KEY`、`OPENAI_API_KEY`、`GOOGLE_GENERATIVE_AI_API_KEY`、`TAVILY_API_KEY`、`BRAVE_API_KEY`，以及对应的 `*_FILE`（文件路径，读取内容并 trim）；OpenAI 兼容接口用 `OPENAI_COMPATIBLE_BASE_URL`（必填）、`OPENAI_COMPATIBLE_API_KEY[_FILE]`、`OPENAI_COMPATIBLE_CHAT_MODEL`、`OPENAI_COMPATIBLE_EMBEDDING_MODEL`。该类型（兼容接口按 baseUrl）尚无 provider 时才创建。未分配的能力补上分配：chat 依次用 Anthropic `claude-sonnet-5-5` / OpenAI / Gemini 的默认模型 / 兼容接口指定的对话模型；embedding 依次用 OpenAI / Gemini / 兼容接口指定的 Embedding 模型；search 用 Tavily / Brave，都没有时用 Anthropic（Claude Haiku）；image 用 Anthropic（SVG 插图）。日志只输出 keyHint。

### 任务与事件

- `Job.type`：`ingest`、`reindex`、`artifact`、`artifact_media`、`extract_elements`、`auto_highlight`、`research`。`refId` 指向相关对象（资料 / 生成物 id）。服务重启后未完成的任务会重新排队。
- `GET /jobs` 按创建时间倒序，最多 200 条。补充：`GET /jobs/:id`。
- `GET /events`：连接后先发 `ready` `{ok, version}`；之后推送 `job` / `source` / `artifact`；空闲时每 15 秒发送 SSE 注释行（`: ping`）保活。

### 设置与数据管理

- `GET /settings/:key` 未设置时返回 `null`；`key` 只允许 `[a-zA-Z0-9_.-]{1,64}`。`PUT` 返回保存的值。
- `GET /admin/stats` 中 `embedded` 为当前 Embedding 模型已生成向量的分块数，`embeddingModel` 形如 `"prov_xxx:text-embedding-3-small"`，未配置时为 `null`（`embedded` 为 0）。
- `POST /admin/reindex` 清除范围内的旧向量后用当前模型重建。
- `GET /admin/backup`：zip 内含 `backup.json`、`quirenote.db`（SQLite 快照，含向量与全文索引）、`files/**`。**不含** `secret.key`：在另一台机器恢复时需要相同的 `QUIRENOTE_SECRET` / `secret.key`，否则需重新填写 provider Key。
- `POST /admin/restore`：有后台任务运行时 `409 busy`；成功返回 `{ok: true, files: number}`。

### 用量与首页

- 每次模型调用（对话、生成、检索词扩展、联网搜索、Embedding、插图）按「本地日期 × provider × 模型 × 类型」累计：调用次数、输入 / 输出 / 缓存读 / 缓存写 Token、联网搜索次数。
- `GET /usage/summary`：`month` / `week`（含今天的最近 7 天）/ `prevWeek` 为 `UsageTotals`（`{calls, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, searches, cost, unpricedTokens}`）；`cost` 按 Anthropic 官方标价估算（美元，含缓存折扣与每千次 10 美元的搜索费），没有价目的模型只计入 `unpricedTokens`。`daily` 为最近 14 天 `{day, tokens, cost}`（旧 → 新），`byModel` 为本月按模型汇总（`cost` 可能为 `null`）。`budget` 来自设置 `aiBudget.monthlyUsd`，未设置为 `null`。
- `GET /overview`：字数按中日韩文字逐字、其他文字按词计（只统计 `kind: "note"`）；`recent` 最多 8 条，先按打开时间（`openedAt`），不足时用最近修改的笔记补位（`openedAt: null`）。每条：`{id, notebookId, notebookTitle, notebookColor, notebookIcon, title, excerpt, words, tags, updatedAt, openedAt}`。
- 对话：所选资料的分块总字数不超过 6 万（配置了 Embedding 时 2 万）时，整份按原文顺序交给模型，不做检索；超过时检索 + 按资料均匀补足（12,000 字以内）。

### Notebook 导出 / 导入

- `GET /notebooks/:nb/export` → `<标题>.quirenote.zip`：`notebook.json`（`format: "quirenote-notebook", version: 1`，含资料全文、分块、笔记、生成物、元素、复习卡与记录、视图、属性、对话与消息）、`markdown/notes|sources|artifacts/*.md`、`files/sources/<id>/*`（原始文件）、`files/media/*`（生成的媒体）、`README.md`。
- `POST /import`：所有 id 重新生成（引用随之更新），返回新的 `Notebook`（带 `stats`）；向量不随包导出，导入后自动排入该笔记本的 `reindex` 任务。

### 文件

- `GET /files/:name` 支持 `Range`（`206 Partial Content`），音视频可拖动进度。
