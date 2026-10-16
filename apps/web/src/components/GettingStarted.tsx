import type { Notebook } from "@quirenote/core";
import { Button } from "@quirenote/ui";
import { Link, useNavigate } from "@tanstack/react-router";
import { Check, FilePlus2, MessageSquareQuote, PlugZap, X } from "lucide-react";
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

/** 首页「开始使用」：连接模型 → 导入资料 → 提问，三张卡片。全部完成或关闭后不再显示。 */
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
      icon: PlugZap,
      done: hasModel,
      title: t("onboarding.step1"),
      desc: t("onboarding.step1Desc"),
      action: (
        <Button size="sm" asChild>
          <Link to="/settings/$section" params={{ section: "models" }}>
            {t("onboarding.step1Action")}
          </Link>
        </Button>
      ),
    },
    {
      icon: FilePlus2,
      done: !!withSources,
      title: t("onboarding.step2"),
      desc: t("onboarding.step2Desc"),
      action: (
        <Button size="sm" onClick={() => useUi.getState().set({ newNotebookOpen: true })}>
          {t("onboarding.step2Action")}
        </Button>
      ),
    },
    {
      icon: MessageSquareQuote,
      done: asked,
      title: t("onboarding.step3"),
      desc: t("onboarding.step3Desc"),
      action: withSources ? (
        <Button
          size="sm"
          onClick={() => navigate({ to: "/n/$notebookId", params: { notebookId: withSources.id } })}
        >
          {t("onboarding.step3Action")}
        </Button>
      ) : null,
    },
  ];
  if (steps.every((s) => s.done)) return null;

  return (
    <section aria-label={t("onboarding.title")} className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <h2 className="text-[17px] font-semibold">{t("onboarding.title")}</h2>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => {
            try {
              localStorage.setItem(DISMISS_KEY, "1");
            } catch {}
            setDismissed(true);
          }}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[13px] text-fg-subtle hover:bg-surface-hover hover:text-fg focus-ring"
        >
          <X className="size-3.5" />
          {t("onboarding.dismiss")}
        </button>
      </div>
      <ol className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {steps.map((s) => (
          <li key={s.title} className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center gap-2.5">
              <s.icon className="size-[18px] shrink-0 text-fg-muted" strokeWidth={1.6} />
              <span className="text-[15px] font-medium">{s.title}</span>
            </div>
            <p className="flex-1 text-[13.5px] leading-relaxed text-fg-subtle">{s.desc}</p>
            {s.done ? (
              <span className="inline-flex h-7 items-center gap-1.5 text-[13px] text-success">
                <Check className="size-4" strokeWidth={2} />
                {t("onboarding.done")}
              </span>
            ) : (
              <div>{s.action}</div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
