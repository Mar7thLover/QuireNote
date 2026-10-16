import type { Notebook } from "@quirenote/core";
import { Button, cn } from "@quirenote/ui";
import { Link, useNavigate } from "@tanstack/react-router";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "@/i18n";
import { useAssignments } from "@/lib/models";
import { useUi } from "@/stores/ui";

const DISMISS_KEY = "quirenote.onboardingDismissed";
/** 第一次在对话里成功提问后由 ChatPanel 写入。 */
export const ASKED_KEY = "quirenote.askedOnce";

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function markAsked(): void {
  try {
    localStorage.setItem(ASKED_KEY, "1");
  } catch {}
}

/** 首页的上手引导：连接模型 → 导入资料 → 提问。全部完成或用户关闭后不再显示。 */
export function GettingStarted({ notebooks }: { notebooks: Notebook[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const assignments = useAssignments();
  const [dismissed, setDismissed] = useState(() => readFlag(DISMISS_KEY));
  if (dismissed || !assignments.data) return null;

  const hasModel = assignments.data.some((a) => a.capability === "chat");
  const withSources = notebooks.find((n) => (n.stats?.sources ?? 0) > 0);
  const asked = readFlag(ASKED_KEY);
  const steps = [
    {
      done: hasModel,
      title: t("onboarding.step1"),
      desc: t("onboarding.step1Desc"),
      action: (
        <Button size="sm" variant={hasModel ? "ghost" : "primary"} asChild>
          <Link to="/settings/$section" params={{ section: "models" }}>
            {t("onboarding.step1Action")}
          </Link>
        </Button>
      ),
    },
    {
      done: !!withSources,
      title: t("onboarding.step2"),
      desc: t("onboarding.step2Desc"),
      action: (
        <Button
          size="sm"
          variant={hasModel && !withSources ? "primary" : "ghost"}
          onClick={() => useUi.getState().set({ newNotebookOpen: true })}
        >
          {t("onboarding.step2Action")}
        </Button>
      ),
    },
    {
      done: asked,
      title: t("onboarding.step3"),
      desc: t("onboarding.step3Desc"),
      action: withSources ? (
        <Button
          size="sm"
          variant={hasModel && !asked ? "primary" : "ghost"}
          onClick={() => navigate({ to: "/n/$notebookId", params: { notebookId: withSources.id } })}
        >
          {t("onboarding.step3Action")}
        </Button>
      ) : null,
    },
  ];
  if (steps.every((s) => s.done)) return null;

  return (
    <section
      aria-label={t("onboarding.title")}
      className="relative mt-8 rounded-2xl border border-accent/30 bg-accent-soft/40 p-5 sm:p-6"
    >
      <button
        type="button"
        onClick={() => {
          try {
            localStorage.setItem(DISMISS_KEY, "1");
          } catch {}
          setDismissed(true);
        }}
        className="absolute top-3 right-3 flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-fg-subtle hover:bg-surface-hover hover:text-fg focus-ring"
      >
        <X className="size-3.5" />
        {t("onboarding.dismiss")}
      </button>
      <h2 className="text-[17px] font-semibold tracking-tight">{t("onboarding.title")}</h2>
      <p className="mt-1 text-[13.5px] text-fg-muted">{t("onboarding.desc")}</p>
      <ol className="mt-4 grid gap-3 md:grid-cols-3">
        {steps.map((s, i) => (
          <li
            key={s.title}
            className={cn(
              "flex flex-col gap-2 rounded-xl border bg-surface p-4",
              s.done ? "border-border opacity-75" : "border-border-strong",
            )}
          >
            <div className="flex items-center gap-2.5">
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold",
                  s.done ? "bg-success text-white" : "bg-accent text-accent-fg",
                )}
              >
                {s.done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
              </span>
              <span className="text-[14px] font-medium">{s.title}</span>
              {s.done ? <span className="ml-auto text-xs text-success">{t("onboarding.done")}</span> : null}
            </div>
            <p className="flex-1 text-[12.5px] leading-relaxed text-fg-muted">{s.desc}</p>
            {s.done ? null : <div>{s.action}</div>}
          </li>
        ))}
      </ol>
    </section>
  );
}
