import type { Notebook } from "@quirenote/core";
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Skeleton,
  tagColor,
  toast,
} from "@quirenote/ui";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Download, MoreHorizontal, NotebookPen, Pin, PinOff, Plus, Trash2, Upload } from "lucide-react";
import { type ReactNode, useMemo, useRef } from "react";
import { AppHeader } from "@/components/AppHeader";
import { AppShell } from "@/components/AppSidebar";
import { GettingStarted } from "@/components/GettingStarted";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api";
import { greetingKey, relativeTime } from "@/lib/format";
import { describeModel, useAssignments, useProviders } from "@/lib/models";
import { qk, queryClient, removeFromList, upsertInList } from "@/lib/query";
import { useUi } from "@/stores/ui";

export function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const openNew = () => useUi.getState().set({ newNotebookOpen: true });
  const fileRef = useRef<HTMLInputElement>(null);
  const notebooks = useQuery({ queryKey: qk.notebooks, queryFn: api.notebooks.list });

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
        <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-10 px-5 pt-8 pb-16 sm:px-10 sm:pt-12">
          <header className="flex flex-wrap items-center gap-3">
            <h1 className="mr-auto font-serif text-[30px] leading-tight font-normal">
              {t(`home.${greetingKey()}`)}
            </h1>
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

          {notebooks.data ? <Overview notebooks={notebooks.data} /> : null}

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

          {notebooks.data ? <GettingStarted notebooks={notebooks.data} /> : null}

          <footer className="flex flex-wrap justify-center gap-x-5 gap-y-2 pt-4 text-[13px] text-fg-subtle">
            <button
              type="button"
              onClick={() => useUi.getState().set({ shortcutsOpen: true })}
              className="underline decoration-border-strong underline-offset-4 hover:text-fg"
            >
              {t("home.shortcuts")}
            </button>
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

function StatCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[132px] flex-col gap-2 rounded-xl border border-border bg-surface p-5">
      <span className="text-[14px] text-fg-muted">{label}</span>
      {children}
    </div>
  );
}

/** 顶部三张概览卡：对话模型、待复习、资料库。只放真实、可行动的数据。 */
function Overview({ notebooks }: { notebooks: Notebook[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const assignments = useAssignments();
  const providers = useProviders();
  const chat = assignments.data?.find((a) => a.capability === "chat");
  const model = chat ? describeModel(providers.data, chat) : null;
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
  const sources = notebooks.reduce((s, n) => s + (n.stats?.sources ?? 0), 0);
  const notes = notebooks.reduce((s, n) => s + (n.stats?.notes ?? 0), 0);

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <StatCard label={t("home.chatModel")}>
        {assignments.isLoading ? (
          <Skeleton className="h-8 w-40" />
        ) : model ? (
          <>
            <div className="flex items-start gap-3">
              <span className="min-w-0 flex-1 truncate text-[22px] font-semibold tracking-tight">
                {model.model}
              </span>
              <Button size="sm" asChild>
                <Link to="/settings/$section" params={{ section: "models" }}>
                  {t("home.change")}
                </Link>
              </Button>
            </div>
            <span className="truncate text-[13.5px] text-fg-subtle">{model.provider}</span>
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
            <span className="text-[13.5px] text-fg-subtle">{t("home.noModelHint")}</span>
          </>
        )}
      </StatCard>
      <StatCard label={t("home.due")}>
        <div className="flex items-start gap-3">
          <span className="flex-1 text-[30px] leading-none font-semibold tracking-tight tabular-nums">
            {due}
          </span>
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
        <span className="text-[13.5px] text-fg-subtle">
          {total ? t("home.dueHint", { total }) : t("home.dueNone")}
        </span>
      </StatCard>
      <StatCard label={t("home.library")}>
        <span className="text-[30px] leading-none font-semibold tracking-tight tabular-nums">
          {t("home.sources", { count: sources })}
        </span>
        <span className="text-[13.5px] text-fg-subtle">
          {t("home.libraryHint", { notes, notebooks: notebooks.length })}
        </span>
      </StatCard>
    </div>
  );
}

function NotebookCard({ nb }: { nb: Notebook }) {
  const { t } = useTranslation();
  const color = tagColor(nb.color);

  const update = useMutation({
    mutationFn: (patch: { pinned?: boolean }) => api.notebooks.update(nb.id, patch),
    onMutate: (patch) => upsertInList(qk.notebooks, { ...nb, ...patch }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.notebooks }),
  });
  const remove = useMutation({
    mutationFn: () => api.notebooks.remove(nb.id),
    onMutate: () => removeFromList(qk.notebooks, nb.id),
    onSuccess: () => toast.success(t("common.delete")),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.notebooks }),
  });
  const onDelete = () => {
    if (confirm(t("home.deleteConfirm", { title: nb.title }))) remove.mutate();
  };

  const menu = (
    Item: typeof DropdownMenuItem | typeof ContextMenuItem,
    Sep: typeof DropdownMenuSeparator | typeof ContextMenuSeparator,
  ) => (
    <>
      <Item onSelect={() => update.mutate({ pinned: !nb.pinned })}>
        {nb.pinned ? <PinOff /> : <Pin />}
        {nb.pinned ? t("home.unpin") : t("home.pin")}
      </Item>
      <Item onSelect={() => window.open(api.notebooks.exportUrl(nb.id))}>
        <Download />
        {t("common.export")}
      </Item>
      <Sep />
      <Item danger onSelect={onDelete}>
        <Trash2 />
        {t("common.delete")}
      </Item>
    </>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Link
          to="/n/$notebookId"
          params={{ notebookId: nb.id }}
          className="group flex min-h-44 flex-col overflow-hidden rounded-xl border border-border bg-surface transition-colors hover:border-border-strong focus-ring"
        >
          {/* 色带取 Notebook 自己的颜色，低饱和，只做区分 */}
          <div
            aria-hidden
            className="h-14 shrink-0"
            style={{ background: `color-mix(in srgb, ${color} 22%, var(--surface-sunken))` }}
          />
          <div className="flex flex-1 flex-col gap-1.5 p-4">
            <div className="flex items-start gap-2">
              <h3 className="min-w-0 flex-1 truncate text-[15.5px] font-medium">{nb.title}</h3>
              {nb.pinned ? <Pin className="mt-1 size-3.5 shrink-0 text-fg-subtle" /> : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="-mt-0.5 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 focus-visible:opacity-100"
                    onClick={(e) => e.preventDefault()}
                    aria-label={t("common.more")}
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                  {menu(DropdownMenuItem, DropdownMenuSeparator)}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {nb.description ? (
              <p className="line-clamp-2 text-[13.5px] leading-relaxed text-fg-subtle">{nb.description}</p>
            ) : null}
            <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2">
              <span className="rounded-md bg-surface-sunken px-2 py-0.5 text-[12.5px] text-fg-muted">
                {t("home.sources", { count: nb.stats?.sources ?? 0 })}
              </span>
              <span className="rounded-md bg-surface-sunken px-2 py-0.5 text-[12.5px] text-fg-muted">
                {t("home.notes", { count: nb.stats?.notes ?? 0 })}
              </span>
              <span className="ml-auto text-[12.5px] text-fg-subtle">{relativeTime(nb.updatedAt)}</span>
            </div>
          </div>
        </Link>
      </ContextMenuTrigger>
      <ContextMenuContent>{menu(ContextMenuItem, ContextMenuSeparator)}</ContextMenuContent>
    </ContextMenu>
  );
}
