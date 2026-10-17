/**
 * 存储层接口。路由与服务只依赖这些接口；SQLite 是其中一个实现，
 * 换成 Postgres + pgvector 时只需实现同一组接口（方法全部异步）。
 */
import type {
  Artifact,
  Capability,
  Chunk,
  Conversation,
  DbView,
  Element,
  Job,
  Message,
  ModelAssignment,
  Note,
  Notebook,
  PropertyDef,
  ProviderKind,
  ProviderModel,
  ReviewCard,
  Source,
} from "@quirenote/core";

export interface ListFilter {
  notebookId?: string;
  /** 次级外键：消息的 conversationId、高亮的 sourceId 等。 */
  refId?: string;
}

export interface EntityRepo<T extends { id: string }> {
  get(id: string): Promise<T | null>;
  list(filter?: ListFilter): Promise<T[]>;
  count(filter?: ListFilter): Promise<number>;
  insert(item: T): Promise<T>;
  /** 合并更新；不存在时返回 null。 */
  update(id: string, patch: Partial<T>): Promise<T | null>;
  delete(id: string): Promise<boolean>;
  deleteWhere(filter: ListFilter): Promise<number>;
}

export type NotebookRecord = Omit<Notebook, "stats">;

export interface Highlight {
  id: string;
  sourceId: string;
  notebookId: string;
  start: number;
  end: number;
  color: string;
  note: string;
  by: "user" | "ai";
  createdAt: string;
  updatedAt: string;
}

export interface SourceText {
  sourceId: string;
  notebookId: string;
  text: string;
  pageOffsets: number[];
}

/** ReviewCard + ts-fsrs 需要的额外字段。 */
export interface ReviewCardRecord extends ReviewCard {
  createdAt: string;
  updatedAt: string;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
}

export interface ReviewLog {
  id: string;
  cardId: string;
  notebookId: string;
  rating: number;
  /** 复习前的状态（0 新卡 / 1 学习 / 2 复习 / 3 重学）。 */
  state: number;
  reviewedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderRecord {
  id: string;
  kind: ProviderKind;
  name: string;
  baseUrl: string | null;
  /** AES-256-GCM 密文（见 crypto.ts），从不出现在接口响应里。 */
  keyEnc: string | null;
  keyHint: string | null;
  /** 自定义请求头（JSON 对象）的密文；值可能是凭据，同样加密。早期记录没有此字段。 */
  headersEnc?: string | null;
  headerNames?: string[];
  /** 登记的模型；早期记录没有此字段，按目录示例模型处理。 */
  models?: ProviderModel[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface JobRecord extends Job {
  /** 任务参数，重启后据此恢复。不对外返回。 */
  payload: Record<string, unknown>;
}

export interface UndoRecord {
  id: string;
  notebookId: string;
  entries: unknown[];
  createdAt: string;
  updatedAt: string;
}

export interface KeywordHit {
  chunkId: string;
  score: number;
}

export interface VectorHit {
  chunkId: string;
  distance: number;
}

export interface ChunkRepo {
  insertMany(chunks: Chunk[]): Promise<void>;
  get(ids: string[]): Promise<Chunk[]>;
  listBySource(sourceId: string): Promise<Chunk[]>;
  listByNotebook(notebookId: string): Promise<Chunk[]>;
  count(filter?: { notebookId?: string }): Promise<number>;
  deleteBySource(sourceId: string): Promise<void>;
  deleteByNotebook(notebookId: string): Promise<void>;
  /** FTS5 trigram 关键词检索（短词退化为子串匹配）。分数越大越相关。 */
  keywordSearch(notebookId: string, query: string, limit: number): Promise<KeywordHit[]>;
  upsertEmbeddings(
    model: string,
    items: { chunkId: string; notebookId: string; vector: number[] }[],
  ): Promise<void>;
  /** 向量检索，只返回由 model 生成的向量。 */
  vectorSearch(notebookId: string, model: string, vector: number[], limit: number): Promise<VectorHit[]>;
  /** model 为前缀匹配（如 "local:" 清掉某 provider 的全部向量）。 */
  clearEmbeddings(filter?: { notebookId?: string; sourceId?: string; modelPrefix?: string }): Promise<void>;
  embeddedCount(filter?: { model?: string; modelPrefix?: string; notebookId?: string }): Promise<number>;
  missingEmbeddings(model: string, filter?: { notebookId?: string; sourceId?: string }): Promise<Chunk[]>;
}

export interface ContentRepo {
  get(sourceId: string): Promise<SourceText | null>;
  put(content: SourceText): Promise<void>;
  delete(sourceId: string): Promise<void>;
  deleteByNotebook(notebookId: string): Promise<void>;
}

export interface SettingsRepo {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  all(): Promise<Record<string, unknown>>;
}

/** 按天、按模型累计的 AI 用量。 */
export interface UsageRow {
  /** 本地日期 YYYY-MM-DD。 */
  day: string;
  providerId: string;
  model: string;
  kind: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  searches: number;
}

export interface UsageRepo {
  add(row: Omit<UsageRow, "calls">): Promise<void>;
  /** since 含当天（YYYY-MM-DD）。 */
  list(since?: string): Promise<UsageRow[]>;
}

export interface AssignmentRepo {
  list(): Promise<ModelAssignment[]>;
  get(capability: Capability): Promise<ModelAssignment | null>;
  set(a: ModelAssignment): Promise<void>;
  delete(capability: Capability): Promise<void>;
}

export interface Store {
  readonly ownerId: string;
  notebooks: EntityRepo<NotebookRecord>;
  sources: EntityRepo<Source>;
  contents: ContentRepo;
  highlights: EntityRepo<Highlight>;
  chunks: ChunkRepo;
  conversations: EntityRepo<Conversation>;
  messages: EntityRepo<Message>;
  notes: EntityRepo<Note>;
  artifacts: EntityRepo<Artifact>;
  elements: EntityRepo<Element>;
  cards: EntityRepo<ReviewCardRecord>;
  reviewLogs: EntityRepo<ReviewLog>;
  views: EntityRepo<DbView>;
  properties: EntityRepo<PropertyDef>;
  providers: EntityRepo<ProviderRecord>;
  jobs: EntityRepo<JobRecord>;
  undo: EntityRepo<UndoRecord>;
  assignments: AssignmentRepo;
  settings: SettingsRepo;
  usage: UsageRepo;
  /** 在一个事务中执行（实现可以退化为顺序执行）。 */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  /** 数据库占用字节数。 */
  sizeBytes(): Promise<number>;
  /** 整库快照（用于备份）。 */
  snapshot(): Promise<Uint8Array>;
  /** 用快照替换整库。 */
  restore(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
}
