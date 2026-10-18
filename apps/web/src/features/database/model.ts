import {
  ARTIFACT_KIND_META,
  type Artifact,
  type DbView,
  ELEMENT_TYPE_META,
  type Element,
  type EntityType,
  type Note,
  type PropertyDef,
  type PropValue,
  SOURCE_KIND_META,
  type Source,
} from "@quirenote/core";

/** 数据库视图中的统一条目。 */
export interface DbRow {
  id: string;
  entity: EntityType;
  title: string;
  /** 内置字段 + 自定义属性，键为字段 id。 */
  values: Record<string, PropValue>;
  raw: Note | Source | Artifact | Element;
}

export interface FieldDef {
  id: string;
  name: string;
  type: PropertyDef["type"];
  builtin: boolean;
  options?: { value: string; color: string }[];
}

type BuiltinField = Omit<FieldDef, "name">;

const BUILTIN: Record<EntityType, BuiltinField[]> = {
  note: [
    {
      id: "kind",
      type: "select",
      builtin: true,
      options: [
        { value: "note", color: "indigo" },
        { value: "card", color: "violet" },
      ],
    },
    { id: "tags", type: "multi_select", builtin: true },
    { id: "origin", type: "select", builtin: true },
  ],
  source: [
    { id: "kind", type: "select", builtin: true },
    { id: "status", type: "select", builtin: true },
    { id: "charCount", type: "number", builtin: true },
    { id: "url", type: "url", builtin: true },
  ],
  artifact: [
    { id: "kind", type: "select", builtin: true },
    { id: "status", type: "select", builtin: true },
  ],
  element: [
    { id: "type", type: "select", builtin: true },
    { id: "definition", type: "text", builtin: true },
    { id: "mastery", type: "number", builtin: true },
    { id: "refs", type: "number", builtin: true },
  ],
};

const COMMON: BuiltinField[] = [
  { id: "createdAt", type: "date", builtin: true },
  { id: "updatedAt", type: "date", builtin: true },
];

/** 内置字段的显示名由调用方按界面语言给出（label 收到字段 id）。 */
export function fieldsFor(
  entity: EntityType,
  props: PropertyDef[],
  label: (id: string) => string = (id) => id,
): FieldDef[] {
  const builtin: BuiltinField[] = [
    { id: "title", type: "text", builtin: true },
    ...BUILTIN[entity],
    ...COMMON,
  ];
  return [
    ...builtin.map((f) => ({ ...f, name: label(f.id) })),
    ...props
      .filter((p) => p.entity === entity)
      .map((p) => ({ id: `prop:${p.id}`, name: p.name, type: p.type, builtin: false, options: p.options })),
  ];
}

export function toRows(
  entity: EntityType,
  items: (Note | Source | Artifact | Element)[],
  opts: { en: boolean; untitled: string },
): DbRow[] {
  const label = (m: { label: string; labelEn: string }) => (opts.en ? m.labelEn : m.label);
  return items.map((it) => {
    const values: Record<string, PropValue> = { createdAt: it.createdAt, updatedAt: it.updatedAt };
    let title = "";
    if (entity === "note") {
      const n = it as Note;
      title = n.title || opts.untitled;
      Object.assign(values, { kind: n.kind, tags: n.tags, origin: n.origin.type });
    } else if (entity === "source") {
      const s = it as Source;
      title = s.title;
      Object.assign(values, {
        kind: label(SOURCE_KIND_META[s.kind]),
        status: s.status,
        charCount: s.charCount,
        url: s.url,
      });
    } else if (entity === "artifact") {
      const a = it as Artifact;
      title = a.title;
      Object.assign(values, { kind: label(ARTIFACT_KIND_META[a.kind]), status: a.status });
    } else {
      const e = it as Element;
      title = e.name;
      Object.assign(values, {
        type: label(ELEMENT_TYPE_META[e.type]),
        definition: e.definition,
        mastery: Math.round(e.mastery * 100),
        refs: e.refs.length,
      });
    }
    values.title = title;
    const props = (it as { props?: Record<string, PropValue> }).props ?? {};
    for (const [k, v] of Object.entries(props)) values[`prop:${k}`] = v;
    return { id: it.id, entity, title, values, raw: it };
  });
}

function asText(v: PropValue | undefined): string {
  if (v === null || v === undefined) return "";
  return Array.isArray(v) ? v.join(", ") : String(v);
}

export function applyFilters(rows: DbRow[], filters: DbView["filters"]): DbRow[] {
  return rows.filter((r) =>
    filters.every((f) => {
      const v = r.values[f.field];
      const t = asText(v).toLowerCase();
      const want = asText(f.value).toLowerCase();
      switch (f.op) {
        case "eq":
          return Array.isArray(v) ? v.map((x) => x.toLowerCase()).includes(want) : t === want;
        case "neq":
          return Array.isArray(v) ? !v.map((x) => x.toLowerCase()).includes(want) : t !== want;
        case "contains":
          return t.includes(want);
        case "gt":
          return typeof v === "number" ? v > Number(f.value) : t > want;
        case "lt":
          return typeof v === "number" ? v < Number(f.value) : t < want;
        case "empty":
          return t === "";
        case "not_empty":
          return t !== "";
        default:
          return true;
      }
    }),
  );
}

export function applySorts(rows: DbRow[], sorts: DbView["sorts"]): DbRow[] {
  if (!sorts.length) return rows;
  return [...rows].sort((a, b) => {
    for (const s of sorts) {
      const x = a.values[s.field];
      const y = b.values[s.field];
      const c =
        typeof x === "number" && typeof y === "number" ? x - y : asText(x).localeCompare(asText(y), "zh-CN");
      if (c) return s.dir === "asc" ? c : -c;
    }
    return 0;
  });
}

/** 按字段分组；多选字段的条目会出现在多个组里。 */
export function groupRows(rows: DbRow[], field: string): { key: string; rows: DbRow[] }[] {
  const map = new Map<string, DbRow[]>();
  for (const r of rows) {
    const v = r.values[field];
    const keys = Array.isArray(v) ? (v.length ? v : [""]) : [asText(v)];
    for (const k of keys) map.set(k, [...(map.get(k) ?? []), r]);
  }
  return [...map.entries()]
    .map(([key, rows]) => ({ key, rows }))
    .sort((a, b) => (a.key === "" ? 1 : b.key === "" ? -1 : a.key.localeCompare(b.key, "zh-CN")));
}

export { asText };
