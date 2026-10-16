import type { ReviewCard } from "@quirenote/core";
import { Button, cn, EmptyState, Shortcut, Skeleton } from "@quirenote/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PartyPopper } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { PanelShell, PanelTitle } from "@/components/Panel";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api";
import { qk, queryClient } from "@/lib/query";

const RATINGS = [
  { r: 1, key: "again", hue: 25 },
  { r: 2, key: "hard", hue: 65 },
  { r: 3, key: "good", hue: 150 },
  { r: 4, key: "easy", hue: 230 },
] as const;

/** 间隔重复复习（FSRS）：评分后服务端计算下次复习时间，并回写关联元素的掌握度。 */
export function ReviewPanel({ notebookId }: { notebookId: string }) {
  const { t } = useTranslation();
  const due = useQuery({ queryKey: qk.review(notebookId), queryFn: () => api.review.due(notebookId) });
  const stats = useQuery({
    queryKey: qk.reviewStats(notebookId),
    queryFn: () => api.review.stats(notebookId),
  });
  const [queue, setQueue] = useState<ReviewCard[]>([]);
  const [done, setDone] = useState(0);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (due.data) {
      setQueue(due.data);
      setDone(0);
    }
  }, [due.data]);

  const card = queue[0];
  const rate = useMutation({
    mutationFn: (rating: 1 | 2 | 3 | 4) => api.review.rate(card!.id, rating),
    onMutate: (rating) => {
      // 乐观推进：评"重来"的卡片放回队尾
      setQueue((q) => (rating === 1 ? [...q.slice(1), q[0]!] : q.slice(1)));
      if (rating !== 1) setDone((d) => d + 1);
      setShow(false);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.reviewStats(notebookId) });
      queryClient.invalidateQueries({ queryKey: qk.elements(notebookId) });
    },
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (!card || el.isContentEditable || ["INPUT", "TEXTAREA"].includes(el.tagName)) return;
      if (e.key === " " && !show) {
        e.preventDefault();
        setShow(true);
      } else if (show && ["1", "2", "3", "4"].includes(e.key)) rate.mutate(Number(e.key) as 1 | 2 | 3 | 4);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, show, rate]);

  const total = done + queue.length;
  return (
    <PanelShell
      toolbar={
        <>
          <PanelTitle>{t("review.title")}</PanelTitle>
          <span className="flex-1" />
          {stats.data ? (
            <span className="text-xs text-fg-subtle">
              {t("review.stats", { total: stats.data.total, learned: stats.data.learned })}
            </span>
          ) : null}
        </>
      }
    >
      <div className="flex h-full flex-col items-center overflow-y-auto px-6 py-8">
        {due.isLoading ? (
          <Skeleton className="h-64 w-full max-w-xl rounded-2xl" />
        ) : !card ? (
          <EmptyState
            className="my-auto"
            icon={<PartyPopper />}
            title={t("review.nothingDue")}
            description={t("review.nothingDueDesc")}
          />
        ) : (
          <>
            <div className="mb-5 w-full max-w-xl">
              <div className="flex items-center justify-between text-xs text-fg-subtle">
                <span>{t("review.due", { count: queue.length })}</span>
                <span className="tabular-nums">{t("review.progress", { done, total })}</span>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-sunken">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-500"
                  style={{ width: `${total ? (done / total) * 100 : 0}%` }}
                />
              </div>
            </div>
            <AnimatePresence mode="wait">
              <motion.div
                key={card.id + queue.length}
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: -40 }}
                transition={{ duration: 0.22 }}
                className="w-full max-w-xl rounded-2xl border border-border bg-surface p-7 shadow-md"
              >
                <p className="text-balance text-center text-[19px] leading-snug font-semibold">
                  {card.front}
                </p>
                {show ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="mt-6 border-t border-dashed border-border pt-5"
                  >
                    <Markdown text={card.back} serif className="text-center" />
                  </motion.div>
                ) : null}
              </motion.div>
            </AnimatePresence>
            <div className="mt-6 flex w-full max-w-xl justify-center gap-2">
              {show ? (
                RATINGS.map((x) => (
                  <button
                    key={x.r}
                    type="button"
                    onClick={() => rate.mutate(x.r)}
                    className={cn(
                      "flex flex-1 flex-col items-center gap-1 rounded-xl border py-2.5 text-[13px] font-medium transition-colors focus-ring",
                    )}
                    style={{
                      borderColor: `oklch(0.7 0.13 ${x.hue} / 0.5)`,
                      background: `color-mix(in srgb, oklch(0.75 0.13 ${x.hue}) 12%, var(--surface))`,
                      color: `oklch(0.5 0.14 ${x.hue})`,
                    }}
                  >
                    {t(`review.${x.key}`)}
                    <span className="text-[10px] opacity-60">{x.r}</span>
                  </button>
                ))
              ) : (
                <Button size="lg" variant="primary" className="min-w-48" onClick={() => setShow(true)}>
                  {t("review.show")}
                  <Shortcut
                    keys="Space"
                    className="ml-1 [&_kbd]:border-accent-fg/30 [&_kbd]:bg-transparent [&_kbd]:text-accent-fg/80"
                  />
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </PanelShell>
  );
}
