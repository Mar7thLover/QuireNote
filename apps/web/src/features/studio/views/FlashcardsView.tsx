import { newId } from "@quirenote/core";
import { Button, cn, toast } from "@quirenote/ui";
import { useMutation } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  GalleryHorizontal,
  LayoutGrid,
  Plus,
  Repeat,
  RotateCw,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api";
import { qk, queryClient } from "@/lib/query";
import type { ArtifactViewProps } from "../ArtifactPanel";

export function FlashcardsView({ artifact, data, onChange, notebookId }: ArtifactViewProps<"flashcards">) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"study" | "edit">("study");
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const cards = data.cards;
  const card = cards[Math.min(i, cards.length - 1)];

  const toReview = useMutation({
    mutationFn: () =>
      api.review.addCards(
        notebookId,
        cards.map((c) => ({ front: c.front, back: c.back, elementId: c.elementId, artifactId: artifact.id })),
      ),
    onSuccess: (r) => {
      toast.success(t("studio.addedToReview", { count: r.length }));
      queryClient.invalidateQueries({ queryKey: qk.review(notebookId) });
      queryClient.invalidateQueries({ queryKey: qk.reviewStats(notebookId) });
    },
  });

  const update = (id: string, patch: { front?: string; back?: string }) =>
    onChange({ kind: "flashcards", cards: cards.map((c) => (c.id === id ? { ...c, ...patch } : c)) });

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-6">
      <div className="mb-5 flex items-center gap-2">
        <div className="inline-flex rounded-lg bg-surface-sunken p-0.5">
          <Button
            size="xs"
            variant={mode === "study" ? "secondary" : "ghost"}
            onClick={() => setMode("study")}
          >
            <GalleryHorizontal />
            学习
          </Button>
          <Button size="xs" variant={mode === "edit" ? "secondary" : "ghost"} onClick={() => setMode("edit")}>
            <LayoutGrid />
            {t("common.edit")}
          </Button>
        </div>
        <span className="text-xs text-fg-subtle">{cards.length} 张</span>
        <span className="flex-1" />
        <Button size="sm" variant="soft" onClick={() => toReview.mutate()} loading={toReview.isPending}>
          <Repeat />
          {t("studio.addToReview")}
        </Button>
      </div>

      {mode === "study" && card ? (
        <div className="flex flex-col items-center">
          <button
            type="button"
            onClick={() => setFlipped((f) => !f)}
            className="group relative h-72 w-full max-w-xl [perspective:1400px] focus-ring rounded-2xl"
            aria-label="flip"
          >
            <div
              className="relative size-full transition-transform duration-500 ease-[var(--ease-out)] [transform-style:preserve-3d]"
              style={{ transform: flipped ? "rotateY(180deg)" : "none" }}
            >
              <Face className="bg-surface">
                <span className="mb-3 text-[11px] font-semibold tracking-widest text-fg-subtle">问题</span>
                <p className="text-balance text-[20px] leading-snug font-semibold">{card.front}</p>
              </Face>
              <Face className="bg-surface-sunken [transform:rotateY(180deg)]">
                <span className="mb-3 text-[11px] font-semibold tracking-widest text-accent-soft-fg">
                  答案
                </span>
                <p className="text-balance font-serif text-[17px] leading-relaxed">{card.back}</p>
              </Face>
            </div>
          </button>
          <div className="mt-5 flex items-center gap-3">
            <Button
              size="icon"
              variant="secondary"
              disabled={i === 0}
              onClick={() => {
                setI(i - 1);
                setFlipped(false);
              }}
              aria-label="prev"
            >
              <ChevronLeft />
            </Button>
            <span className="w-16 text-center text-sm tabular-nums text-fg-muted">
              {i + 1} / {cards.length}
            </span>
            <Button
              size="icon"
              variant="secondary"
              disabled={i >= cards.length - 1}
              onClick={() => {
                setI(i + 1);
                setFlipped(false);
              }}
              aria-label="next"
            >
              <ChevronRight />
            </Button>
            <Button size="icon" variant="ghost" onClick={() => setFlipped((f) => !f)} aria-label="flip">
              <RotateCw />
            </Button>
          </div>
          <div className="mt-4 flex gap-1">
            {cards.map((c, j) => (
              <span
                key={c.id}
                className={cn("h-1 w-4 rounded-full transition-colors", j === i ? "bg-accent" : "bg-border")}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {cards.map((c, j) => (
            <div
              key={c.id}
              className="group relative rounded-xl border border-border bg-surface p-3 shadow-sm"
            >
              <span className="absolute top-2 right-2 flex gap-0.5 opacity-0 group-hover:opacity-100">
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => onChange({ kind: "flashcards", cards: cards.filter((x) => x.id !== c.id) })}
                  aria-label="delete"
                >
                  <Trash2 />
                </Button>
              </span>
              <span className="text-[11px] font-medium text-fg-subtle">#{j + 1}</span>
              <textarea
                defaultValue={c.front}
                onBlur={(e) => e.target.value !== c.front && update(c.id, { front: e.target.value })}
                className="mt-1 block w-full resize-none bg-transparent text-[14px] font-semibold outline-none"
                rows={2}
              />
              <div className="my-2 h-px bg-border" />
              <textarea
                defaultValue={c.back}
                onBlur={(e) => e.target.value !== c.back && update(c.id, { back: e.target.value })}
                className="block w-full resize-none bg-transparent text-[13px] text-fg-muted outline-none"
                rows={3}
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              onChange({
                kind: "flashcards",
                cards: [...cards, { id: newId("fc"), front: "新问题", back: "答案", elementId: null }],
              })
            }
            className="grid min-h-36 place-items-center rounded-xl border border-dashed border-border-strong text-fg-subtle hover:border-accent hover:text-accent"
          >
            <Plus className="size-5" />
          </button>
        </div>
      )}
    </div>
  );
}

function Face({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "absolute inset-0 flex flex-col items-center justify-center rounded-2xl border border-border p-8 text-center shadow-md [backface-visibility:hidden]",
        className,
      )}
    >
      {children}
    </div>
  );
}
