import { cn, Input } from "@quirenote/ui";
import { flexRender } from "@tanstack/react-table";
import {
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type LegacyColumnDef,
  useLegacyTable,
} from "@tanstack/react-table/legacy";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ChevronsUpDown, Search } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";

export type GridRow = Record<string, unknown> & { __id: string };

export interface GridColumn {
  id: string;
  name: string;
  width?: number;
  /** 自定义单元格渲染；不传时显示文本。 */
  render?: (row: GridRow) => ReactNode;
  /** 可编辑时，提交新值。 */
  onEdit?: (rowId: string, value: string) => void;
  sortValue?: (row: GridRow) => string | number;
  headerMenu?: ReactNode;
}

/**
 * 通用数据网格：排序、全局筛选、行虚拟化、单元格就地编辑。
 * 生成物里的数据表格和数据库视图的表格布局共用它。
 */
export function DataGrid({
  columns,
  rows,
  onRowClick,
  toolbar,
  footer,
  className,
}: {
  columns: GridColumn[];
  rows: GridRow[];
  onRowClick?: (row: GridRow) => void;
  toolbar?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<{ row: string; col: string } | null>(null);
  const defs: LegacyColumnDef<GridRow>[] = columns.map((c) => ({
    id: c.id,
    header: c.name,
    size: c.width ?? 180,
    accessorFn: (r: GridRow) => (c.sortValue ? c.sortValue(r) : String(r[c.id] ?? "")),
    cell: (ctx) => {
      const row = ctx.row.original;
      if (c.onEdit && editing?.row === row.__id && editing.col === c.id) {
        return (
          <textarea
            autoFocus
            defaultValue={String(row[c.id] ?? "")}
            rows={1}
            className="block w-full resize-none rounded bg-surface px-1 py-0.5 text-[13px] outline-none ring-2 ring-accent/50"
            onBlur={(e) => {
              setEditing(null);
              if (e.target.value !== String(row[c.id] ?? "")) c.onEdit!(row.__id, e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.blur();
              }
              if (e.key === "Escape") setEditing(null);
            }}
          />
        );
      }
      return c.render ? (
        c.render(row)
      ) : (
        <span className="whitespace-pre-wrap">{String(row[c.id] ?? "")}</span>
      );
    },
  }));

  const table = useLegacyTable({
    data: rows,
    columns: defs,
    getRowId: (r: GridRow) => r.__id,
    state: { globalFilter: filter },
    onGlobalFilterChange: setFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: "includesString",
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const tableRows = table.getRowModel().rows;
  const v = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 38,
    overscan: 10,
  });
  const total = table.getTotalSize();

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <div className="relative w-56">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-fg-subtle" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="筛选…"
            className="h-7 pl-7 text-[13px]"
          />
        </div>
        <span className="text-xs text-fg-subtle tabular-nums">{tableRows.length} 行</span>
        <span className="flex-1" />
        {toolbar}
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto border-t border-border">
        <div style={{ width: Math.max(total, 0), minWidth: "100%" }}>
          <div className="sticky top-0 z-10 flex border-b border-border bg-surface-sunken/95 backdrop-blur">
            {table.getHeaderGroups()[0]!.headers.map((h) => {
              const sorted = h.column.getIsSorted();
              const col = columns.find((c) => c.id === h.column.id);
              return (
                <div
                  key={h.id}
                  className="group flex shrink-0 items-center border-r border-border last:border-r-0"
                  style={{ width: h.getSize() }}
                >
                  <button
                    type="button"
                    onClick={h.column.getToggleSortingHandler()}
                    className="flex h-9 min-w-0 flex-1 items-center gap-1 px-2.5 text-left text-xs font-semibold text-fg-muted hover:text-fg"
                  >
                    <span className="truncate">{flexRender(h.column.columnDef.header, h.getContext())}</span>
                    {sorted === "asc" ? (
                      <ArrowUp className="size-3" />
                    ) : sorted === "desc" ? (
                      <ArrowDown className="size-3" />
                    ) : (
                      <ChevronsUpDown className="size-3 opacity-0 group-hover:opacity-50" />
                    )}
                  </button>
                  {col?.headerMenu}
                </div>
              );
            })}
          </div>
          <div className="relative" style={{ height: v.getTotalSize() }}>
            {v.getVirtualItems().map((vr) => {
              const row = tableRows[vr.index]!;
              return (
                <div
                  key={row.id}
                  data-index={vr.index}
                  ref={v.measureElement}
                  className={cn(
                    "absolute left-0 flex w-full border-b border-border/70 hover:bg-surface-hover/50",
                    onRowClick && "cursor-pointer",
                  )}
                  style={{ transform: `translateY(${vr.start}px)` }}
                  onClick={() => onRowClick?.(row.original)}
                >
                  {row.getVisibleCells().map((cell) => {
                    const col = columns.find((c) => c.id === cell.column.id);
                    return (
                      <div
                        key={cell.id}
                        className="shrink-0 border-r border-border/70 px-2.5 py-2 text-[13px] leading-snug last:border-r-0"
                        style={{ width: cell.column.getSize() }}
                        onClick={(e) => {
                          if (col?.onEdit) {
                            e.stopPropagation();
                            setEditing({ row: row.id, col: cell.column.id });
                          }
                        }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {footer}
        </div>
      </div>
    </div>
  );
}
