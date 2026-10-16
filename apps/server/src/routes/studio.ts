import {
  type Artifact,
  ArtifactData,
  ArtifactKind,
  DbView,
  type Element,
  ElementRef,
  ElementType,
  EntityType,
  FilterOp,
  MARKDOWN_ARTIFACTS,
  newId,
  nowIso,
  PropertyDef,
  PropertyType,
  Props,
  PropValue,
  ReviewRating,
} from "@quirenote/core";
import type { Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "../context";
import { badRequest } from "../errors";
import { cardsFromElements, deleteElement, enrich, mergeElements } from "../services/elements";
import { createCards, dueCards, publicCard, reviewCard, reviewStats } from "../services/review";
import { createArtifact, deleteArtifact, refineArtifact } from "../services/studio";
import { must, readJson } from "./util";

const ArtifactCreate = z.object({
  kind: ArtifactKind,
  sourceIds: z.array(z.string()).optional(),
  instructions: z.string().optional(),
  title: z.string().optional(),
});

const ArtifactPatch = z.object({
  title: z.string().min(1).optional(),
  data: ArtifactData.optional(),
  props: Props.optional(),
});

/** 生成物 kind 对应的数据 kind。 */
export function dataKindFor(kind: Artifact["kind"]): ArtifactData["kind"] {
  if (MARKDOWN_ARTIFACTS.includes(kind)) return "markdown";
  return kind as ArtifactData["kind"];
}

const ElementCreate = z.object({
  type: ElementType,
  name: z.string().min(1),
  definition: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  refs: z.array(ElementRef).optional(),
  relations: z.array(z.object({ targetId: z.string(), label: z.string() })).optional(),
  mastery: z.number().min(0).max(1).optional(),
  props: Props.optional(),
});

const ViewCreate = z.object({
  entity: EntityType,
  name: z.string().min(1),
  layout: z.enum(["table", "board", "gallery", "calendar"]),
  filters: z.array(z.object({ field: z.string(), op: FilterOp, value: PropValue })).optional(),
  sorts: z.array(z.object({ field: z.string(), dir: z.enum(["asc", "desc"]) })).optional(),
  groupBy: z.string().nullable().optional(),
  dateField: z.string().nullable().optional(),
  hidden: z.array(z.string()).optional(),
});

const PropertyCreate = z.object({
  entity: EntityType,
  name: z.string().min(1),
  type: PropertyType,
  options: z.array(z.object({ value: z.string(), color: z.string() })).optional(),
});

export function studioRoutes(api: Hono, ctx: AppContext): void {
  const { store } = ctx;
  const nbOr404 = async (id: string) => must(await store.notebooks.get(id), "Notebook");

  // ───── Artifacts ─────
  api.get("/notebooks/:nb/artifacts", async (c) => {
    await nbOr404(c.req.param("nb"));
    const list = await store.artifacts.list({ notebookId: c.req.param("nb") });
    return c.json(list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  });

  api.post("/notebooks/:nb/artifacts", async (c) => {
    await nbOr404(c.req.param("nb"));
    const input = await readJson(c, ArtifactCreate);
    return c.json(await createArtifact(ctx, c.req.param("nb"), input), 202);
  });

  api.get("/artifacts/:id", async (c) =>
    c.json(must(await store.artifacts.get(c.req.param("id")), "生成物")),
  );

  api.patch("/artifacts/:id", async (c) => {
    const art = must(await store.artifacts.get(c.req.param("id")), "生成物");
    const patch = await readJson(c, ArtifactPatch);
    if (patch.data && patch.data.kind !== dataKindFor(art.kind)) {
      throw badRequest(`data.kind 应为 ${dataKindFor(art.kind)}`);
    }
    const updated = must(await store.artifacts.update(art.id, patch as Partial<Artifact>), "生成物");
    ctx.events.emit("artifact", updated);
    return c.json(updated);
  });

  api.delete("/artifacts/:id", async (c) => {
    must((await deleteArtifact(ctx, c.req.param("id"))) || null, "生成物");
    return c.json({ ok: true });
  });

  api.post("/artifacts/:id/refine", async (c) => {
    const input = await readJson(
      c,
      z.object({ instruction: z.string().min(1), selection: z.string().optional() }),
    );
    return c.json(await refineArtifact(ctx, c.req.param("id"), input));
  });

  /** 补充：按当前数据重新合成媒体（编辑播客脚本 / 幻灯片 / 提示词后使用）。 */
  api.post("/artifacts/:id/render", async (c) => {
    const art = must(await store.artifacts.get(c.req.param("id")), "生成物");
    if (!["audio", "video", "image"].includes(art.kind)) throw badRequest("只有音频 / 视频 / 配图需要合成");
    if (!art.data) throw badRequest("生成物还没有内容");
    await store.artifacts.update(art.id, { status: "generating", error: null });
    const job = await ctx.jobs.enqueue(
      "artifact_media",
      { artifactId: art.id },
      { notebookId: art.notebookId, refId: art.id, message: "合成媒体" },
    );
    return c.json(job, 202);
  });

  // ───── Review ─────
  api.get("/notebooks/:nb/review/due", async (c) => {
    await nbOr404(c.req.param("nb"));
    return c.json(await dueCards(ctx, c.req.param("nb")));
  });

  api.get("/notebooks/:nb/review/stats", async (c) => {
    await nbOr404(c.req.param("nb"));
    return c.json(await reviewStats(ctx, c.req.param("nb")));
  });

  /** 补充：全部复习卡。 */
  api.get("/notebooks/:nb/review/cards", async (c) => {
    await nbOr404(c.req.param("nb"));
    return c.json((await store.cards.list({ notebookId: c.req.param("nb") })).map(publicCard));
  });

  api.post("/notebooks/:nb/review/cards", async (c) => {
    await nbOr404(c.req.param("nb"));
    const input = await readJson(
      c,
      z.object({
        cards: z
          .array(
            z.object({
              front: z.string().min(1),
              back: z.string(),
              elementId: z.string().nullable().optional(),
              artifactId: z.string().nullable().optional(),
            }),
          )
          .min(1),
      }),
    );
    return c.json(await createCards(ctx, c.req.param("nb"), input.cards), 201);
  });

  api.post("/review/:cardId", async (c) => {
    const { rating } = await readJson(c, z.object({ rating: ReviewRating }));
    return c.json(await reviewCard(ctx, c.req.param("cardId"), rating));
  });

  /** 补充：删除复习卡。 */
  api.delete("/review/:cardId", async (c) => {
    must((await store.cards.delete(c.req.param("cardId"))) || null, "复习卡");
    return c.json({ ok: true });
  });

  // ───── Elements ─────
  api.get("/notebooks/:nb/elements", async (c) => {
    await nbOr404(c.req.param("nb"));
    return c.json(await store.elements.list({ notebookId: c.req.param("nb") }));
  });

  api.post("/notebooks/:nb/elements", async (c) => {
    const nb = c.req.param("nb");
    await nbOr404(nb);
    const input = await readJson(c, ElementCreate);
    const ts = nowIso();
    const el: Element = {
      id: newId("el"),
      ownerId: store.ownerId,
      notebookId: nb,
      type: input.type,
      name: input.name.trim(),
      definition: input.definition ?? "",
      aliases: input.aliases ?? [],
      refs: input.refs ?? [],
      relations: input.relations ?? [],
      mastery: input.mastery ?? 0,
      props: input.props ?? {},
      createdAt: ts,
      updatedAt: ts,
    };
    await store.elements.insert(el);
    return c.json(el, 201);
  });

  api.patch("/elements/:id", async (c) => {
    must(await store.elements.get(c.req.param("id")), "元素");
    const patch = await readJson(c, ElementCreate.partial());
    return c.json(must(await store.elements.update(c.req.param("id"), patch as Partial<Element>), "元素"));
  });

  api.delete("/elements/:id", async (c) => {
    must((await deleteElement(ctx, c.req.param("id"))) || null, "元素");
    return c.json({ ok: true });
  });

  api.post("/notebooks/:nb/elements/extract", async (c) => {
    const nb = c.req.param("nb");
    await nbOr404(nb);
    const input = await readJson(
      c,
      z.object({
        sourceIds: z.array(z.string()).optional(),
        noteIds: z.array(z.string()).optional(),
        conversationId: z.string().optional(),
      }),
    );
    const job = await ctx.jobs.enqueue(
      "extract_elements",
      { notebookId: nb, ...input },
      { notebookId: nb, message: "抽取元素" },
    );
    return c.json(job, 202);
  });

  api.post("/notebooks/:nb/elements/merge", async (c) => {
    await nbOr404(c.req.param("nb"));
    const input = await readJson(c, z.object({ ids: z.array(z.string()).min(1), intoId: z.string() }));
    return c.json(await mergeElements(ctx, c.req.param("nb"), input.ids, input.intoId));
  });

  api.post("/elements/:id/enrich", async (c) => c.json(await enrich(ctx, c.req.param("id"))));

  api.post("/notebooks/:nb/elements/cards", async (c) => {
    await nbOr404(c.req.param("nb"));
    const input = await readJson(c, z.object({ ids: z.array(z.string()).min(1) }));
    return c.json(await cardsFromElements(ctx, c.req.param("nb"), input.ids), 201);
  });

  // ───── Views ─────
  api.get("/notebooks/:nb/views", async (c) => {
    await nbOr404(c.req.param("nb"));
    return c.json(await store.views.list({ notebookId: c.req.param("nb") }));
  });

  api.post("/notebooks/:nb/views", async (c) => {
    const nb = c.req.param("nb");
    await nbOr404(nb);
    const input = await readJson(c, ViewCreate);
    const view = DbView.parse({ id: newId("view"), notebookId: nb, ...input });
    await store.views.insert(view);
    return c.json(view, 201);
  });

  api.patch("/views/:id", async (c) => {
    must(await store.views.get(c.req.param("id")), "视图");
    const patch = await readJson(c, ViewCreate.partial());
    return c.json(must(await store.views.update(c.req.param("id"), patch), "视图"));
  });

  api.delete("/views/:id", async (c) => {
    must((await store.views.delete(c.req.param("id"))) || null, "视图");
    return c.json({ ok: true });
  });

  // ───── Properties ─────
  api.get("/notebooks/:nb/properties", async (c) => {
    await nbOr404(c.req.param("nb"));
    return c.json(await store.properties.list({ notebookId: c.req.param("nb") }));
  });

  api.post("/notebooks/:nb/properties", async (c) => {
    const nb = c.req.param("nb");
    await nbOr404(nb);
    const input = await readJson(c, PropertyCreate);
    const prop = PropertyDef.parse({ id: newId("pdef"), notebookId: nb, ...input });
    await store.properties.insert(prop);
    return c.json(prop, 201);
  });

  api.patch("/properties/:id", async (c) => {
    must(await store.properties.get(c.req.param("id")), "属性");
    const patch = await readJson(c, PropertyCreate.partial());
    return c.json(must(await store.properties.update(c.req.param("id"), patch), "属性"));
  });

  api.delete("/properties/:id", async (c) => {
    must((await store.properties.delete(c.req.param("id"))) || null, "属性");
    return c.json({ ok: true });
  });
}
