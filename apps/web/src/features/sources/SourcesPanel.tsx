import { SOURCE_KIND_META, type Source } from "@quirenote/core";
import {
  Button,
  Checkbox,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  cn,
  EmptyState,
  Skeleton,
  Spinner,
  Tooltip,
} from "@quirenote/ui";
import {
  AlertCircle,
  BookOpen,
  Download,
  FileUp,
  Globe,
  MessageSquareQuote,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { PanelShell, PanelTitle } from "@/components/Panel";
import { VirtualList } from "@/components/VirtualList";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api";
import { formatCount } from "@/lib/format";
import { SHORTCUTS } from "@/lib/hotkeys";
import { Icon } from "@/lib/icons";
import { DND_SOURCE, useUi } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";
import { uploadFiles, useRemoveSource, useSources, useUpdateSource } from "./hooks";

export function SourcesPanel({ notebookId }: { notebookId: string }) {
  const { t } = useTranslation();
  const sources = useSources(notebookId);
  const update = useUpdateSource(notebookId);
  const [dropping, setDropping] = useState(false);
  const list = sources.data ?? [];
  const selectable = list.filter((s) => s.status === "ready");
  const selected = selectable.filter((s) => s.selected);
  const allState =
    selected.length === 0 ? false : selected.length === selectable.length ? true : "indeterminate";

  const toggleAll = () => {
    const next = allState !== true;
    for (const s of selectable)
      if (s.selected !== next) update.mutate({ id: s.id, patch: { selected: next } });
  };

  return (
    <PanelShell
      toolbar={
        <>
          <PanelTitle count={list.length}>{t("sources.title")}</PanelTitle>
          <div className="flex-1" />
          <Tooltip content={t("sources.webSearch")}>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => useWorkspace.getState().open({ kind: "search", title: t("nav.search") })}
              aria-label={t("sources.webSearch")}
            >
              <Globe />
            </Button>
          </Tooltip>
          <Tooltip content={t("sources.add")} shortcut={SHORTCUTS.addSource}>
            <Button variant="soft" size="sm" onClick={() => useUi.getState().openAddSource()}>
              <Plus />
              {t("common.add")}
            </Button>
          </Tooltip>
        </>
      }
    >
      <div
        className="flex h-full flex-col"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setDropping(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false);
        }}
        onDrop={(e) => {
          setDropping(false);
          if (e.dataTransfer.files.length) {
            e.preventDefault();
            uploadFiles(notebookId, [...e.dataTransfer.files]);
          }
        }}
      >
        {sources.isLoading ? (
          <div className="space-y-3 p-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-4" />
                <Skeleton className="size-8 rounded-md" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-3/4" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            className="h-full"
            icon={<BookOpen />}
            title={t("sources.empty")}
            description={t("sources.emptyDesc")}
            action={
              <Button variant="primary" size="sm" onClick={() => useUi.getState().openAddSource()}>
                <Plus />
                {t("sources.add")}
              </Button>
            }
          />
        ) : (
          <>
            <label className="flex h-9 shrink-0 cursor-pointer items-center gap-2.5 px-3.5 text-xs text-fg-muted select-none">
              <Checkbox checked={allState} onCheckedChange={toggleAll} aria-label={t("sources.selectAll")} />
              <span>{t("sources.selectAll")}</span>
              <span className="ml-auto tabular-nums text-fg-subtle">
                {t("sources.selectedCount", { count: selected.length, total: selectable.length })}
              </span>
            </label>
            <VirtualList
              className="min-h-0 flex-1 px-1.5 pb-2"
              items={list}
              estimate={52}
              getKey={(s) => s.id}
              render={(s) => <SourceRow source={s} notebookId={notebookId} />}
            />
          </>
        )}
        {dropping ? (
          <div className="pointer-events-none absolute inset-2 grid place-items-center rounded-lg border-2 border-dashed border-accent bg-accent-soft/80 text-sm font-medium text-accent-soft-fg animate-fade">
            <div className="flex flex-col items-center gap-2">
              <FileUp className="size-6" />
              {t("sources.dropHere")}
            </div>
          </div>
        ) : null}
      </div>
    </PanelShell>
  );
}

function SourceRow({ source: s, notebookId }: { source: Source; notebookId: string }) {
  const { t } = useTranslation();
  const update = useUpdateSource(notebookId);
  const remove = useRemoveSource(notebookId);
  const meta = SOURCE_KIND_META[s.kind];
  const busy = s.status === "pending" || s.status === "processing";
  const openReader = () => useWorkspace.getState().open({ kind: "reader", id: s.id, title: s.title });

  const rename = () => {
    const title = prompt(t("common.rename"), s.title)?.trim();
    if (title && title !== s.title) update.mutate({ id: s.id, patch: { title } });
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          draggable={s.status === "ready"}
          onDragStart={(e) => {
            e.dataTransfer.setData(DND_SOURCE, s.id);
            e.dataTransfer.setData("text/plain", s.title);
            e.dataTransfer.effectAllowed = "copy";
            useUi.getState().set({ dragging: { kind: "source", id: s.id } });
          }}
          onDragEnd={() => useUi.getState().set({ dragging: null })}
          className={cn(
            "group flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-hover",
            !s.selected && s.status === "ready" && "opacity-60 hover:opacity-100",
          )}
        >
          <Checkbox
            checked={s.status === "ready" && s.selected}
            disabled={s.status !== "ready"}
            onCheckedChange={(v) => update.mutate({ id: s.id, patch: { selected: v === true } })}
            aria-label={s.title}
          />
          <button
            type="button"
            onClick={openReader}
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-left focus-ring"
          >
            <span
              className={cn(
                "grid size-8 shrink-0 place-items-center rounded-md bg-surface-sunken text-fg-muted",
                s.status === "error" && "bg-danger-soft text-danger",
              )}
            >
              {busy ? (
                <Spinner className="size-3.5 text-accent" />
              ) : s.status === "error" ? (
                <AlertCircle className="size-4" />
              ) : (
                <Icon name={meta.icon} className="size-4" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium leading-tight">{s.title}</span>
              <span className="mt-0.5 block truncate text-[11.5px] text-fg-subtle">
                {busy
                  ? t(`sources.status_${s.status}`)
                  : s.status === "error"
                    ? s.error || t("sources.status_error")
                    : [
                        meta.label,
                        s.pageCount ? t("sources.pages", { count: s.pageCount }) : null,
                        s.charCount ? t("sources.chars", { n: formatCount(s.charCount) }) : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
              </span>
            </span>
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={openReader}>
          <BookOpen />
          {t("common.open")}
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() =>
            useWorkspace.getState().open({ kind: "chat", title: t("nav.chat"), extra: { onlySource: s.id } })
          }
        >
          <MessageSquareQuote />
          {t("chat.dropSource")}
        </ContextMenuItem>
        <ContextMenuItem onSelect={rename}>
          <Pencil />
          {t("common.rename")}
        </ContextMenuItem>
        {s.hasFile ? (
          <ContextMenuItem onSelect={() => window.open(api.sources.fileUrl(s.id))}>
            <Download />
            {t("reader.original")}
          </ContextMenuItem>
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuItem danger onSelect={() => confirm(t("sources.deleteConfirm")) && remove.mutate(s.id)}>
          <Trash2 />
          {t("common.delete")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
