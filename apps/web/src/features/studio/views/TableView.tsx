import { newId } from "@quirenote/core";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@quirenote/ui";
import { Columns3, MoreVertical, Pencil, Plus, Rows3, Trash2 } from "lucide-react";
import { DataGrid, type GridRow } from "@/components/DataGrid";
import { useTranslation } from "@/i18n";
import type { ArtifactViewProps } from "../ArtifactPanel";

type Cell = string | number | null;

export function TableView({ data, onChange }: ArtifactViewProps<"table">) {
  const { t } = useTranslation();
  const { columns, rows } = data.table;
  // 行没有 id，用下标作为稳定 key
  const gridRows: GridRow[] = rows.map((r, i) => ({ ...r, __id: String(i) }));
  const commit = (next: { columns?: typeof columns; rows?: Record<string, Cell>[] }) =>
    onChange({ kind: "table", table: { columns: next.columns ?? columns, rows: next.rows ?? rows } });

  return (
    <div className="absolute inset-0">
      <DataGrid
        rows={gridRows}
        columns={columns.map((c) => ({
          id: c.id,
          name: c.name,
          width: c.type === "number" ? 120 : 200,
          sortValue: (r) => (c.type === "number" ? Number(r[c.id] ?? 0) : String(r[c.id] ?? "")),
          onEdit: (rowId, value) => {
            const i = Number(rowId);
            const v: Cell =
              c.type === "number" && value.trim() !== "" && !Number.isNaN(Number(value))
                ? Number(value)
                : value;
            commit({ rows: rows.map((r, j) => (j === i ? { ...r, [c.id]: v } : r)) });
          },
          headerMenu: (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  className="mr-1 opacity-0 group-hover:opacity-100"
                  aria-label="column menu"
                >
                  <MoreVertical />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  onSelect={() => {
                    const name = prompt(t("common.rename"), c.name)?.trim();
                    if (name) commit({ columns: columns.map((x) => (x.id === c.id ? { ...x, name } : x)) });
                  }}
                >
                  <Pencil />
                  {t("common.rename")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    commit({
                      columns: columns.map((x) =>
                        x.id === c.id ? { ...x, type: x.type === "number" ? "text" : "number" } : x,
                      ),
                    })
                  }
                >
                  <Columns3 />
                  {c.type === "number" ? "改为文本列" : "改为数字列"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  danger
                  onSelect={() => commit({ columns: columns.filter((x) => x.id !== c.id) })}
                >
                  <Trash2 />
                  {t("common.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ),
        }))}
        toolbar={
          <>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => commit({ rows: [...rows, Object.fromEntries(columns.map((c) => [c.id, ""]))] })}
            >
              <Rows3 />
              {t("studio.addRow")}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() =>
                commit({
                  columns: [...columns, { id: newId("col"), name: `列 ${columns.length + 1}`, type: "text" }],
                })
              }
            >
              <Plus />
              {t("studio.addColumn")}
            </Button>
          </>
        }
        footer={
          <button
            type="button"
            onClick={() => commit({ rows: [...rows, Object.fromEntries(columns.map((c) => [c.id, ""]))] })}
            className="flex h-9 w-full items-center gap-1.5 px-3 text-[13px] text-fg-subtle hover:bg-surface-hover hover:text-fg"
          >
            <Plus className="size-3.5" />
            {t("studio.addRow")}
          </button>
        }
      />
    </div>
  );
}
