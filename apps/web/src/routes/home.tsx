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
  Input,
  listItem,
  Shortcut,
  Skeleton,
  tagColor,
  toast,
} from "@quirenote/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  BookOpen,
  Download,
  FileText,
  MoreHorizontal,
  NotebookPen,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { motion } from "motion/react";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api";
import { greetingKey, relativeTime } from "@/lib/format";
import { qk, queryClient, removeFromList, upsertInList } from "@/lib/query";
import { useUi } from "@/stores/ui";

export function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const openNew = () => useUi.getState().set({ newNotebookOpen: true });
  const [q, setQ] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const notebooks = useQuery({ queryKey: qk.notebooks, queryFn: api.notebooks.list });

  const importNb = useMutation({
    mutationFn: api.notebooks.import,
    onSuccess: (nb) => {
      upsertInList(qk.notebooks, nb);
      navigate({ to: "/n/$notebookId", params: { notebookId: nb.id } });
    },
  });

  const { pinned, rest } = useMemo(() => {
    const list = (notebooks.data ?? [])
      .filter((n) => !q || `${n.title} ${n.description}`.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { pinned: list.filter((n) => n.pinned), rest: list.filter((n) => !n.pinned) };
  }, [notebooks.data, q]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <AppHeader />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-5 pt-10 pb-24 sm:px-8 sm:pt-16">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
          >
            <h1 className="font-serif text-[32px] font-semibold tracking-tight text-fg sm:text-[40px]">
              {t(`home.${greetingKey()}`)}
            </h1>
            <p className="mt-2 text-[15px] text-fg-muted">{t("home.subtitle")}</p>
          </motion.div>

          <div className="mt-8 flex flex-wrap items-center gap-2">
            <Button variant="primary" size="lg" onClick={openNew}>
              <Plus />
              {t("home.newNotebook")}
            </Button>
            <Button size="lg" onClick={() => fileRef.current?.click()} loading={importNb.isPending}>
              <Upload />
              {t("home.importNotebook")}
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
            <div className="relative ml-auto w-full sm:w-64">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-subtle" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("home.searchPlaceholder")}
                className="h-10 pl-8"
                aria-label={t("home.searchPlaceholder")}
              />
            </div>
          </div>

          {notebooks.isLoading ? (
            <Grid label={t("home.recent")}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-44 rounded-xl border border-border bg-surface p-5">
                  <Skeleton className="size-10 rounded-lg" />
                  <Skeleton className="mt-5 h-5 w-2/3" />
                  <Skeleton className="mt-3 h-3.5 w-full" />
                  <Skeleton className="mt-2 h-3.5 w-1/2" />
                </div>
              ))}
            </Grid>
          ) : notebooks.data?.length === 0 ? (
            <EmptyState
              className="mt-16"
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
            <>
              {pinned.length > 0 ? (
                <Grid label={t("home.pinned")}>
                  {pinned.map((n, i) => (
                    <NotebookCard key={n.id} nb={n} index={i} />
                  ))}
                </Grid>
              ) : null}
              <Grid label={t("home.recent")}>
                {rest.map((n, i) => (
                  <NotebookCard key={n.id} nb={n} index={i + pinned.length} />
                ))}
                <button
                  type="button"
                  onClick={openNew}
                  className="group flex h-44 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong text-fg-subtle transition-colors hover:border-accent hover:bg-accent-soft/40 hover:text-accent-soft-fg focus-ring"
                >
                  <Plus className="size-5 transition-transform group-hover:scale-110" />
                  <span className="text-sm font-medium">{t("home.newNotebook")}</span>
                </button>
              </Grid>
            </>
          )}
          <p className="mt-10 flex items-center justify-center gap-1.5 text-xs text-fg-subtle">
            <Shortcut keys="Mod+K" /> 打开命令面板
          </p>
        </div>
      </main>
    </div>
  );
}

function Grid({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="mb-3 text-[13px] font-medium text-fg-subtle">{label}</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}

function NotebookCard({ nb, index }: { nb: Notebook; index: number }) {
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
    <motion.div {...listItem(index)}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <Link
            to="/n/$notebookId"
            params={{ notebookId: nb.id }}
            className="group relative flex min-h-44 flex-col overflow-hidden rounded-xl border border-border bg-surface p-5 shadow-sm transition-[box-shadow,transform,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md focus-ring"
          >
            <div
              aria-hidden
              className="pointer-events-none absolute -top-16 -right-16 size-40 rounded-full opacity-[0.14] blur-2xl transition-opacity group-hover:opacity-25"
              style={{ background: color }}
            />
            <div className="flex items-start justify-between">
              <div
                className="grid size-10 place-items-center rounded-lg text-xl"
                style={{ background: `color-mix(in srgb, ${color} 14%, transparent)` }}
              >
                {nb.icon}
              </div>
              <div className="flex items-center gap-1">
                {nb.pinned ? <Pin className="size-3.5 text-fg-subtle" /> : null}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 focus-visible:opacity-100"
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
            </div>
            <h3 className="mt-4 truncate py-0.5 text-[16px] leading-normal font-semibold tracking-tight text-fg">
              {nb.title}
            </h3>
            <p className="mt-0.5 line-clamp-2 min-h-[2lh] text-[13px] leading-relaxed text-fg-muted">
              {nb.description || " "}
            </p>
            <div className="mt-auto flex items-center gap-3 pt-3 text-xs text-fg-subtle">
              <span className="inline-flex items-center gap-1">
                <BookOpen className="size-3.5" />
                {t("home.sources", { count: nb.stats?.sources ?? 0 })}
              </span>
              <span className="inline-flex items-center gap-1">
                <FileText className="size-3.5" />
                {t("home.notes", { count: nb.stats?.notes ?? 0 })}
              </span>
              <span className="ml-auto">{relativeTime(nb.updatedAt)}</span>
            </div>
          </Link>
        </ContextMenuTrigger>
        <ContextMenuContent>{menu(ContextMenuItem, ContextMenuSeparator)}</ContextMenuContent>
      </ContextMenu>
    </motion.div>
  );
}
