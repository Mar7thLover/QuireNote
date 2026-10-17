import { z } from "zod";

type PatchShape<S extends z.ZodRawShape> = {
  [K in keyof S]: z.ZodOptional<S[K] extends z.ZodDefault<infer T> ? T : S[K]>;
};

/**
 * 部分更新（PATCH）用的 schema：每个字段可选，并去掉默认值。
 * zod 4 的 `.partial()` 遇到没给的字段仍会填默认值，拿去合并会把已有的值覆盖掉。
 */
export function patchOf<S extends z.ZodRawShape>(schema: z.ZodObject<S>): z.ZodObject<PatchShape<S>> {
  const shape: Record<string, z.ZodType> = {};
  for (const [k, field] of Object.entries(schema.shape) as [string, z.ZodType][]) {
    let v = field;
    while (v instanceof z.ZodDefault || v instanceof z.ZodOptional) v = v.unwrap() as z.ZodType;
    shape[k] = v.optional();
  }
  return z.object(shape) as unknown as z.ZodObject<PatchShape<S>>;
}
