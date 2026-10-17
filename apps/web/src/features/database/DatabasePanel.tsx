import type { DbView, EntityType, PropertyDef, PropValue } from "@quirenote/core";
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  Tag,
} from "@quirenote/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowDownUp,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Filter,
  GalleryVerticalEnd,
  Group,
  Kanban,
  Plus,
  Settings2,
  Table2,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { DataGrid } from "@/components/DataGrid";
import { PanelShell } from "@/components/Panel";
import i18n, { currentLang, useTranslation } from "@/i18n";
import { api } from "@/lib/api";
import { plainPreview } from "@/lib/format";
import { qk, queryClient, upsertInList } from "@/lib/query";
import { type PanelKind, useWorkspace } from "@/stores/workspace";
import {
  applyFilters,
  applySorts,
  asText,
  type DbRow,
  type FieldDef,
  fieldsFor,
  groupRows,
  toRows,
} from "./model";

const LAYOUTS = [
  { id: "table", icon: Table2 },
  { id: "board", icon: Kanban },
  { id: "gallery", icon: GalleryVerticalEnd },
  { id: "calendar", icon: CalendarDays },
] as const;

const ENTITY_PANEL: Record<EntityType, PanelKind> = {
  note: "note",
  source: "reader",
  artifact: "artifact",
  element: "elements",
};

function useEntityItems(nb: string, entity: EntityType) {
  const notes = useQuery({
    queryKey: qk.notes(nb),
    queryFn: () => api.notes.list(nb),
    enabled: entity === "note",
  });
  const sources = useQuery({
    queryKey: qk.sources(nb),
    queryFn: () => api.sources.list(nb),
    enabled: entity === "source",
  });
  const artifacts = useQuery({
    queryKey: qk.artifacts(nb),
    queryFn: () => api.artifacts.list(nb),
    enabled: entity === "artifact",
  });
  const elements = useQuery({
    queryKey: qk.elements(nb),
    queryFn: () => api.elements.list(nb),
    enabled: entity === "element",
  });
  return (
    { note: notes.data, source: sources.data, artifact: artifacts.data, element: elements.data }[entity] ?? []
  );
}

const defaultView = (entity: EntityType): Omit<DbView, "id" | "notebookId"> => ({
  entity,
  name: i18n.t("common.all"),
  layout: "table",
  filters: [],
  sorts: [{ field: "updatedAt", dir: "desc" }],
  groupBy: null,
  dateField: "updatedAt",
  hidden: [],
});

export function DatabasePanel({ notebookId }: { notebookId: string }) {
  const { t } = useTranslation();
  const [entity, setEntity] = useState<EntityType>("note");
  const views = useQuery({ queryKey: qk.views(notebookId), queryFn: () => api.views.list(notebookId) });
  const props = useQuery({
    queryKey: qk.properties(notebookId),
    queryFn: () => api.properties.list(notebookId),
  });
  const [viewId, setViewId] = useState<string | null>(null);
  const [local, setLocal] = useState<Omit<DbView, "id" | "notebookId">>(defaultView(entity));
  const entityViews = (views.data ?? []).filter((v) => v.entity === entity);
  const current = entityViews.find((v) => v.id === viewId) ?? entityViews[0];

  useEffect(() => {
    setLocal(current ? { ...current } : defaultView(entity));
  }, [current, entity]);

  // 视图配置防抖保存到服务端
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const patchView = (patch: Partial<DbView>) => {
    setLocal((l) => ({ ...l, ...patch }));
    if (!current) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const v = await api.views.update(current.id, patch);
      upsertInList(qk.views(notebookId), v);
    }, 500);
  };

  const createView = useMutation({
    mutationFn: (layout: DbView["layout"]) =>
      api.views.create(notebookId, {
        ...defaultView(entity),
        name: t(`db.${layout}`),
        layout,
        groupBy: layout === "board" ? fieldsFor(entity, [])[1]!.id : null,
      }),
    onSuccess: (v) => {
      upsertInList(qk.views(notebookId), v);
      setViewId(v.id);
    },
  });
  const removeView = useMutation({
    mutationFn: (id: string) => api.views.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.views(notebookId) }),
  });

  const items = useEntityItems(notebookId, entity);
  const fields = fieldsFor(entity, props.data ?? [], (id) => t(`db.field_${id}`));
  const en = currentLang() === "en";
  const rows = useMemo(
    () =>
      applySorts(
        applyFilters(toRows(entity, items, { en, untitled: t("notes.titlePlaceholder") }), local.filters),
        local.sorts,
      ),
    [entity, items, local.filters, local.sorts, en, t],
  );

  const setProp = async (row: DbRow, field: string, value: PropValue) => {
    const key = field.replace(/^prop:/, "");
    const nextProps = { ...((row.raw as { props?: Record<string, PropValue> }).props ?? {}), [key]: value };
    if (entity === "note")
      upsertInList(qk.notes(notebookId), await api.notes.update(row.id, { props: nextProps }));
    else if (entity === "source")
      upsertInList(qk.sources(notebookId), await api.sources.update(row.id, { props: nextProps }));
    else if (entity === "element")
      upsertInList(qk.elements(notebookId), await api.elements.update(row.id, { props: nextProps }));
  };

  const openRow = (r: DbRow) => {
    const kind = ENTITY_PANEL[entity];
    useWorkspace
      .getState()
      .open(kind === "elements" ? { kind, extra: { focus: r.title } } : { kind, id: r.id, title: r.title });
  };

  const visibleFields = fields.filter((f) => !local.hidden.includes(f.id));

  return (
    <PanelShell
      toolbar={
        <>
          <Select
            value={entity}
            onValueChange={(v) => {
              setEntity(v as EntityType);
              setViewId(null);
            }}
            options={(["note", "source", "artifact", "element"] as const).map((e) => ({
              value: e,
              label: t(`db.entity_${e}`),
            }))}
            className="h-7 w-24 text-[13px]"
            ariaLabel="entity"
          />
          <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
            {entityViews.map((v) => {
              const L = LAYOUTS.find((l) => l.id === v.layout)!;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setViewId(v.id)}
                  onDoubleClick={() => {
                    const name = prompt(t("common.rename"), v.name)?.trim();
                    if (name)
                      api.views.update(v.id, { name }).then((x) => upsertInList(qk.views(notebookId), x));
                  }}
                  className={cn(
                    "flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13px] text-fg-muted hover:bg-surface-hover",
                    current?.id === v.id && "bg-surface-sunken font-medium text-fg",
                  )}
                >
                  <L.icon className="size-3.5" />
                  {v.name}
                </button>
              );
            })}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-xs" variant="ghost" aria-label={t("db.newView")}>
                  <Plus />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>{t("db.newView")}</DropdownMenuLabel>
                {LAYOUTS.map((l) => (
                  <DropdownMenuItem key={l.id} onSelect={() => createView.mutate(l.id)}>
                    <l.icon />
                    {t(`db.${l.id}`)}
                  </DropdownMenuItem>
                ))}
                {current ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem danger onSelect={() => removeView.mutate(current.id)}>
                      <Trash2 />
                      {t("db.deleteView")}
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </>
      }
    >
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border/70 px-2.5 py-1.5">
          <div className="mr-1 inline-flex rounded-md bg-surface-sunken p-0.5">
            {LAYOUTS.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() =>
                  patchView({
                    layout: l.id,
                    groupBy: l.id === "board" && !local.groupBy ? fields[1]!.id : local.groupBy,
                  })
                }
                className={cn(
                  "grid size-6 place-items-center rounded text-fg-subtle",
                  local.layout === l.id && "bg-surface text-fg shadow-sm",
                )}
                aria-label={t(`db.${l.id}`)}
                title={t(`db.${l.id}`)}
              >
                <l.icon className="size-3.5" />
              </button>
            ))}
          </div>
          <FilterEditor
            fields={fields}
            filters={local.filters}
            onChange={(filters) => patchView({ filters })}
          />
          <SortEditor fields={fields} sorts={local.sorts} onChange={(sorts) => patchView({ sorts })} />
          {local.layout === "board" ? (
            <Popover>
              <PopoverTrigger asChild>
                <Button size="xs" variant={local.groupBy ? "soft" : "ghost"}>
                  <Group />
                  {t("db.group")}
                  {local.groupBy
                    ? `${t("common.colon")}${fields.find((f) => f.id === local.groupBy)?.name ?? ""}`
                    : ""}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-1">
                {[
                  { id: "", name: t("common.none") },
                  ...fields.filter((f) => ["select", "multi_select", "checkbox"].includes(f.type)),
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => patchView({ groupBy: f.id || null })}
                    className={cn(
                      "flex h-8 w-full items-center rounded-md px-2 text-[13px] hover:bg-surface-hover",
                      (local.groupBy ?? "") === f.id && "text-accent",
                    )}
                  >
                    {f.name}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          ) : null}
          {local.layout === "calendar" ? (
            <Select
              value={local.dateField ?? "updatedAt"}
              onValueChange={(v) => patchView({ dateField: v })}
              options={fields.filter((f) => f.type === "date").map((f) => ({ value: f.id, label: f.name }))}
              className="h-7 w-32 text-xs"
            />
          ) : null}
          <span className="flex-1" />
          <PropertiesEditor
            notebookId={notebookId}
            entity={entity}
            fields={fields}
            props={props.data ?? []}
            hidden={local.hidden}
            onHidden={(hidden) => patchView({ hidden })}
          />
        </div>
        <div className="relative min-h-0 flex-1">
          {local.layout === "table" ? (
            <div className="absolute inset-0">
              <DataGrid
                rows={rows.map((r) => ({ ...r.values, __id: r.id }))}
                onRowClick={(r) => openRow(rows.find((x) => x.id === r.__id)!)}
                columns={visibleFields.map((f) => ({
                  id: f.id,
                  name: f.name,
                  width: f.id === "title" ? 240 : f.type === "date" ? 130 : f.type === "number" ? 100 : 170,
                  sortValue: (r) =>
                    typeof r[f.id] === "number" ? (r[f.id] as number) : asText(r[f.id] as PropValue),
                  render: (r) => <FieldValue field={f} value={r[f.id] as PropValue} />,
                  onEdit:
                    f.builtin || entity === "artifact"
                      ? undefined
                      : (rowId, value) => {
                          const row = rows.find((x) => x.id === rowId)!;
                          setProp(row, f.id, parseInput(f, value));
                        },
                }))}
              />
            </div>
          ) : local.layout === "board" ? (
            <BoardView
              rows={rows}
              field={fields.find((f) => f.id === local.groupBy) ?? fields[1]!}
              onOpen={openRow}
              onMove={(r, v) => setProp(r, local.groupBy!, v)}
            />
          ) : local.layout === "gallery" ? (
            <div className="absolute inset-0 overflow-y-auto p-3">
              <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
                {rows.map((r) => (
                  <RowCard key={r.id} row={r} fields={visibleFields} onOpen={() => openRow(r)} />
                ))}
              </div>
            </div>
          ) : (
            <CalendarView rows={rows} field={local.dateField ?? "updatedAt"} onOpen={openRow} />
          )}
        </div>
      </div>
    </PanelShell>
  );
}

function parseInput(f: FieldDef, v: string): PropValue {
  if (f.type === "number") return v.trim() === "" ? null : Number(v);
  if (f.type === "checkbox") return ["1", "true", "是", "yes", "y"].includes(v.trim().toLowerCase());
  if (f.type === "multi_select")
    return v
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
  return v;
}

function FieldValue({ field, value }: { field: FieldDef; value: PropValue | undefined }) {
  if (value === null || value === undefined || value === "") return <span className="text-fg-subtle">—</span>;
  if (field.type === "date")
    return <span className="tabular-nums text-fg-muted">{String(value).slice(0, 10)}</span>;
  if (field.type === "checkbox") return <span>{value ? "✓" : "—"}</span>;
  if (field.type === "url")
    return (
      <a
        href={String(value)}
        target="_blank"
        rel="noreferrer"
        className="text-accent underline"
        onClick={(e) => e.stopPropagation()}
      >
        {String(value)
          .replace(/^https?:\/\//, "")
          .slice(0, 30)}
      </a>
    );
  if (Array.isArray(value))
    return (
      <span className="flex flex-wrap gap-1">
        {value.map((v) => (
          <Tag key={v} color={optColor(field, v)}>
            {v}
          </Tag>
        ))}
      </span>
    );
  if (field.type === "select") return <Tag color={optColor(field, String(value))}>{String(value)}</Tag>;
  return <span className={field.id === "title" ? "font-medium" : ""}>{String(value)}</span>;
}

function optColor(f: FieldDef, v: string): string {
  return (
    f.options?.find((o) => o.value === v)?.color ??
    ["indigo", "violet", "amber", "emerald", "sky", "rose"][
      [...v].reduce((a, c) => a + c.charCodeAt(0), 0) % 6
    ]!
  );
}

function RowCard({ row, fields, onOpen }: { row: DbRow; fields: FieldDef[]; onOpen: () => void }) {
  const raw = row.raw as { markdown?: string; definition?: string; summary?: string };
  const preview = raw.markdown ?? raw.definition ?? raw.summary ?? "";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col rounded-xl border border-border bg-surface p-3 text-left transition-colors hover:border-border-strong focus-ring"
    >
      <span className="text-[13.5px] font-semibold">{row.title}</span>
      {preview ? (
        <span className="mt-1 line-clamp-4 text-xs leading-relaxed text-fg-muted">
          {plainPreview(preview, 200)}
        </span>
      ) : null}
      <span className="mt-2 flex flex-wrap gap-1">
        {fields
          .filter((f) => f.id !== "title" && (f.type === "select" || f.type === "multi_select"))
          .slice(0, 3)
          .map((f) => (
            <FieldValue key={f.id} field={f} value={row.values[f.id]} />
          ))}
      </span>
    </button>
  );
}

function BoardView({
  rows,
  field,
  onOpen,
  onMove,
}: {
  rows: DbRow[];
  field: FieldDef;
  onOpen: (r: DbRow) => void;
  onMove: (r: DbRow, v: PropValue) => void;
}) {
  const { t } = useTranslation();
  const groups = groupRows(rows, field.id);
  const [over, setOver] = useState<string | null>(null);
  const movable = !field.builtin;
  return (
    <div className="absolute inset-0 flex gap-3 overflow-x-auto p-3">
      {groups.map((g) => (
        <div
          key={g.key}
          className={cn(
            "flex w-64 shrink-0 flex-col rounded-xl bg-surface-sunken/70 transition-colors",
            over === g.key && "bg-accent-soft",
          )}
          onDragOver={(e) => {
            if (!movable) return;
            e.preventDefault();
            setOver(g.key);
          }}
          onDragLeave={() => setOver(null)}
          onDrop={(e) => {
            setOver(null);
            const id = e.dataTransfer.getData("text/x-db-row");
            const r = rows.find((x) => x.id === id);
            if (r) onMove(r, field.type === "multi_select" ? (g.key ? [g.key] : []) : g.key || null);
          }}
        >
          <div className="flex items-center gap-2 px-3 py-2">
            {g.key ? (
              <Tag color={optColor(field, g.key)}>{g.key}</Tag>
            ) : (
              <span className="text-xs text-fg-subtle">{t("db.noGroup")}</span>
            )}
            <span className="text-xs tabular-nums text-fg-subtle">{g.rows.length}</span>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
            {g.rows.map((r) => (
              <div
                key={r.id}
                draggable={movable}
                onDragStart={(e) => e.dataTransfer.setData("text/x-db-row", r.id)}
              >
                <RowCard row={r} fields={[]} onOpen={() => onOpen(r)} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function CalendarView({ rows, field, onOpen }: { rows: DbRow[]; field: string; onOpen: (r: DbRow) => void }) {
  const { t } = useTranslation();
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const start = new Date(month);
  start.setDate(1 - ((month.getDay() + 6) % 7));
  const days = Array.from(
    { length: 42 },
    (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
  );
  const byDay = new Map<string, DbRow[]>();
  for (const r of rows) {
    const v = r.values[field];
    if (!v) continue;
    const d = new Date(String(v));
    if (Number.isNaN(d.getTime())) continue;
    const k = d.toDateString();
    byDay.set(k, [...(byDay.get(k) ?? []), r]);
  }
  const today = new Date().toDateString();
  return (
    <div className="absolute inset-0 flex flex-col p-3">
      <div className="mb-2 flex items-center gap-2">
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          aria-label="prev"
        >
          <ChevronLeft />
        </Button>
        <span className="w-28 text-center text-sm font-semibold">
          {month.toLocaleDateString(currentLang() === "en" ? "en" : "zh-CN", {
            year: "numeric",
            month: "long",
          })}
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          aria-label="next"
        >
          <ChevronRight />
        </Button>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] text-fg-subtle">
        {t("db.weekdays")
          .split(",")
          .map((d) => (
            <div key={d} className="py-1">
              {d}
            </div>
          ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 overflow-hidden rounded-lg border border-border">
        {days.map((d) => {
          const list = byDay.get(d.toDateString()) ?? [];
          const inMonth = d.getMonth() === month.getMonth();
          return (
            <div
              key={d.toISOString()}
              className={cn(
                "min-h-0 overflow-hidden border-r border-b border-border p-1 [&:nth-child(7n)]:border-r-0",
                !inMonth && "bg-surface-sunken/50",
              )}
            >
              <span
                className={cn(
                  "inline-grid size-5 place-items-center rounded-full text-[11px] tabular-nums",
                  d.toDateString() === today
                    ? "bg-accent text-accent-fg"
                    : inMonth
                      ? "text-fg-muted"
                      : "text-fg-subtle/60",
                )}
              >
                {d.getDate()}
              </span>
              <div className="space-y-0.5">
                {list.slice(0, 3).map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onOpen(r)}
                    className="block w-full truncate rounded bg-accent-soft px-1 text-left text-[11px] text-accent-soft-fg hover:bg-accent-soft-hover"
                  >
                    {r.title}
                  </button>
                ))}
                {list.length > 3 ? (
                  <span className="px-1 text-[10px] text-fg-subtle">+{list.length - 3}</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const OPS: DbView["filters"][number]["op"][] = ["contains", "eq", "neq", "gt", "lt", "empty", "not_empty"];

function FilterEditor({
  fields,
  filters,
  onChange,
}: {
  fields: FieldDef[];
  filters: DbView["filters"];
  onChange: (f: DbView["filters"]) => void;
}) {
  const { t } = useTranslation();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="xs" variant={filters.length ? "soft" : "ghost"}>
          <Filter />
          {t("db.filter")}
          {filters.length ? ` ${filters.length}` : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[26rem] space-y-2">
        {filters.map((f, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Select
              value={f.field}
              onValueChange={(v) => onChange(filters.map((x, j) => (j === i ? { ...x, field: v } : x)))}
              options={fields.map((x) => ({ value: x.id, label: x.name }))}
              className="h-7 w-28 text-xs"
            />
            <Select
              value={f.op}
              onValueChange={(v) =>
                onChange(filters.map((x, j) => (j === i ? { ...x, op: v as typeof f.op } : x)))
              }
              options={OPS.map((o) => ({ value: o, label: t(`db.op_${o}`) }))}
              className="h-7 w-24 text-xs"
            />
            {f.op === "empty" || f.op === "not_empty" ? (
              <span className="flex-1" />
            ) : (
              <Input
                defaultValue={asText(f.value)}
                onBlur={(e) =>
                  onChange(filters.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
                }
                className="h-7 flex-1 text-xs"
              />
            )}
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => onChange(filters.filter((_, j) => j !== i))}
              aria-label="remove"
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button
          size="xs"
          variant="ghost"
          onClick={() => onChange([...filters, { field: "title", op: "contains", value: "" }])}
        >
          <Plus />
          {t("db.addFilter")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function SortEditor({
  fields,
  sorts,
  onChange,
}: {
  fields: FieldDef[];
  sorts: DbView["sorts"];
  onChange: (s: DbView["sorts"]) => void;
}) {
  const { t } = useTranslation();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="xs" variant={sorts.length ? "soft" : "ghost"}>
          <ArrowDownUp />
          {t("db.sort")}
          {sorts.length ? ` ${sorts.length}` : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-2">
        {sorts.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Select
              value={s.field}
              onValueChange={(v) => onChange(sorts.map((x, j) => (j === i ? { ...x, field: v } : x)))}
              options={fields.map((x) => ({ value: x.id, label: x.name }))}
              className="h-7 flex-1 text-xs"
            />
            <Select
              value={s.dir}
              onValueChange={(v) =>
                onChange(sorts.map((x, j) => (j === i ? { ...x, dir: v as "asc" | "desc" } : x)))
              }
              options={[
                { value: "asc", label: t("db.asc") },
                { value: "desc", label: t("db.desc") },
              ]}
              className="h-7 w-20 text-xs"
            />
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => onChange(sorts.filter((_, j) => j !== i))}
              aria-label="remove"
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button
          size="xs"
          variant="ghost"
          onClick={() => onChange([...sorts, { field: "title", dir: "asc" }])}
        >
          <Plus />
          {t("db.addSort")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function PropertiesEditor({
  notebookId,
  entity,
  fields,
  props,
  hidden,
  onHidden,
}: {
  notebookId: string;
  entity: EntityType;
  fields: FieldDef[];
  props: PropertyDef[];
  hidden: string[];
  onHidden: (h: string[]) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [type, setType] = useState<PropertyDef["type"]>("select");
  const create = useMutation({
    mutationFn: () => api.properties.create(notebookId, { entity, name: name.trim(), type, options: [] }),
    onSuccess: (p) => {
      upsertInList(qk.properties(notebookId), p);
      setName("");
    },
  });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="xs" variant="ghost">
          <Settings2 />
          {t("db.properties")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>{t("db.shownFields")}</DropdownMenuLabel>
        {fields.map((f) => (
          <DropdownMenuCheckboxItem
            key={f.id}
            checked={!hidden.includes(f.id)}
            disabled={f.id === "title"}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={(on) => onHidden(on ? hidden.filter((h) => h !== f.id) : [...hidden, f.id])}
          >
            {f.name}
            {!f.builtin ? <span className="ml-auto text-[10px] text-fg-subtle">{f.type}</span> : null}
          </DropdownMenuCheckboxItem>
        ))}
        {entity !== "artifact" ? (
          <>
            <DropdownMenuSeparator />
            <form
              className="space-y-1.5 p-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) create.mutate();
              }}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <span className="text-[11px] font-medium text-fg-subtle">{t("db.addProperty")}</span>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("db.propName")}
                className="h-7 text-xs"
              />
              <div className="flex gap-1.5">
                <Select
                  value={type}
                  onValueChange={(v) => setType(v as PropertyDef["type"])}
                  options={(
                    ["text", "number", "select", "multi_select", "date", "checkbox", "url"] as const
                  ).map((x) => ({ value: x, label: x }))}
                  className="h-7 flex-1 text-xs"
                />
                <Button type="submit" size="xs" variant="primary" disabled={!name.trim()}>
                  {t("common.add")}
                </Button>
              </div>
              {props.filter((p) => p.entity === entity).length ? (
                <p className="text-[11px] text-fg-subtle">{t("db.editPropHint")}</p>
              ) : null}
            </form>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
