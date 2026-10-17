/** 元素：抽取（任务）、合并、补充定义、批量出卡。 */
import { enrichElement, extractElements, type Passage } from "@quirenote/ai";
import { ELEMENT_TYPE_META, type Element, newId, nowIso, type ReviewCard } from "@quirenote/core";
import type { AppContext } from "../context";
import { badRequest, notFound } from "../errors";
import { currentLang } from "../lang";
import { msg } from "../messages";
import { retrieve, toPassages } from "../retrieval";
import { gatherPassages } from "./passages";
import { createCards, updateElementMastery } from "./review";

type Ref = Element["refs"][number];

export function normName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\s「」“”"《》'‘’]/g, "");
}

export interface ExtractInput {
  notebookId: string;
  sourceIds?: string[];
  noteIds?: string[];
  conversationId?: string;
}

/** 收集抽取用的片段，并记住每个编号的出处。 */
async function collect(
  ctx: AppContext,
  input: ExtractInput,
): Promise<{ passages: Passage[]; origins: Map<number, Omit<Ref, "quote">> }> {
  const passages: Passage[] = [];
  const origins = new Map<number, Omit<Ref, "quote">>();
  const push = (text: string, title: string, origin: Omit<Ref, "quote">) => {
    const n = passages.length + 1;
    passages.push({ n, text, title });
    origins.set(n, origin);
  };
  const explicit = !!(input.sourceIds?.length || input.noteIds?.length || input.conversationId);
  if (input.sourceIds?.length || !explicit) {
    const { citable } = await gatherPassages(ctx, input.notebookId, {
      sourceIds: input.sourceIds?.length ? input.sourceIds : null,
      maxChars: 20_000,
    });
    for (const c of citable)
      push(c.chunk.text, c.sourceTitle, {
        sourceId: c.chunk.sourceId,
        chunkId: c.chunk.id,
        noteId: null,
        messageId: null,
      });
  }
  for (const id of input.noteIds ?? []) {
    const note = await ctx.store.notes.get(id);
    if (note && note.notebookId === input.notebookId && note.markdown.trim()) {
      push(note.markdown, note.title, { sourceId: null, chunkId: null, noteId: note.id, messageId: null });
    }
  }
  if (input.conversationId) {
    const msgs = await ctx.store.messages.list({ refId: input.conversationId });
    for (const m of msgs) {
      if (m.content.trim() && m.role !== "system")
        push(m.content, m.role === "user" ? "提问" : "回答", {
          sourceId: null,
          chunkId: null,
          noteId: null,
          messageId: m.id,
        });
    }
  }
  return { passages, origins };
}

function sameRef(a: Ref, b: Ref): boolean {
  return (
    a.chunkId === b.chunkId && a.noteId === b.noteId && a.messageId === b.messageId && a.quote === b.quote
  );
}

export async function runExtractJob(
  ctx: AppContext,
  input: ExtractInput,
  progress: (p: number, m?: string) => Promise<void>,
): Promise<string> {
  await progress(0.05, msg().job.collecting);
  const { passages, origins } = await collect(ctx, input);
  if (!passages.length) throw badRequest(msg().nothingToExtract);
  await progress(0.2, msg().job.extract);
  const draft = await extractElements(await ctx.models.chat(), passages);
  await progress(0.8, msg().job.merging);
  const existing = await ctx.store.elements.list({ notebookId: input.notebookId });
  const index = new Map<string, Element>();
  for (const e of existing) for (const n of [e.name, ...e.aliases]) index.set(normName(n), e);
  let created = 0;
  let merged = 0;
  for (const d of draft.elements) {
    if (!d.name.trim()) continue;
    const origin = origins.get(d.passage) ?? { sourceId: null, chunkId: null, noteId: null, messageId: null };
    const ref: Ref = { ...origin, quote: d.quote.slice(0, 500) };
    const hit = index.get(normName(d.name));
    if (hit) {
      const refs = hit.refs.some((r) => sameRef(r, ref)) ? hit.refs : [...hit.refs, ref];
      const updated = await ctx.store.elements.update(hit.id, {
        refs,
        definition: hit.definition || d.definition,
      });
      if (updated) index.set(normName(d.name), updated);
      merged++;
      continue;
    }
    const ts = nowIso();
    const el: Element = {
      id: newId("el"),
      ownerId: ctx.store.ownerId,
      notebookId: input.notebookId,
      type: d.type,
      name: d.name.trim().slice(0, 200),
      definition: d.definition,
      aliases: [],
      refs: [ref],
      relations: [],
      mastery: 0,
      props: {},
      createdAt: ts,
      updatedAt: ts,
    };
    await ctx.store.elements.insert(el);
    index.set(normName(el.name), el);
    created++;
  }
  return msg().job.extracted(draft.elements.length, created, merged);
}

export async function mergeElements(
  ctx: AppContext,
  notebookId: string,
  ids: string[],
  intoId: string,
): Promise<Element> {
  const into = await ctx.store.elements.get(intoId);
  if (!into || into.notebookId !== notebookId) throw notFound("targetElement");
  const others: Element[] = [];
  for (const id of new Set(ids)) {
    if (id === intoId) continue;
    const e = await ctx.store.elements.get(id);
    if (e && e.notebookId === notebookId) others.push(e);
  }
  if (!others.length) return into;
  const mergedIds = new Set(others.map((o) => o.id));
  const aliases = new Set(into.aliases);
  const refs = [...into.refs];
  const relations = [...into.relations];
  let definition = into.definition;
  for (const o of others) {
    if (normName(o.name) !== normName(into.name)) aliases.add(o.name);
    for (const a of o.aliases) aliases.add(a);
    for (const r of o.refs) if (!refs.some((x) => sameRef(x, r))) refs.push(r);
    for (const rel of o.relations) {
      const target = mergedIds.has(rel.targetId) ? intoId : rel.targetId;
      if (target !== intoId && !relations.some((x) => x.targetId === target && x.label === rel.label)) {
        relations.push({ targetId: target, label: rel.label });
      }
    }
    if (!definition.trim() && o.definition.trim()) definition = o.definition;
  }
  aliases.delete(into.name);
  const updated = (await ctx.store.elements.update(intoId, {
    aliases: [...aliases],
    refs,
    relations: relations.filter((r) => !mergedIds.has(r.targetId) && r.targetId !== intoId),
    definition,
  }))!;
  // 复习卡与其他元素的关系改指向合并后的元素。
  for (const o of others) {
    for (const c of await ctx.store.cards.list({ refId: o.id }))
      await ctx.store.cards.update(c.id, { elementId: intoId });
    await ctx.store.elements.delete(o.id);
  }
  for (const e of await ctx.store.elements.list({ notebookId })) {
    if (e.relations.some((r) => mergedIds.has(r.targetId))) {
      const rel = e.relations
        .map((r) => (mergedIds.has(r.targetId) ? { ...r, targetId: intoId } : r))
        .filter((r) => r.targetId !== e.id);
      await ctx.store.elements.update(e.id, { relations: rel });
    }
  }
  await updateElementMastery(ctx, intoId);
  return (await ctx.store.elements.get(intoId)) ?? updated;
}

export async function enrich(ctx: AppContext, id: string): Promise<Element> {
  const el = await ctx.store.elements.get(id);
  if (!el) throw notFound("element");
  const { results } = await retrieve(ctx.store, el.notebookId, [el.name, ...el.aliases].join(" "), {
    k: 6,
    ...(await ctx.models.retrieval()),
  });
  const passages = toPassages(results);
  for (const r of el.refs) {
    if (r.quote && !passages.some((p) => p.text.includes(r.quote)))
      passages.push({ n: passages.length + 1, text: r.quote });
  }
  const draft = await enrichElement(await ctx.models.chat(), {
    name: el.name,
    type: el.type,
    definition: el.definition,
    passages,
  });
  const all = await ctx.store.elements.list({ notebookId: el.notebookId });
  const byName = new Map(all.map((e) => [normName(e.name), e]));
  const relations = [...el.relations];
  for (const name of draft.related) {
    const target = byName.get(normName(name));
    if (target && target.id !== el.id && !relations.some((r) => r.targetId === target.id)) {
      relations.push({ targetId: target.id, label: msg().relatedLabel });
    }
  }
  const aliases = [
    ...new Set([...el.aliases, ...draft.aliases.filter((a) => normName(a) !== normName(el.name))]),
  ];
  return (await ctx.store.elements.update(id, {
    definition: draft.definition || el.definition,
    aliases,
    relations,
  }))!;
}

export async function cardsFromElements(
  ctx: AppContext,
  notebookId: string,
  ids: string[],
): Promise<ReviewCard[]> {
  const inputs = [];
  for (const id of ids) {
    const el = await ctx.store.elements.get(id);
    if (!el || el.notebookId !== notebookId) continue;
    const existing = await ctx.store.cards.list({ refId: id });
    if (existing.length) continue;
    const meta = ELEMENT_TYPE_META[el.type];
    const label = currentLang() === "en" ? meta.labelEn : meta.label;
    const back = el.definition.trim() || el.refs[0]?.quote || el.name;
    inputs.push({ front: msg().elementCardFront(el.name, label), back, elementId: el.id });
  }
  return createCards(ctx, notebookId, inputs);
}

export async function deleteElement(ctx: AppContext, id: string): Promise<boolean> {
  const el = await ctx.store.elements.get(id);
  if (!el) return false;
  for (const e of await ctx.store.elements.list({ notebookId: el.notebookId })) {
    if (e.relations.some((r) => r.targetId === id)) {
      await ctx.store.elements.update(e.id, { relations: e.relations.filter((r) => r.targetId !== id) });
    }
  }
  for (const c of await ctx.store.cards.list({ refId: id }))
    await ctx.store.cards.update(c.id, { elementId: null });
  return ctx.store.elements.delete(id);
}
