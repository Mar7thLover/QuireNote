/**
 * SQLite 实现：better-sqlite3 + sqlite-vec（向量）+ FTS5 trigram（关键词）。
 * 大部分实体以「索引列 + JSON 文档」存储，便于演进；分块、向量与全文索引使用专门的表。
 */
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Capability, Chunk, ModelAssignment } from "@quirenote/core";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import type {
  AssignmentRepo,
  ChunkRepo,
  ContentRepo,
  EntityRepo,
  KeywordHit,
  ListFilter,
  SettingsRepo,
  SourceText,
  Store,
  UsageRepo,
  UsageRow,
  VectorHit,
} from "./types";

type DB = Database.Database;

const DOC_TABLES = [
  "notebooks",
  "sources",
  "highlights",
  "conversations",
  "messages",
  "notes",
  "artifacts",
  "elements",
  "review_cards",
  "review_logs",
  "views",
  "properties",
  "providers",
  "jobs",
  "undo_log",
] as const;

/** 「索引列 + JSON 文档」形式的表。 */
function createDocTable(db: DB, t: string): void {
  db.exec(`CREATE TABLE IF NOT EXISTS ${t} (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL DEFAULT 'local',
        notebook_id TEXT,
        ref_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ${t}_nb ON ${t}(owner_id, notebook_id);
      CREATE INDEX IF NOT EXISTS ${t}_ref ON ${t}(owner_id, ref_id);`);
}

const MIGRATIONS: ((db: DB) => void)[] = [
  (db) => {
    for (const t of DOC_TABLES) {
      db.exec(`CREATE TABLE IF NOT EXISTS ${t} (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL DEFAULT 'local',
        notebook_id TEXT,
        ref_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ${t}_nb ON ${t}(owner_id, notebook_id);
      CREATE INDEX IF NOT EXISTS ${t}_ref ON ${t}(owner_id, ref_id);`);
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS source_contents (
        source_id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL DEFAULT 'local',
        notebook_id TEXT NOT NULL,
        text TEXT NOT NULL,
        page_offsets TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS source_contents_nb ON source_contents(owner_id, notebook_id);

      CREATE TABLE IF NOT EXISTS chunks (
        rid INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        owner_id TEXT NOT NULL DEFAULT 'local',
        notebook_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        idx INTEGER NOT NULL,
        text TEXT NOT NULL,
        start INTEGER NOT NULL,
        "end" INTEGER NOT NULL,
        page INTEGER,
        heading TEXT
      );
      CREATE INDEX IF NOT EXISTS chunks_src ON chunks(owner_id, source_id, idx);
      CREATE INDEX IF NOT EXISTS chunks_nb ON chunks(owner_id, notebook_id);

      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        text, chunk_id UNINDEXED, notebook_id UNINDEXED, tokenize = 'trigram'
      );

      CREATE TABLE IF NOT EXISTS chunk_embeddings (
        chunk_id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL DEFAULT 'local',
        notebook_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        model TEXT NOT NULL,
        dim INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS chunk_embeddings_nb ON chunk_embeddings(owner_id, notebook_id, model);
      CREATE INDEX IF NOT EXISTS chunk_embeddings_src ON chunk_embeddings(source_id);

      CREATE TABLE IF NOT EXISTS settings (
        owner_id TEXT NOT NULL DEFAULT 'local',
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (owner_id, key)
      );

      CREATE TABLE IF NOT EXISTS model_assignments (
        owner_id TEXT NOT NULL DEFAULT 'local',
        capability TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        model TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (owner_id, capability)
      );
    `);
  },
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS usage_daily (
        owner_id TEXT NOT NULL DEFAULT 'local',
        day TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        model TEXT NOT NULL,
        kind TEXT NOT NULL,
        calls INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        searches INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (owner_id, day, provider_id, model, kind)
      );
    `);
  },
  // 笔记里的资源（图片、视频…）、知识书条目、链接预览缓存
  (db) => {
    for (const t of ["assets", "lore_entries", "link_previews"]) createDocTable(db, t);
  },
  // 分享链接：id 即链接里的随机令牌，ref_id 为笔记或 Notebook 的 id
  (db) => createDocTable(db, "shares"),
];

function now(): string {
  return new Date().toISOString();
}

function migrate(db: DB): void {
  const version = db.pragma("user_version", { simple: true }) as number;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      MIGRATIONS[v]!(db);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

function openDb(path: string): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  sqliteVec.load(db);
  migrate(db);
  return db;
}

interface Keys {
  notebookId?: string | null;
  refId?: string | null;
}

class SqliteEntityRepo<T extends { id: string }> implements EntityRepo<T> {
  constructor(
    private readonly s: SqliteStore,
    private readonly table: string,
    private readonly keys: (item: T) => Keys,
  ) {}

  private where(filter: ListFilter = {}): { sql: string; params: unknown[] } {
    const parts = ["owner_id = ?"];
    const params: unknown[] = [this.s.ownerId];
    if (filter.notebookId !== undefined) {
      parts.push("notebook_id = ?");
      params.push(filter.notebookId);
    }
    if (filter.refId !== undefined) {
      parts.push("ref_id = ?");
      params.push(filter.refId);
    }
    return { sql: parts.join(" AND "), params };
  }

  async get(id: string): Promise<T | null> {
    const row = this.s.db
      .prepare(`SELECT data FROM ${this.table} WHERE id = ? AND owner_id = ?`)
      .get(id, this.s.ownerId) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as T) : null;
  }

  async list(filter?: ListFilter): Promise<T[]> {
    const w = this.where(filter);
    const rows = this.s.db
      .prepare(`SELECT data FROM ${this.table} WHERE ${w.sql} ORDER BY created_at, rowid`)
      .all(...w.params) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as T);
  }

  async count(filter?: ListFilter): Promise<number> {
    const w = this.where(filter);
    const row = this.s.db
      .prepare(`SELECT COUNT(*) AS c FROM ${this.table} WHERE ${w.sql}`)
      .get(...w.params) as {
      c: number;
    };
    return row.c;
  }

  async insert(item: T): Promise<T> {
    const k = this.keys(item);
    const rec = item as unknown as { createdAt?: string; updatedAt?: string };
    const created = rec.createdAt ?? now();
    this.s.db
      .prepare(
        `INSERT INTO ${this.table} (id, owner_id, notebook_id, ref_id, created_at, updated_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        item.id,
        this.s.ownerId,
        k.notebookId ?? null,
        k.refId ?? null,
        created,
        rec.updatedAt ?? created,
        JSON.stringify(item),
      );
    return item;
  }

  async update(id: string, patch: Partial<T>): Promise<T | null> {
    const current = await this.get(id);
    if (!current) return null;
    const next = { ...current, ...patch, id } as T;
    const rec = next as unknown as { updatedAt?: string };
    const ts = now();
    if ("updatedAt" in (current as object)) rec.updatedAt = ts;
    const k = this.keys(next);
    this.s.db
      .prepare(
        `UPDATE ${this.table} SET notebook_id = ?, ref_id = ?, updated_at = ?, data = ? WHERE id = ? AND owner_id = ?`,
      )
      .run(k.notebookId ?? null, k.refId ?? null, ts, JSON.stringify(next), id, this.s.ownerId);
    return next;
  }

  async delete(id: string): Promise<boolean> {
    return (
      this.s.db.prepare(`DELETE FROM ${this.table} WHERE id = ? AND owner_id = ?`).run(id, this.s.ownerId)
        .changes > 0
    );
  }

  async deleteWhere(filter: ListFilter): Promise<number> {
    const w = this.where(filter);
    return this.s.db.prepare(`DELETE FROM ${this.table} WHERE ${w.sql}`).run(...w.params).changes;
  }
}

/** 把查询切成 FTS5 trigram 可用的短语（≥3 字符）与需要子串匹配的短词。 */
export function buildKeywordQuery(query: string): { fts: string | null; short: string[] } {
  const phrases = new Set<string>();
  const short = new Set<string>();
  const norm = query.toLowerCase().normalize("NFKC");
  for (const m of norm.matchAll(/[㐀-鿿豈-﫿]+/g)) {
    const run = m[0];
    if (run.length < 3) short.add(run);
    else for (let i = 0; i + 3 <= run.length; i++) phrases.add(run.slice(i, i + 3));
  }
  for (const m of norm.matchAll(/[a-z0-9][a-z0-9._\-+#]*/g)) {
    const w = m[0].replace(/[._-]+$/, "");
    if (w.length >= 3) phrases.add(w);
    else if (w.length === 2) short.add(w);
  }
  const fts = phrases.size ? [...phrases].map((p) => `"${p.replace(/"/g, '""')}"`).join(" OR ") : null;
  return { fts, short: [...short] };
}

/** WAL 模式的库镜像需要把文件头的读写版本（第 18、19 字节）改回 1 才能在内存中打开。 */
function inMemoryImage(bytes: Uint8Array): Buffer {
  const buf = Buffer.from(bytes);
  if (buf.length > 100 && buf.subarray(0, 16).toString("latin1") === "SQLite format 3\u0000") {
    buf[18] = 1;
    buf[19] = 1;
  }
  return buf;
}

function toBlob(vector: number[]): Buffer {
  return Buffer.from(new Float32Array(vector).buffer);
}

class SqliteChunkRepo implements ChunkRepo {
  constructor(private readonly s: SqliteStore) {}
  private get db() {
    return this.s.db;
  }

  private rowToChunk(r: Record<string, unknown>): Chunk {
    return {
      id: r.id as string,
      sourceId: r.source_id as string,
      notebookId: r.notebook_id as string,
      index: r.idx as number,
      text: r.text as string,
      start: r.start as number,
      end: r.end as number,
      page: (r.page as number | null) ?? null,
      heading: (r.heading as string | null) ?? null,
    };
  }

  async insertMany(chunks: Chunk[]): Promise<void> {
    const ins = this.db.prepare(
      `INSERT INTO chunks (id, owner_id, notebook_id, source_id, idx, text, start, "end", page, heading) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const fts = this.db.prepare(`INSERT INTO chunks_fts (text, chunk_id, notebook_id) VALUES (?, ?, ?)`);
    this.db.transaction(() => {
      for (const c of chunks) {
        ins.run(
          c.id,
          this.s.ownerId,
          c.notebookId,
          c.sourceId,
          c.index,
          c.text,
          c.start,
          c.end,
          c.page,
          c.heading,
        );
        fts.run(c.text, c.id, c.notebookId);
      }
    })();
  }

  async get(ids: string[]): Promise<Chunk[]> {
    if (!ids.length) return [];
    const out: Chunk[] = [];
    for (let i = 0; i < ids.length; i += 500) {
      const part = ids.slice(i, i + 500);
      const rows = this.db
        .prepare(`SELECT * FROM chunks WHERE owner_id = ? AND id IN (${part.map(() => "?").join(",")})`)
        .all(this.s.ownerId, ...part) as Record<string, unknown>[];
      out.push(...rows.map((r) => this.rowToChunk(r)));
    }
    const order = new Map(ids.map((id, i) => [id, i]));
    return out.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  }

  async listBySource(sourceId: string): Promise<Chunk[]> {
    const rows = this.db
      .prepare(`SELECT * FROM chunks WHERE owner_id = ? AND source_id = ? ORDER BY idx`)
      .all(this.s.ownerId, sourceId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToChunk(r));
  }

  async listByNotebook(notebookId: string): Promise<Chunk[]> {
    const rows = this.db
      .prepare(`SELECT * FROM chunks WHERE owner_id = ? AND notebook_id = ? ORDER BY source_id, idx`)
      .all(this.s.ownerId, notebookId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToChunk(r));
  }

  async count(filter: { notebookId?: string } = {}): Promise<number> {
    const row = filter.notebookId
      ? this.db
          .prepare(`SELECT COUNT(*) c FROM chunks WHERE owner_id = ? AND notebook_id = ?`)
          .get(this.s.ownerId, filter.notebookId)
      : this.db.prepare(`SELECT COUNT(*) c FROM chunks WHERE owner_id = ?`).get(this.s.ownerId);
    return (row as { c: number }).c;
  }

  private deleteChunkIds(ids: string[]): void {
    if (!ids.length) return;
    this.deleteVectors(ids);
    for (let i = 0; i < ids.length; i += 500) {
      const part = ids.slice(i, i + 500);
      const q = part.map(() => "?").join(",");
      this.db.prepare(`DELETE FROM chunks_fts WHERE chunk_id IN (${q})`).run(...part);
      this.db.prepare(`DELETE FROM chunks WHERE id IN (${q})`).run(...part);
    }
  }

  async deleteBySource(sourceId: string): Promise<void> {
    const ids = (
      this.db
        .prepare(`SELECT id FROM chunks WHERE owner_id = ? AND source_id = ?`)
        .all(this.s.ownerId, sourceId) as {
        id: string;
      }[]
    ).map((r) => r.id);
    this.db.transaction(() => this.deleteChunkIds(ids))();
  }

  async deleteByNotebook(notebookId: string): Promise<void> {
    const ids = (
      this.db
        .prepare(`SELECT id FROM chunks WHERE owner_id = ? AND notebook_id = ?`)
        .all(this.s.ownerId, notebookId) as {
        id: string;
      }[]
    ).map((r) => r.id);
    this.db.transaction(() => this.deleteChunkIds(ids))();
  }

  async keywordSearch(notebookId: string, query: string, limit: number): Promise<KeywordHit[]> {
    const { fts, short } = buildKeywordQuery(query);
    const scores = new Map<string, number>();
    if (fts) {
      try {
        const rows = this.db
          .prepare(
            `SELECT chunk_id, bm25(chunks_fts) AS s FROM chunks_fts WHERE chunks_fts MATCH ? AND notebook_id = ? ORDER BY s LIMIT ?`,
          )
          .all(fts, notebookId, limit * 2) as { chunk_id: string; s: number }[];
        // bm25 越小越相关；取负数，使分数越大越相关。
        for (const r of rows) scores.set(r.chunk_id, -r.s);
      } catch {
        /* 非法查询：忽略 FTS 部分 */
      }
    }
    if (short.length) {
      const cond = short.map(() => "instr(lower(text), ?) > 0").join(" OR ");
      const rows = this.db
        .prepare(`SELECT id, text FROM chunks WHERE owner_id = ? AND notebook_id = ? AND (${cond}) LIMIT ?`)
        .all(this.s.ownerId, notebookId, ...short, limit * 4) as { id: string; text: string }[];
      for (const r of rows) {
        const lower = r.text.toLowerCase();
        let hits = 0;
        for (const w of short) {
          let idx = lower.indexOf(w);
          while (idx >= 0 && hits < 50) {
            hits++;
            idx = lower.indexOf(w, idx + w.length);
          }
        }
        // 子串命中给一个与 bm25 同量级的加分。
        scores.set(r.id, (scores.get(r.id) ?? 0) + Math.log1p(hits));
      }
    }
    return [...scores.entries()]
      .map(([chunkId, score]) => ({ chunkId, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private vecTable(dim: number): string {
    const name = `vec_chunks_${dim}`;
    if (!this.s.vecTables.has(dim)) {
      this.db.exec(
        `CREATE VIRTUAL TABLE IF NOT EXISTS ${name} USING vec0(chunk_id TEXT PRIMARY KEY, notebook_id TEXT PARTITION KEY, embedding float[${dim}] distance_metric=cosine)`,
      );
      this.s.vecTables.add(dim);
    }
    return name;
  }

  private deleteVectors(chunkIds: string[]): void {
    if (!chunkIds.length) return;
    for (let i = 0; i < chunkIds.length; i += 500) {
      const part = chunkIds.slice(i, i + 500);
      const q = part.map(() => "?").join(",");
      const dims = this.db
        .prepare(`SELECT DISTINCT dim FROM chunk_embeddings WHERE chunk_id IN (${q})`)
        .all(...part) as { dim: number }[];
      for (const { dim } of dims) {
        const t = this.vecTable(dim);
        const del = this.db.prepare(`DELETE FROM ${t} WHERE chunk_id = ?`);
        for (const id of part) del.run(id);
      }
      this.db.prepare(`DELETE FROM chunk_embeddings WHERE chunk_id IN (${q})`).run(...part);
    }
  }

  async upsertEmbeddings(
    model: string,
    items: { chunkId: string; notebookId: string; vector: number[] }[],
  ): Promise<void> {
    if (!items.length) return;
    this.db.transaction(() => {
      this.deleteVectors(items.map((i) => i.chunkId));
      const srcStmt = this.db.prepare(`SELECT source_id FROM chunks WHERE id = ?`);
      const meta = this.db.prepare(
        `INSERT INTO chunk_embeddings (chunk_id, owner_id, notebook_id, source_id, model, dim) VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const it of items) {
        const dim = it.vector.length;
        const t = this.vecTable(dim);
        this.db
          .prepare(`INSERT INTO ${t} (chunk_id, notebook_id, embedding) VALUES (?, ?, ?)`)
          .run(it.chunkId, it.notebookId, toBlob(it.vector));
        const src = srcStmt.get(it.chunkId) as { source_id: string } | undefined;
        meta.run(it.chunkId, this.s.ownerId, it.notebookId, src?.source_id ?? "", model, dim);
      }
    })();
  }

  async vectorSearch(
    notebookId: string,
    model: string,
    vector: number[],
    limit: number,
  ): Promise<VectorHit[]> {
    const dim = vector.length;
    const has = this.db
      .prepare(
        `SELECT 1 FROM chunk_embeddings WHERE owner_id = ? AND notebook_id = ? AND model = ? AND dim = ? LIMIT 1`,
      )
      .get(this.s.ownerId, notebookId, model, dim);
    if (!has) return [];
    const t = this.vecTable(dim);
    const rows = this.db
      .prepare(
        `SELECT chunk_id, distance FROM ${t} WHERE embedding MATCH ? AND k = ? AND notebook_id = ? ORDER BY distance`,
      )
      .all(toBlob(vector), Math.min(4096, limit * 3), notebookId) as { chunk_id: string; distance: number }[];
    if (!rows.length) return [];
    const ok = new Set(
      (
        this.db
          .prepare(
            `SELECT chunk_id FROM chunk_embeddings WHERE model = ? AND owner_id = ? AND chunk_id IN (${rows.map(() => "?").join(",")})`,
          )
          .all(model, this.s.ownerId, ...rows.map((r) => r.chunk_id)) as { chunk_id: string }[]
      ).map((r) => r.chunk_id),
    );
    return rows
      .filter((r) => ok.has(r.chunk_id))
      .slice(0, limit)
      .map((r) => ({ chunkId: r.chunk_id, distance: r.distance }));
  }

  async clearEmbeddings(
    filter: { notebookId?: string; sourceId?: string; modelPrefix?: string } = {},
  ): Promise<void> {
    let sql = `SELECT chunk_id FROM chunk_embeddings WHERE owner_id = ?`;
    const params: unknown[] = [this.s.ownerId];
    if (filter.modelPrefix) {
      sql += " AND substr(model, 1, ?) = ?";
      params.push(filter.modelPrefix.length, filter.modelPrefix);
    }
    if (filter.notebookId) {
      sql += " AND notebook_id = ?";
      params.push(filter.notebookId);
    }
    if (filter.sourceId) {
      sql += " AND source_id = ?";
      params.push(filter.sourceId);
    }
    const ids = (this.db.prepare(sql).all(...params) as { chunk_id: string }[]).map((r) => r.chunk_id);
    this.db.transaction(() => this.deleteVectors(ids))();
  }

  async embeddedCount(
    filter: { model?: string; modelPrefix?: string; notebookId?: string } = {},
  ): Promise<number> {
    let sql = `SELECT COUNT(*) c FROM chunk_embeddings WHERE owner_id = ?`;
    const params: unknown[] = [this.s.ownerId];
    if (filter.model) {
      sql += " AND model = ?";
      params.push(filter.model);
    }
    if (filter.modelPrefix) {
      sql += " AND substr(model, 1, ?) = ?";
      params.push(filter.modelPrefix.length, filter.modelPrefix);
    }
    if (filter.notebookId) {
      sql += " AND notebook_id = ?";
      params.push(filter.notebookId);
    }
    return (this.db.prepare(sql).get(...params) as { c: number }).c;
  }

  async missingEmbeddings(
    model: string,
    filter: { notebookId?: string; sourceId?: string } = {},
  ): Promise<Chunk[]> {
    let sql = `SELECT c.* FROM chunks c LEFT JOIN chunk_embeddings e ON e.chunk_id = c.id AND e.model = ?
      WHERE c.owner_id = ? AND e.chunk_id IS NULL`;
    const params: unknown[] = [model, this.s.ownerId];
    if (filter.notebookId) {
      sql += " AND c.notebook_id = ?";
      params.push(filter.notebookId);
    }
    if (filter.sourceId) {
      sql += " AND c.source_id = ?";
      params.push(filter.sourceId);
    }
    sql += " ORDER BY c.source_id, c.idx";
    return (this.db.prepare(sql).all(...params) as Record<string, unknown>[]).map((r) => this.rowToChunk(r));
  }
}

class SqliteContentRepo implements ContentRepo {
  constructor(private readonly s: SqliteStore) {}
  async get(sourceId: string): Promise<SourceText | null> {
    const r = this.s.db
      .prepare(`SELECT * FROM source_contents WHERE source_id = ? AND owner_id = ?`)
      .get(sourceId, this.s.ownerId) as Record<string, string> | undefined;
    if (!r) return null;
    return {
      sourceId: r.source_id!,
      notebookId: r.notebook_id!,
      text: r.text!,
      pageOffsets: JSON.parse(r.page_offsets!) as number[],
    };
  }
  async put(c: SourceText): Promise<void> {
    this.s.db
      .prepare(
        `INSERT INTO source_contents (source_id, owner_id, notebook_id, text, page_offsets, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(source_id) DO UPDATE SET text = excluded.text, page_offsets = excluded.page_offsets, updated_at = excluded.updated_at`,
      )
      .run(c.sourceId, this.s.ownerId, c.notebookId, c.text, JSON.stringify(c.pageOffsets), now());
  }
  async delete(sourceId: string): Promise<void> {
    this.s.db
      .prepare(`DELETE FROM source_contents WHERE source_id = ? AND owner_id = ?`)
      .run(sourceId, this.s.ownerId);
  }
  async deleteByNotebook(notebookId: string): Promise<void> {
    this.s.db
      .prepare(`DELETE FROM source_contents WHERE notebook_id = ? AND owner_id = ?`)
      .run(notebookId, this.s.ownerId);
  }
}

class SqliteSettingsRepo implements SettingsRepo {
  constructor(private readonly s: SqliteStore) {}
  async get<T = unknown>(key: string): Promise<T | null> {
    const r = this.s.db
      .prepare(`SELECT value FROM settings WHERE owner_id = ? AND key = ?`)
      .get(this.s.ownerId, key) as { value: string } | undefined;
    return r ? (JSON.parse(r.value) as T) : null;
  }
  async set(key: string, value: unknown): Promise<void> {
    this.s.db
      .prepare(
        `INSERT INTO settings (owner_id, key, value, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(owner_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(this.s.ownerId, key, JSON.stringify(value ?? null), now());
  }
  async delete(key: string): Promise<void> {
    this.s.db.prepare(`DELETE FROM settings WHERE owner_id = ? AND key = ?`).run(this.s.ownerId, key);
  }
  async all(): Promise<Record<string, unknown>> {
    const rows = this.s.db
      .prepare(`SELECT key, value FROM settings WHERE owner_id = ?`)
      .all(this.s.ownerId) as {
      key: string;
      value: string;
    }[];
    return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
  }
}

class SqliteAssignmentRepo implements AssignmentRepo {
  constructor(private readonly s: SqliteStore) {}
  async list(): Promise<ModelAssignment[]> {
    const rows = this.s.db
      .prepare(
        `SELECT capability, provider_id, model FROM model_assignments WHERE owner_id = ? ORDER BY capability`,
      )
      .all(this.s.ownerId) as { capability: Capability; provider_id: string; model: string }[];
    return rows.map((r) => ({ capability: r.capability, providerId: r.provider_id, model: r.model }));
  }
  async get(capability: Capability): Promise<ModelAssignment | null> {
    return (await this.list()).find((a) => a.capability === capability) ?? null;
  }
  async set(a: ModelAssignment): Promise<void> {
    this.s.db
      .prepare(
        `INSERT INTO model_assignments (owner_id, capability, provider_id, model, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(owner_id, capability) DO UPDATE SET provider_id = excluded.provider_id, model = excluded.model, updated_at = excluded.updated_at`,
      )
      .run(this.s.ownerId, a.capability, a.providerId, a.model, now());
  }
  async delete(capability: Capability): Promise<void> {
    this.s.db
      .prepare(`DELETE FROM model_assignments WHERE owner_id = ? AND capability = ?`)
      .run(this.s.ownerId, capability);
  }
}

class SqliteUsageRepo implements UsageRepo {
  constructor(private readonly s: SqliteStore) {}
  async add(r: Omit<UsageRow, "calls">): Promise<void> {
    this.s.db
      .prepare(
        `INSERT INTO usage_daily (owner_id, day, provider_id, model, kind, calls, input_tokens, output_tokens,
           cache_read_tokens, cache_write_tokens, searches)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
         ON CONFLICT(owner_id, day, provider_id, model, kind) DO UPDATE SET
           calls = calls + 1,
           input_tokens = input_tokens + excluded.input_tokens,
           output_tokens = output_tokens + excluded.output_tokens,
           cache_read_tokens = cache_read_tokens + excluded.cache_read_tokens,
           cache_write_tokens = cache_write_tokens + excluded.cache_write_tokens,
           searches = searches + excluded.searches`,
      )
      .run(
        this.s.ownerId,
        r.day,
        r.providerId,
        r.model,
        r.kind,
        r.inputTokens,
        r.outputTokens,
        r.cacheReadTokens,
        r.cacheWriteTokens,
        r.searches,
      );
  }
  async list(since?: string): Promise<UsageRow[]> {
    const rows = this.s.db
      .prepare(
        `SELECT day, provider_id, model, kind, calls, input_tokens, output_tokens, cache_read_tokens,
           cache_write_tokens, searches
         FROM usage_daily WHERE owner_id = ? AND day >= ? ORDER BY day`,
      )
      .all(this.s.ownerId, since ?? "0000-00-00") as Record<string, string | number>[];
    return rows.map((r) => ({
      day: String(r.day),
      providerId: String(r.provider_id),
      model: String(r.model),
      kind: String(r.kind),
      calls: Number(r.calls),
      inputTokens: Number(r.input_tokens),
      outputTokens: Number(r.output_tokens),
      cacheReadTokens: Number(r.cache_read_tokens),
      cacheWriteTokens: Number(r.cache_write_tokens),
      searches: Number(r.searches),
    }));
  }
}

const nb = (x: { notebookId?: string | null }): Keys => ({ notebookId: x.notebookId ?? null });

export class SqliteStore implements Store {
  db: DB;
  readonly vecTables = new Set<number>();
  readonly notebooks;
  readonly sources;
  readonly contents;
  readonly highlights;
  readonly chunks;
  readonly conversations;
  readonly messages;
  readonly notes;
  readonly artifacts;
  readonly elements;
  readonly cards;
  readonly reviewLogs;
  readonly views;
  readonly properties;
  readonly providers;
  readonly jobs;
  readonly undo;
  readonly assignments;
  readonly settings;
  readonly usage;
  readonly assets;
  readonly lore;
  readonly linkPreviews;
  readonly shares;

  constructor(
    private readonly path: string,
    readonly ownerId = "local",
  ) {
    this.db = openDb(path);
    this.notebooks = new SqliteEntityRepo<import("./types").NotebookRecord>(this, "notebooks", (n) => ({
      notebookId: n.id,
    }));
    this.sources = new SqliteEntityRepo<import("@quirenote/core").Source>(this, "sources", nb);
    this.contents = new SqliteContentRepo(this);
    this.highlights = new SqliteEntityRepo<import("./types").Highlight>(this, "highlights", (h) => ({
      notebookId: h.notebookId,
      refId: h.sourceId,
    }));
    this.chunks = new SqliteChunkRepo(this);
    this.conversations = new SqliteEntityRepo<import("@quirenote/core").Conversation>(
      this,
      "conversations",
      nb,
    );
    this.messages = new SqliteEntityRepo<import("@quirenote/core").Message>(this, "messages", (m) => ({
      refId: m.conversationId,
    }));
    this.notes = new SqliteEntityRepo<import("@quirenote/core").Note>(this, "notes", nb);
    this.artifacts = new SqliteEntityRepo<import("@quirenote/core").Artifact>(this, "artifacts", nb);
    this.elements = new SqliteEntityRepo<import("@quirenote/core").Element>(this, "elements", nb);
    this.cards = new SqliteEntityRepo<import("./types").ReviewCardRecord>(this, "review_cards", (c) => ({
      notebookId: c.notebookId,
      refId: c.elementId,
    }));
    this.reviewLogs = new SqliteEntityRepo<import("./types").ReviewLog>(this, "review_logs", (l) => ({
      notebookId: l.notebookId,
      refId: l.cardId,
    }));
    this.views = new SqliteEntityRepo<import("@quirenote/core").DbView>(this, "views", nb);
    this.properties = new SqliteEntityRepo<import("@quirenote/core").PropertyDef>(this, "properties", nb);
    this.providers = new SqliteEntityRepo<import("./types").ProviderRecord>(this, "providers", () => ({}));
    this.jobs = new SqliteEntityRepo<import("./types").JobRecord>(this, "jobs", (j) => ({
      notebookId: j.notebookId,
      refId: j.refId,
    }));
    this.undo = new SqliteEntityRepo<import("./types").UndoRecord>(this, "undo_log", nb);
    this.assignments = new SqliteAssignmentRepo(this);
    this.settings = new SqliteSettingsRepo(this);
    this.usage = new SqliteUsageRepo(this);
    this.assets = new SqliteEntityRepo<import("@quirenote/core").Asset>(this, "assets", nb);
    this.lore = new SqliteEntityRepo<import("@quirenote/core").LoreEntry>(this, "lore_entries", nb);
    this.linkPreviews = new SqliteEntityRepo<import("./types").LinkPreview>(
      this,
      "link_previews",
      () => ({}),
    );
    this.shares = new SqliteEntityRepo<import("./types").ShareRecord>(this, "shares", (r) => ({
      notebookId: r.notebookId,
      refId: r.targetId,
    }));
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.db.inTransaction) return fn();
    this.db.exec("BEGIN");
    try {
      const out = await fn();
      this.db.exec("COMMIT");
      return out;
    } catch (err) {
      if (this.db.inTransaction) this.db.exec("ROLLBACK");
      throw err;
    }
  }

  async sizeBytes(): Promise<number> {
    if (this.path === ":memory:") return this.db.serialize().byteLength;
    let total = 0;
    for (const suffix of ["", "-wal"]) {
      try {
        total += statSync(this.path + suffix).size;
      } catch {
        /* 文件不存在 */
      }
    }
    return total;
  }

  async snapshot(): Promise<Uint8Array> {
    this.db.pragma("wal_checkpoint(TRUNCATE)");
    return new Uint8Array(this.db.serialize());
  }

  async restore(bytes: Uint8Array): Promise<void> {
    // 先校验快照可以打开，并且是 QuireNote 的库。
    const probe = new Database(inMemoryImage(bytes));
    try {
      probe.prepare("SELECT COUNT(*) FROM notebooks").get();
    } catch {
      throw new Error("快照不是有效的 QuireNote 数据库");
    } finally {
      probe.close();
    }
    this.db.close();
    this.vecTables.clear();
    if (this.path === ":memory:") {
      this.db = new Database(inMemoryImage(bytes));
      sqliteVec.load(this.db);
      migrate(this.db);
      return;
    }
    for (const suffix of ["-wal", "-shm"]) if (existsSync(this.path + suffix)) rmSync(this.path + suffix);
    writeFileSync(this.path, bytes);
    this.db = openDb(this.path);
  }

  async close(): Promise<void> {
    if (this.db.open) this.db.close();
  }
}

export function createSqliteStore(path: string, ownerId = "local"): SqliteStore {
  return new SqliteStore(path, ownerId);
}
