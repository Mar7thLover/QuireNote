/** FSRS 间隔重复：建卡、到期、评分，同步更新元素掌握度。 */
import { newId, nowIso, type ReviewCard, type ReviewRating } from "@quirenote/core";
import { type Card, createEmptyCard, fsrs, type Grade, State } from "ts-fsrs";
import type { AppContext } from "../context";
import { notFound } from "../errors";
import type { ReviewCardRecord } from "../store/types";

const scheduler = fsrs({ enable_fuzz: false });

export function publicCard(r: ReviewCardRecord): ReviewCard {
  return {
    id: r.id,
    notebookId: r.notebookId,
    front: r.front,
    back: r.back,
    elementId: r.elementId,
    artifactId: r.artifactId,
    due: r.due,
    stability: r.stability,
    difficulty: r.difficulty,
    reps: r.reps,
    lapses: r.lapses,
    state: r.state,
    lastReview: r.lastReview,
  };
}

function fromFsrs(
  card: Card,
): Pick<
  ReviewCardRecord,
  | "due"
  | "stability"
  | "difficulty"
  | "reps"
  | "lapses"
  | "state"
  | "lastReview"
  | "elapsedDays"
  | "scheduledDays"
  | "learningSteps"
> {
  return {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReview: card.last_review ? card.last_review.toISOString() : null,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
  };
}

function toFsrs(r: ReviewCardRecord): Card {
  return {
    due: new Date(r.due),
    stability: r.stability,
    difficulty: r.difficulty,
    elapsed_days: r.elapsedDays,
    scheduled_days: r.scheduledDays,
    learning_steps: r.learningSteps,
    reps: r.reps,
    lapses: r.lapses,
    state: r.state as State,
    ...(r.lastReview ? { last_review: new Date(r.lastReview) } : {}),
  };
}

export interface NewCardInput {
  front: string;
  back: string;
  elementId?: string | null;
  artifactId?: string | null;
}

export async function createCards(
  ctx: AppContext,
  notebookId: string,
  inputs: NewCardInput[],
  now = new Date(),
): Promise<ReviewCard[]> {
  const out: ReviewCard[] = [];
  for (const c of inputs) {
    const ts = nowIso();
    const rec: ReviewCardRecord = {
      id: newId("card"),
      notebookId,
      front: c.front,
      back: c.back,
      elementId: c.elementId ?? null,
      artifactId: c.artifactId ?? null,
      ...fromFsrs(createEmptyCard(now)),
      createdAt: ts,
      updatedAt: ts,
    };
    await ctx.store.cards.insert(rec);
    out.push(publicCard(rec));
  }
  return out;
}

export async function dueCards(ctx: AppContext, notebookId: string, now = new Date()): Promise<ReviewCard[]> {
  const cards = await ctx.store.cards.list({ notebookId });
  return cards
    .filter((c) => new Date(c.due).getTime() <= now.getTime())
    .sort((a, b) => a.due.localeCompare(b.due))
    .map(publicCard);
}

export async function reviewStats(ctx: AppContext, notebookId: string, now = new Date()) {
  const cards = await ctx.store.cards.list({ notebookId });
  const logs = await ctx.store.reviewLogs.list({ notebookId });
  const due = cards.filter((c) => new Date(c.due).getTime() <= now.getTime()).length;
  const learned = cards.filter((c) => c.state === State.Review).length;
  // 保持率：复习态卡片的评分中「不是 Again」的比例；没有复习态记录时用全部记录。
  const reviewLogs = logs.filter((l) => l.state === State.Review);
  const base = reviewLogs.length ? reviewLogs : logs;
  const retention = base.length ? base.filter((l) => l.rating > 1).length / base.length : 0;
  return { total: cards.length, due, learned, retention: Number(retention.toFixed(4)) };
}

/** 单张卡的掌握度（0–1）：基于稳定性，未学卡为 0，处于重学状态时减半。 */
export function cardMastery(r: Pick<ReviewCardRecord, "state" | "stability">): number {
  if (r.state === State.New) return 0;
  const m = r.stability / (r.stability + 7);
  return Math.max(0, Math.min(1, r.state === State.Relearning ? m / 2 : m));
}

export async function updateElementMastery(ctx: AppContext, elementId: string): Promise<void> {
  const el = await ctx.store.elements.get(elementId);
  if (!el) return;
  const cards = await ctx.store.cards.list({ refId: elementId });
  const mastery = cards.length ? cards.reduce((s, c) => s + cardMastery(c), 0) / cards.length : 0;
  await ctx.store.elements.update(elementId, { mastery: Number(mastery.toFixed(4)) });
}

export async function reviewCard(
  ctx: AppContext,
  cardId: string,
  rating: ReviewRating,
  now = new Date(),
): Promise<ReviewCard> {
  const rec = await ctx.store.cards.get(cardId);
  if (!rec) throw notFound("复习卡");
  const { card } = scheduler.next(toFsrs(rec), now, rating as Grade);
  const ts = nowIso();
  await ctx.store.reviewLogs.insert({
    id: newId("rlog"),
    cardId,
    notebookId: rec.notebookId,
    rating,
    state: rec.state,
    reviewedAt: now.toISOString(),
    createdAt: ts,
    updatedAt: ts,
  });
  const updated = (await ctx.store.cards.update(cardId, fromFsrs(card)))!;
  if (updated.elementId) await updateElementMastery(ctx, updated.elementId);
  return publicCard(updated);
}
