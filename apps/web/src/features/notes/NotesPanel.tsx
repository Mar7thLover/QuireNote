import type { Note } from "@folio/core";
import {
  Badge,
  Button,
  cn,
  EmptyState,
  Input,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  Tooltip,
} from "@folio/ui";
import { useQuery } from "@tanstack/react-query";
import { FilePlus2, LayoutGrid, List, NotebookPen, Pin, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { PanelShell, PanelTitle } from "@/components/Panel";
import { VirtualList } from "@/components/VirtualList";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api";
import { plainPreview, relativeTime } from "@/lib/format";
import { SHORTCUTS } from "@/lib/hotkeys";
import { qk } from "@/lib/query";
import { DND_SNIPPET } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";
import { createNote } from "./actions";

type Filter = "all" | "note" | "card";

export function NotesPanel({ notebookId }: { notebookId: string }) {
  const { t } = useTranslation();
  const notes = useQuery({ queryKey: qk.notes(notebookId), queryFn: () => api.notes.list(notebookId) });
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [view, setView] = useState<"list" | "grid">("list");
  const [dropping, setDropping] = useState(false);

  const list = useMemo(() => {
    const ql = q.toLowerCase();
    return (notes.data ?? [])
      .filter((n) => filter === "all" || n.kind === filter)
      .filter((n) => !ql || `${n.title} ${n.markdown} ${n.tags.join(" ")}`.toLowerCase().includes(ql))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
  }, [notes.data, filter, q]);

  const open = (n: Note) =>
    useWorkspace.getState().open({ kind: "note", id: n.id, title: n.title || t("common.untitled") });

  return (
    <PanelShell
      toolbar={
        <>
          <PanelTitle count={notes.data?.length}>{t("notes.title")}</PanelTitle>
          <div className="flex-1" />
          <Tooltip content={view === "list" ? "卡片视图" : "列表视图"}>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setView(view === "list" ? "grid" : "list")}
              aria-label="toggle view"
            >
              {view === "list" ? <LayoutGrid /> : <List />}
            </Button>
          </Tooltip>
          <Tooltip content={t("notes.new")} shortcut={SHORTCUTS.newNote}>
            <Button variant="soft" size="sm" onClick={() => createNote(notebookId)}>
              <FilePlus2 />
              {t("common.create")}
            </Button>
          </Tooltip>
        </>
      }
    >
      <div
        className="flex h-full flex-col"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(DND_SNIPPET) || e.dataTransfer.types.includes("text/plain")) {
            e.preventDefault();
            setDropping(true);
          }
        }}
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDropping(false)}
        onDrop={(e) => {
          setDropping(false);
          const text = e.dataTransfer.getData(DND_SNIPPET) || e.dataTransfer.getData("text/plain");
          if (text?.trim()) {
            e.preventDefault();
            createNote(
              notebookId,
              {
                title: text.trim().slice(0, 24),
                markdown: `> ${text.trim()}`,
                kind: "card",
                origin: { type: "manual", refId: null, sourceId: null },
              },
              false,
            );
          }
        }}
      >
        <div className="flex shrink-0 items-center gap-2 px-2.5 pt-2 pb-1.5">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-fg-subtle" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("common.search")}
              className="h-7 pl-7 text-[13px]"
            />
          </div>
          <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <TabsList className="h-7">
              {(["all", "note", "card"] as const).map((f) => (
                <TabsTrigger key={f} value={f} className="h-6 px-2 text-xs">
                  {t(`notes.filter${f === "all" ? "All" : f === "note" ? "Notes" : "Cards"}`)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        {notes.isLoading ? (
          <div className="space-y-4 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-full" />
              </div>
            ))}
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            className="flex-1"
            icon={<NotebookPen />}
            title={t("notes.empty")}
            description={t("notes.emptyDesc")}
            action={
              <Button size="sm" variant="primary" onClick={() => createNote(notebookId)}>
                <FilePlus2 />
                {t("notes.new")}
              </Button>
            }
          />
        ) : view === "list" ? (
          <VirtualList
            className="min-h-0 flex-1 px-1.5 pb-2"
            items={list}
            estimate={68}
            getKey={(n) => n.id}
            render={(n) => (
              <button
                type="button"
                onClick={() => open(n)}
                className="group w-full rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-hover focus-ring"
              >
                <div className="flex items-center gap-1.5">
                  {n.pinned ? <Pin className="size-3 shrink-0 text-accent" /> : null}
                  <span className="truncate text-[13px] font-medium">{n.title || t("common.untitled")}</span>
                  {n.kind === "card" ? (
                    <Badge tone="accent" className="h-4 px-1.5 text-[10px]">
                      卡片
                    </Badge>
                  ) : null}
                  <span className="ml-auto shrink-0 text-[11px] text-fg-subtle">
                    {relativeTime(n.updatedAt)}
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-fg-subtle">
                  {plainPreview(n.markdown, 120) || "—"}
                </p>
              </button>
            )}
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
            <div className="columns-1 gap-2.5 @container sm:columns-2 [column-width:220px]">
              {list.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => open(n)}
                  className={cn(
                    "mb-2.5 block w-full break-inside-avoid rounded-xl border border-border bg-surface p-3 text-left shadow-sm transition-[box-shadow,transform] hover:-translate-y-px hover:shadow-md focus-ring",
                    n.kind === "card" && "bg-gradient-to-b from-accent-soft/40 to-surface",
                  )}
                >
                  {n.title ? <p className="mb-1.5 text-[13px] font-semibold">{n.title}</p> : null}
                  <div className="pointer-events-none max-h-72 overflow-hidden">
                    <Markdown
                      text={n.markdown.slice(0, 1200)}
                      scope="note"
                      className="prose-sm text-[13px]"
                    />
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
        {dropping ? (
          <div className="pointer-events-none absolute inset-2 grid place-items-center rounded-lg border-2 border-dashed border-accent bg-accent-soft/80 text-sm font-medium text-accent-soft-fg">
            {t("notes.dropHere")}
          </div>
        ) : null}
      </div>
    </PanelShell>
  );
}
