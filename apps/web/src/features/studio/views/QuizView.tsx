import { newId } from "@folio/core";
import { Button, cn, toast } from "@folio/ui";
import { useMutation } from "@tanstack/react-query";
import { Check, CircleCheck, CircleX, PencilLine, Play, Plus, Repeat, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api";
import { qk, queryClient } from "@/lib/query";
import type { ArtifactViewProps } from "../ArtifactPanel";

export function QuizView({ artifact, data, onChange, notebookId }: ArtifactViewProps<"quiz">) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"take" | "edit">("take");
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const qs = data.questions;
  const score = qs.filter((q) => answers[q.id] === q.answer).length;

  const toReview = useMutation({
    mutationFn: () =>
      api.review.addCards(
        notebookId,
        // 答错的题优先进入复习；全部答对时加入全部
        (submitted && score < qs.length ? qs.filter((q) => answers[q.id] !== q.answer) : qs).map((q) => ({
          front: q.question,
          back: `${q.options[q.answer]}${q.explanation ? `\n\n${q.explanation}` : ""}`,
          artifactId: artifact.id,
        })),
      ),
    onSuccess: (r) => {
      toast.success(t("studio.addedToReview", { count: r.length }));
      queryClient.invalidateQueries({ queryKey: qk.review(notebookId) });
    },
  });

  const setQ = (id: string, patch: Partial<(typeof qs)[number]>) =>
    onChange({ kind: "quiz", questions: qs.map((q) => (q.id === id ? { ...q, ...patch } : q)) });

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-6">
      <div className="mb-5 flex items-center gap-2">
        <div className="inline-flex rounded-lg bg-surface-sunken p-0.5">
          <Button size="xs" variant={mode === "take" ? "secondary" : "ghost"} onClick={() => setMode("take")}>
            <Play />
            {t("studio.startQuiz")}
          </Button>
          <Button size="xs" variant={mode === "edit" ? "secondary" : "ghost"} onClick={() => setMode("edit")}>
            <PencilLine />
            {t("common.edit")}
          </Button>
        </div>
        <span className="flex-1" />
        {submitted ? (
          <span className={cn("text-sm font-semibold", score === qs.length ? "text-success" : "text-fg")}>
            {t("studio.score", { score, total: qs.length })}
          </span>
        ) : null}
        <Button size="sm" variant="soft" onClick={() => toReview.mutate()} loading={toReview.isPending}>
          <Repeat />
          {t("studio.addToReview")}
        </Button>
      </div>

      <ol className="space-y-5">
        {qs.map((q, qi) => (
          <li key={q.id} className="rounded-xl border border-border bg-surface p-4 shadow-sm">
            {mode === "edit" ? (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <span className="pt-1 text-sm font-semibold text-fg-subtle">{qi + 1}.</span>
                  <textarea
                    defaultValue={q.question}
                    onBlur={(e) => setQ(q.id, { question: e.target.value })}
                    rows={2}
                    className="flex-1 resize-none bg-transparent text-[15px] font-semibold outline-none"
                  />
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => onChange({ kind: "quiz", questions: qs.filter((x) => x.id !== q.id) })}
                    aria-label="delete"
                  >
                    <Trash2 />
                  </Button>
                </div>
                {q.options.map((o, oi) => (
                  <label key={oi} className="flex items-center gap-2 pl-5">
                    <input
                      type="radio"
                      name={`ans-${q.id}`}
                      checked={q.answer === oi}
                      onChange={() => setQ(q.id, { answer: oi })}
                      className="accent-[var(--accent)]"
                    />
                    <input
                      defaultValue={o}
                      onBlur={(e) =>
                        setQ(q.id, { options: q.options.map((x, k) => (k === oi ? e.target.value : x)) })
                      }
                      className="h-8 flex-1 rounded-md bg-surface-sunken px-2 text-[13.5px] outline-none"
                    />
                  </label>
                ))}
                <textarea
                  defaultValue={q.explanation}
                  onBlur={(e) => setQ(q.id, { explanation: e.target.value })}
                  placeholder="解析"
                  rows={2}
                  className="ml-5 block w-[calc(100%-1.25rem)] resize-none rounded-md bg-surface-sunken p-2 text-[13px] text-fg-muted outline-none"
                />
              </div>
            ) : (
              <>
                <p className="mb-3 text-[15px] font-semibold leading-snug">
                  <span className="mr-1.5 text-fg-subtle">{qi + 1}.</span>
                  {q.question}
                </p>
                <div className="grid gap-1.5">
                  {q.options.map((o, oi) => {
                    const chosen = answers[q.id] === oi;
                    const correct = q.answer === oi;
                    return (
                      <button
                        key={oi}
                        type="button"
                        disabled={submitted}
                        onClick={() => setAnswers({ ...answers, [q.id]: oi })}
                        className={cn(
                          "flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-[14px] transition-colors focus-ring",
                          !submitted &&
                            (chosen
                              ? "border-accent bg-accent-soft"
                              : "border-border hover:bg-surface-hover"),
                          submitted && correct && "border-success/60 bg-success-soft",
                          submitted && chosen && !correct && "border-danger/60 bg-danger-soft",
                          submitted && !chosen && !correct && "border-border opacity-60",
                        )}
                      >
                        <span className="grid size-5 shrink-0 place-items-center rounded-full border border-current text-[11px] font-semibold opacity-70">
                          {submitted && correct ? <Check className="size-3" /> : String.fromCharCode(65 + oi)}
                        </span>
                        {o}
                      </button>
                    );
                  })}
                </div>
                {submitted ? (
                  <div className="mt-3 flex gap-2 rounded-lg bg-surface-sunken p-3 text-[13px] leading-relaxed text-fg-muted animate-fade">
                    {answers[q.id] === q.answer ? (
                      <CircleCheck className="size-4 shrink-0 text-success" />
                    ) : (
                      <CircleX className="size-4 shrink-0 text-danger" />
                    )}
                    <span>{q.explanation || `正确答案：${q.options[q.answer]}`}</span>
                  </div>
                ) : null}
              </>
            )}
          </li>
        ))}
      </ol>
      <div className="mt-5 flex justify-center gap-2">
        {mode === "edit" ? (
          <Button
            variant="secondary"
            onClick={() =>
              onChange({
                kind: "quiz",
                questions: [
                  ...qs,
                  {
                    id: newId("q"),
                    question: "新题目",
                    options: ["选项 A", "选项 B", "选项 C", "选项 D"],
                    answer: 0,
                    explanation: "",
                  },
                ],
              })
            }
          >
            <Plus />
            添加题目
          </Button>
        ) : submitted ? (
          <Button
            variant="secondary"
            onClick={() => {
              setAnswers({});
              setSubmitted(false);
            }}
          >
            <RotateCcw />
            再做一次
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={Object.keys(answers).length < qs.length}
            onClick={() => setSubmitted(true)}
          >
            提交答案
          </Button>
        )}
      </div>
    </div>
  );
}
