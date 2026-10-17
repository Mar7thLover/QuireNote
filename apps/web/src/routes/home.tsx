import type { Notebook } from "@quirenote/core";
import {
  Button,
  cn,
  EmptyState,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  Tooltip,
  toast,
} from "@quirenote/ui";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowDownRight,
  ArrowUpRight,
  BookOpen,
  BookOpenText,
  Compass,
  Feather,
  Landmark,
  Leaf,
  Lightbulb,
  type LucideIcon,
  NotebookPen,
  PenLine,
  Plus,
  Quote,
  Shapes,
  Sprout,
  Telescope,
  Upload,
} from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { AppShell } from "@/components/AppSidebar";
import { hasAsked } from "@/components/GettingStarted";
import { BudgetRing, UsageBars } from "@/components/home/UsageBars";
import { NotebookCard } from "@/components/NotebookCard";
import { manualSections } from "@/features/manual/content";
import { currentLang, useTranslation } from "@/i18n";
import { api, type RecentNote, type UsageSummary } from "@/lib/api";
import { formatNumber, formatTokens, formatUsd, greetingKey, relativeTime } from "@/lib/format";
import { describeModel, useAssignments, useProviders } from "@/lib/models";
import { qk, queryClient, upsertInList } from "@/lib/query";
import { TINTS, type Tint, tintBg, tintFor, tintInk } from "@/lib/tints";
import { useUi } from "@/stores/ui";

/**
 * 首页，参照 Claude Console 的仪表盘：问候与主操作；三张概览卡（对话模型、本月花费、写作）；
 * Token 用量与待复习；最近打开的笔记；Notebook；使用手册。只放真实、可行动的数据。
 */
export function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const openNew = () => useUi.getState().set({ newNotebookOpen: true });
  const fileRef = useRef<HTMLInputElement>(null);
  const notebooks = useQuery({ queryKey: qk.notebooks, queryFn: api.notebooks.list });
  const overview = useQuery({ queryKey: qk.overview, queryFn: api.overview });
  const usage = useQuery({ queryKey: qk.usage, queryFn: api.usage });

  const importNb = useMutation({
    mutationFn: api.notebooks.import,
    onSuccess: (nb) => {
      upsertInList(qk.notebooks, nb);
      navigate({ to: "/n/$notebookId", params: { notebookId: nb.id } });
    },
  });

  const list = useMemo(
    () =>
      [...(notebooks.data ?? [])].sort(
        (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt),
      ),
    [notebooks.data],
  );

  return (
    <AppShell>
      <div className="md:hidden">
        <AppHeader />
      </div>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-10 px-5 pt-8 pb-14 sm:px-10 sm:pt-12">
          <header className="flex flex-wrap items-center gap-2.5">
            <h1 className="mr-auto font-serif text-[30px] leading-tight font-normal">
              {t(`home.${greetingKey()}`)}
            </h1>
            <Tooltip content={t("manual.title")}>
              <Button
                size="lg"
                className="w-9 px-0"
                aria-label={t("manual.title")}
                onClick={() => useUi.getState().set({ manual: "start" })}
              >
                <BookOpen />
              </Button>
            </Tooltip>
            <Button size="lg" onClick={() => fileRef.current?.click()} loading={importNb.isPending}>
              <Upload />
              {t("home.importNotebook")}
            </Button>
            <Button size="lg" variant="primary" onClick={openNew}>
              <Plus />
              {t("home.newNotebook")}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".zip"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importNb.mutate(f);
                e.target.value = "";
              }}
            />
          </header>

          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <ModelCard />
              <SpendCard usage={usage.data} loading={usage.isLoading} />
              <WritingCard writing={overview.data?.writing} loading={overview.isLoading} />
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <TokenCard usage={usage.data} loading={usage.isLoading} className="md:col-span-2" />
              {notebooks.data ? (
                <ReviewCard notebooks={notebooks.data} />
              ) : (
                <Skeleton className="h-36 rounded-xl" />
              )}
            </div>
          </div>

          {overview.data?.recent.length ? <RecentNotes notes={overview.data.recent} /> : null}

          <section className="flex flex-col gap-3">
            <h2 className="text-[17px] font-semibold">{t("home.notebooks")}</h2>
            {notebooks.isLoading ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-44 rounded-xl" />
                ))}
              </div>
            ) : list.length === 0 ? (
              <EmptyState
                className="rounded-xl border border-border bg-surface"
                icon={<NotebookPen />}
                title={t("home.empty")}
                description={t("home.emptyDesc")}
                action={
                  <Button variant="primary" onClick={openNew}>
                    <Plus />
                    {t("home.newNotebook")}
                  </Button>
                }
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((n) => (
                  <NotebookCard key={n.id} nb={n} />
                ))}
              </div>
            )}
          </section>

          <ManualTips notebooks={notebooks.data ?? []} />

          <footer className="flex flex-wrap justify-center gap-x-5 gap-y-2 pt-2 text-[13px] text-fg-subtle">
            <FooterButton onClick={() => useUi.getState().set({ manual: "start" })}>
              {t("manual.title")}
            </FooterButton>
            <FooterButton onClick={() => useUi.getState().set({ shortcutsOpen: true })}>
              {t("home.shortcuts")}
            </FooterButton>
            <Link
              to="/settings/$section"
              params={{ section: "data" }}
              className="underline decoration-border-strong underline-offset-4 hover:text-fg"
            >
              {t("home.backup")}
            </Link>
            <Link
              to="/settings/$section"
              params={{ section: "about" }}
              className="underline decoration-border-strong underline-offset-4 hover:text-fg"
            >
              {t("home.about")}
            </Link>
          </footer>
        </div>
      </main>
    </AppShell>
  );
}

function FooterButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="underline decoration-border-strong underline-offset-4 hover:text-fg"
    >
      {children}
    </button>
  );
}

// ───────────── 概览卡 ─────────────

function Card({
  label,
  pill,
  children,
  className,
}: {
  label: string;
  pill?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[140px] flex-col gap-2 rounded-xl border border-border bg-surface p-5",
        className,
      )}
    >
      <div className="flex min-h-6 items-center gap-2">
        <span className="text-[14.5px] text-fg-muted">{label}</span>
        <span className="flex-1" />
        {pill}
      </div>
      {children}
    </div>
  );
}

function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warning" }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-md px-2 text-[12.5px] tabular-nums",
        tone === "warning" ? "bg-warning-soft text-warning" : "bg-surface-sunken text-fg-muted",
      )}
    >
      {children}
    </span>
  );
}

const big = "text-[30px] leading-none font-semibold tracking-tight tabular-nums";
const sub = "text-[13.5px] text-fg-subtle";

function ModelCard() {
  const { t } = useTranslation();
  const assignments = useAssignments();
  const providers = useProviders();
  const chat = assignments.data?.find((a) => a.capability === "chat");
  const model = chat ? describeModel(providers.data, chat) : null;
  return (
    <Card
      label={t("home.chatModel")}
      pill={
        model ? (
          <Button size="sm" asChild className="-my-1">
            <Link to="/settings/$section" params={{ section: "models" }}>
              {t("home.change")}
            </Link>
          </Button>
        ) : null
      }
    >
      {assignments.isLoading ? (
        <Skeleton className="h-8 w-40" />
      ) : model ? (
        <>
          <span
            className="truncate text-[24px] leading-tight font-semibold tracking-tight"
            title={model.model}
          >
            {model.model}
          </span>
          <span className={cn(sub, "mt-auto truncate")}>{model.provider}</span>
        </>
      ) : (
        <>
          <div className="flex items-start gap-3">
            <span className="flex-1 text-[22px] font-semibold tracking-tight text-fg-subtle">
              {t("home.noModel")}
            </span>
            <Button size="sm" variant="primary" asChild>
              <Link to="/settings/$section" params={{ section: "models" }}>
                {t("home.setUp")}
              </Link>
            </Button>
          </div>
          <span className={cn(sub, "mt-auto")}>{t("home.noModelHint")}</span>
        </>
      )}
    </Card>
  );
}

/** 下个月 1 日（预算重置日）。 */
function resetDay(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).toLocaleDateString(
    currentLang() === "zh" ? "zh-CN" : "en",
    { month: "short", day: "numeric" },
  );
}

function SpendCard({ usage, loading }: { usage?: UsageSummary; loading: boolean }) {
  const { t } = useTranslation();
  const budget = usage?.budget ?? null;
  const cost = usage?.month.cost ?? 0;
  const ratio = budget ? cost / budget : 0;
  return (
    <Card
      label={t("home.spend")}
      pill={
        budget ? (
          <Pill tone={ratio >= 0.9 ? "warning" : "neutral"}>
            {t("home.budgetUsed", { pct: Math.round(ratio * 100) })}
          </Pill>
        ) : null
      }
    >
      {loading ? (
        <Skeleton className="h-8 w-28" />
      ) : (
        <div className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <span className={big}>{formatUsd(cost)}</span>
            <BudgetEditor budget={budget} />
          </div>
          {budget ? <BudgetRing ratio={ratio} /> : null}
        </div>
      )}
      {usage && usage.month.unpricedTokens > 0 ? (
        <span className={cn(sub, "mt-auto")}>
          {t("home.unpriced", { tokens: formatTokens(usage.month.unpricedTokens) })}
        </span>
      ) : null}
    </Card>
  );
}

function BudgetEditor({ budget }: { budget: number | null }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const save = useMutation({
    mutationFn: (monthlyUsd: number | null) => api.settings.put("aiBudget", { monthlyUsd }),
    onSuccess: () => {
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: qk.usage });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const submit = () => {
    const n = Number(value);
    if (value.trim() === "") return save.mutate(null);
    if (!Number.isFinite(n) || n < 0) return toast.error(t("home.budgetInvalid"));
    save.mutate(n);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setValue(budget ? String(budget) : "");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            sub,
            "w-fit rounded text-left underline decoration-border-strong underline-offset-4 hover:text-fg focus-ring",
          )}
        >
          {budget ? t("home.budgetOf", { budget: formatUsd(budget), date: resetDay() }) : t("home.setBudget")}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-medium">{t("home.budgetTitle")}</span>
            <span className="text-[12.5px] leading-relaxed text-fg-subtle">{t("home.budgetDesc")}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-fg-muted">$</span>
            <Input
              autoFocus
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="20"
              aria-label={t("home.budgetTitle")}
            />
          </div>
          <div className="flex justify-end gap-2">
            {budget ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => save.mutate(null)}>
                {t("home.budgetClear")}
              </Button>
            ) : null}
            <Button type="submit" variant="primary" size="sm" loading={save.isPending}>
              {t("common.save")}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function WritingCard({
  writing,
  loading,
}: {
  writing?: { words: number; notes: number; editedThisWeek: number; wordsThisWeek: number };
  loading: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Card
      label={t("home.writing")}
      pill={
        writing?.wordsThisWeek ? (
          <Pill>{t("home.wordsThisWeek", { words: formatNumber(writing.wordsThisWeek) })}</Pill>
        ) : null
      }
    >
      {loading || !writing ? (
        <Skeleton className="h-8 w-28" />
      ) : (
        <>
          <span className={big}>{t("home.words", { words: formatNumber(writing.words) })}</span>
          <span className={cn(sub, "mt-auto")}>
            {t("home.writingHint", { notes: writing.notes, edited: writing.editedThisWeek })}
          </span>
        </>
      )}
    </Card>
  );
}

function TokenCard({
  usage,
  loading,
  className,
}: {
  usage?: UsageSummary;
  loading: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const week = usage?.week;
  const total = week ? week.inputTokens + week.outputTokens : 0;
  const prev = usage ? usage.prevWeek.inputTokens + usage.prevWeek.outputTokens : 0;
  const change = prev > 0 ? (total - prev) / prev : null;
  const hit = week && week.inputTokens > 0 ? week.cacheReadTokens / week.inputTokens : null;
  return (
    <Card
      label={t("home.tokens")}
      className={className}
      pill={
        change !== null ? (
          <Pill>
            {change >= 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
            {t("home.vsPrevWeek", { pct: Math.abs(Math.round(change * 100)) })}
          </Pill>
        ) : null
      }
    >
      {loading || !usage ? (
        <Skeleton className="h-8 w-28" />
      ) : (
        <div className="flex flex-1 flex-wrap items-end gap-x-8 gap-y-4">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <span className={big}>{formatTokens(total)}</span>
            <span className={sub}>{t("home.last7Days")}</span>
            <dl className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px]">
              <Stat label={t("home.input")} value={formatTokens(week!.inputTokens)} />
              <Stat label={t("home.output")} value={formatTokens(week!.outputTokens)} />
              {hit !== null ? <Stat label={t("home.cacheHit")} value={`${Math.round(hit * 100)}%`} /> : null}
              {week!.searches ? <Stat label={t("home.searches")} value={String(week!.searches)} /> : null}
            </dl>
          </div>
          {total || prev ? (
            <UsageBars daily={usage.daily} />
          ) : (
            <p className="max-w-[280px] text-[13px] leading-relaxed text-fg-subtle">{t("home.noUsage")}</p>
          )}
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-fg-subtle">{label}</dt>
      <dd className="text-fg-muted tabular-nums">{value}</dd>
    </div>
  );
}

function ReviewCard({ notebooks }: { notebooks: Notebook[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const stats = useQueries({
    queries: notebooks.map((n) => ({
      queryKey: ["review-stats", n.id],
      queryFn: () => api.review.stats(n.id),
    })),
  });
  const due = stats.reduce((s, q) => s + (q.data?.due ?? 0), 0);
  const total = stats.reduce((s, q) => s + (q.data?.total ?? 0), 0);
  const mostDue = notebooks
    .map((n, i) => ({ n, due: stats[i]?.data?.due ?? 0 }))
    .sort((a, b) => b.due - a.due)[0];
  return (
    <Card label={t("home.due")}>
      <div className="flex items-start gap-3">
        <span className={cn(big, "flex-1")}>{due}</span>
        {due > 0 && mostDue ? (
          <Button
            size="sm"
            onClick={() =>
              navigate({
                to: "/n/$notebookId",
                params: { notebookId: mostDue.n.id },
                search: { panel: "review" },
              })
            }
          >
            {t("home.review")}
          </Button>
        ) : null}
      </div>
      <span className={cn(sub, "mt-auto")}>{total ? t("home.dueHint", { total }) : t("home.dueNone")}</span>
    </Card>
  );
}

// ───────────── 最近打开 ─────────────

const NOTE_ART: LucideIcon[] = [
  Feather,
  Lightbulb,
  Quote,
  Compass,
  Leaf,
  PenLine,
  Telescope,
  Sprout,
  Shapes,
  Landmark,
];

function artFor(id: string): LucideIcon {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return NOTE_ART[h % NOTE_ART.length]!;
}

function RecentNotes({ notes }: { notes: RecentNote[] }) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[17px] font-semibold">{t("home.recentNotes")}</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {withTints(notes.slice(0, 4)).map(({ note, tint }) => (
          <RecentNoteCard key={note.id} note={note} tint={tint} />
        ))}
      </div>
    </section>
  );
}

/** 每条笔记有自己的稳定颜色；同屏撞色时顺延到下一种，相邻卡片不重复。 */
function withTints(notes: RecentNote[]): { note: RecentNote; tint: Tint }[] {
  const used = new Set<Tint>();
  const all = Object.keys(TINTS) as Tint[];
  return notes.map((note) => {
    let tint = tintFor(note.id);
    for (let i = 0; used.has(tint) && i < all.length; i++) tint = all[(all.indexOf(tint) + 1) % all.length]!;
    used.add(tint);
    return { note, tint };
  });
}

function RecentNoteCard({ note: n, tint }: { note: RecentNote; tint: Tint }) {
  const { t } = useTranslation();
  const Art = artFor(n.id);
  return (
    <Link
      to="/n/$notebookId"
      params={{ notebookId: n.notebookId }}
      search={{ note: n.id }}
      className="group flex flex-col overflow-hidden rounded-xl border border-border bg-surface transition-colors hover:border-border-strong focus-ring"
    >
      {/* 插画区：色块 + 居中的线描图标，和 Console 的模型卡片同一种节奏 */}
      <div aria-hidden className="grid h-[104px] place-items-center" style={{ background: tintBg(tint) }}>
        <Art
          className="size-11 transition-transform duration-200 ease-out group-hover:scale-105"
          strokeWidth={1.15}
          style={{ color: tintInk }}
        />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="line-clamp-2 text-[15px] leading-snug font-medium">
          {n.title || t("common.untitled")}
        </h3>
        <div className="flex flex-wrap gap-1.5">
          <span className="max-w-full truncate rounded-md bg-surface-sunken px-2 py-0.5 text-[12.5px] text-fg-muted">
            {n.notebookTitle}
          </span>
          <span className="rounded-md bg-surface-sunken px-2 py-0.5 text-[12.5px] text-fg-muted tabular-nums">
            {t("home.words", { words: formatNumber(n.words) })}
          </span>
        </div>
        <span className="mt-auto pt-1 text-[12.5px] text-fg-subtle">
          {n.openedAt
            ? t("home.openedAt", { time: relativeTime(n.openedAt) })
            : t("home.editedAt", { time: relativeTime(n.updatedAt) })}
        </span>
      </div>
    </Link>
  );
}

// ───────────── 使用手册 ─────────────

function ManualTips({ notebooks }: { notebooks: Notebook[] }) {
  const { t, i18n } = useTranslation();
  const assignments = useAssignments();
  // biome-ignore lint/correctness/useExhaustiveDependencies: 切换语言时重新取手册内容
  const sections = useMemo(() => manualSections(currentLang()), [i18n.language]);
  const hasModel = !!assignments.data?.some((a) => a.capability === "chat");
  const withSources = notebooks.find((n) => (n.stats?.sources ?? 0) > 0);
  // 还没上手：先讲怎么开始；上手之后：讲进阶功能。
  const ids =
    !hasModel || !withSources || !hasAsked()
      ? ["start", "sources", "chat", "usage"]
      : ["chat", "studio", "research", "usage"];
  const picked = ids.map((id) => sections.find((s) => s.id === id)!).filter(Boolean);
  return (
    <section aria-label={t("manual.title")} className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <h2 className="text-[17px] font-semibold">{t("manual.title")}</h2>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => useUi.getState().set({ manual: "start" })}
          className="text-[13.5px] text-fg-muted underline decoration-border-strong underline-offset-4 hover:text-fg"
        >
          {t("manual.openAll")}
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {picked.map((s) => (
          <div key={s.id} className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center gap-2.5">
              <s.icon className="size-[18px] shrink-0 text-fg-muted" strokeWidth={1.6} />
              <span className="text-[15px] font-medium">{s.title}</span>
              {s.id === "start" && !hasModel ? (
                <span className="ml-auto rounded-md bg-accent-soft px-1.5 py-0.5 text-[11.5px] text-accent-soft-fg">
                  {t("manual.todo")}
                </span>
              ) : null}
            </div>
            <p className="flex-1 text-[13.5px] leading-relaxed text-fg-subtle">{s.summary}</p>
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={() => useUi.getState().set({ manual: s.id })}>
                <BookOpenText />
                {t("manual.read")}
              </Button>
              {s.id === "start" && !hasModel ? (
                <Button size="sm" variant="ghost" asChild>
                  <Link to="/settings/$section" params={{ section: "models" }}>
                    {t("home.setUp")}
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
