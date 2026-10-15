import { describe, expect, it } from "vitest";
import { applyFilters, applySorts, type DbRow, groupRows } from "./model";

const row = (id: string, values: DbRow["values"]): DbRow => ({
  id,
  entity: "note",
  title: id,
  values,
  raw: {} as never,
});
const rows = [
  row("a", { title: "Alpha", tags: ["x", "y"], n: 3 }),
  row("b", { title: "beta", tags: [], n: 10 }),
  row("c", { title: "Gamma", tags: ["y"], n: null }),
];

describe("database view model", () => {
  it("筛选：contains / eq（多选）/ empty / gt", () => {
    expect(applyFilters(rows, [{ field: "title", op: "contains", value: "ta" }]).map((r) => r.id)).toEqual([
      "b",
    ]);
    expect(applyFilters(rows, [{ field: "tags", op: "eq", value: "y" }]).map((r) => r.id)).toEqual([
      "a",
      "c",
    ]);
    expect(applyFilters(rows, [{ field: "tags", op: "empty", value: null }]).map((r) => r.id)).toEqual(["b"]);
    expect(applyFilters(rows, [{ field: "n", op: "gt", value: 5 }]).map((r) => r.id)).toEqual(["b"]);
  });

  it("排序：数字按数值，多字段依次比较", () => {
    expect(applySorts(rows, [{ field: "n", dir: "desc" }]).map((r) => r.id)[0]).toBe("b");
    expect(applySorts(rows, [{ field: "title", dir: "asc" }]).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("分组：多选字段出现在多个组，空值组排最后", () => {
    const g = groupRows(rows, "tags");
    expect(g.map((x) => x.key)).toEqual(["x", "y", ""]);
    expect(g.find((x) => x.key === "y")!.rows.map((r) => r.id)).toEqual(["a", "c"]);
  });
});
