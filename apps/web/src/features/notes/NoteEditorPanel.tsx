import type { Note } from "@quirenote/core";
import {
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Skeleton,
} from "@quirenote/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Copy, CreditCard, FileText, MoreHorizontal, Pin, Share2, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { qk, queryClient, removeFromList, upsertInList } from "@/lib/query";
import { useUi } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";
import { type EditorChange, QuireNoteEditor } from "../editor/QuireNoteEditor";

export function NoteEditorPanel({ notebookId, noteId }: { notebookId: string; noteId: string }) {
  const note = useQuery({ queryKey: qk.note(noteId), queryFn: () => api.notes.get(noteId) });
  if (note.isLoading || !note.data) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-10 py-12">
        <Skeleton className="h-9 w-1/2" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    );
  }
  return <NoteEditor key={note.data.id} notebookId={notebookId} note={note.data} />;
}

function NoteEditor({ notebookId, note }: { notebookId: string; note: Note }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(note.title);
  const [status, setStatus] = useState<"saved" | "saving" | "dirty">("saved");
  const pending = useRef<Partial<Note>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const save = useMutation({
    mutationFn: (patch: Partial<Note>) => api.notes.update(note.id, patch),
    onSuccess: (n) => {
      upsertInList(qk.notes(notebookId), n);
      queryClient.setQueryData(qk.note(n.id), (old: Note | undefined) => ({
        ...(old ?? n),
        ...n,
        doc: old?.doc ?? n.doc,
      }));
      setStatus("saved");
    },
    onError: () => setStatus("dirty"),
  });

  const flush = () => {
    clearTimeout(timer.current);
    const patch = pending.current;
    pending.current = {};
    if (Object.keys(patch).length) {
      setStatus("saving");
      save.mutate(patch);
    }
  };
  const schedule = (patch: Partial<Note>) => {
    pending.current = { ...pending.current, ...patch };
    setStatus("dirty");
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 700);
  };
  // 关闭面板时立即保存
  // biome-ignore lint/correctness/useExhaustiveDependencies: 卸载时执行
  useEffect(() => () => flush(), []);

  // 记录「最近打开」（首页展示）；失败不影响编辑。
  useEffect(() => {
    api.notes
      .opened(note.id)
      .then(() => queryClient.invalidateQueries({ queryKey: qk.overview }))
      .catch(() => {});
  }, [note.id]);

  // 更新标签页标题
  const panelApi = useWorkspace((s) => s.api);
  useEffect(() => {
    panelApi?.getPanel(`note:${note.id}`)?.api.setTitle(title || t("common.untitled"));
  }, [panelApi, title, note.id, t]);

  const onChange = ({ doc, markdown }: EditorChange) => schedule({ doc, markdown });

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/70 px-3 text-xs text-fg-subtle">
        {note.kind === "card" ? <Badge tone="accent">卡片</Badge> : null}
        {note.origin.type !== "manual" ? (
          <Badge>{t(`notes.from${cap(note.origin.type)}` as "notes.fromChat")}</Badge>
        ) : null}
        <span>{relativeTime(note.updatedAt)}</span>
        <span className="flex-1" />
        <span
          className={cn("flex items-center gap-1 transition-opacity", status === "saved" && "opacity-60")}
        >
          {status === "saved" ? <Check className="size-3.5" /> : null}
          {status === "saving" ? t("notes.saving") : status === "saved" ? t("notes.saved") : "…"}
        </span>
        <NoteMenu notebookId={notebookId} note={note} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 pt-10 pb-40 sm:px-12">
          <textarea
            ref={(el) => {
              if (el) {
                el.style.height = "auto";
                el.style.height = `${el.scrollHeight}px`;
              }
            }}
            value={title}
            rows={1}
            onChange={(e) => {
              setTitle(e.target.value);
              schedule({ title: e.target.value });
              e.target.style.height = "auto";
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.currentTarget.parentElement?.querySelector(".tiptap") as HTMLElement | null)?.focus();
              }
            }}
            placeholder={t("notes.titlePlaceholder")}
            className="mb-4 block w-full resize-none overflow-hidden bg-transparent font-sans text-[30px] leading-tight font-bold tracking-tight outline-none placeholder:text-fg-subtle/60"
          />
          <TagsEditor
            tags={note.tags}
            onChange={(tags) => {
              queryClient.setQueryData(qk.note(note.id), { ...note, tags });
              schedule({ tags });
            }}
          />
          <QuireNoteEditor
            notebookId={notebookId}
            initialDoc={note.doc}
            initialMarkdown={note.markdown}
            onChange={onChange}
            autofocus={!note.markdown && !!note.title}
          />
        </div>
      </div>
    </div>
  );
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function TagsEditor({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [v, setV] = useState("");
  return (
    <div className="mb-6 flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className="group inline-flex h-6 items-center gap-1 rounded-full bg-surface-sunken pr-1 pl-2.5 text-xs text-fg-muted"
        >
          #{tag}
          <button
            type="button"
            onClick={() => onChange(tags.filter((x) => x !== tag))}
            className="rounded-full p-0.5 opacity-0 group-hover:opacity-100 hover:bg-surface-hover"
            aria-label="remove tag"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      {adding ? (
        <input
          autoFocus
          value={v}
          onChange={(e) => setV(e.target.value)}
          onBlur={() => {
            if (v.trim()) onChange([...new Set([...tags, v.trim()])]);
            setV("");
            setAdding(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setAdding(false);
          }}
          className="h-6 w-24 rounded-full bg-surface-sunken px-2.5 text-xs outline-none ring-1 ring-accent/50"
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="h-6 rounded-full px-2 text-xs text-fg-subtle hover:bg-surface-hover hover:text-fg-muted"
        >
          + 标签
        </button>
      )}
    </div>
  );
}

function NoteMenu({ notebookId, note }: { notebookId: string; note: Note }) {
  const { t } = useTranslation();
  const update = useMutation({
    mutationFn: (patch: Partial<Note>) => api.notes.update(note.id, patch),
    onSuccess: (n) => {
      upsertInList(qk.notes(notebookId), n);
      queryClient.setQueryData(qk.note(n.id), n);
    },
  });
  const remove = useMutation({
    mutationFn: () => api.notes.remove(note.id),
    onMutate: () => {
      removeFromList(qk.notes(notebookId), note.id);
      useWorkspace.getState().close({ kind: "note", id: note.id });
    },
  });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={t("common.more")}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => update.mutate({ pinned: !note.pinned })}>
          <Pin />
          {note.pinned ? t("home.unpin") : t("home.pin")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => update.mutate({ kind: note.kind === "card" ? "note" : "card" })}>
          {note.kind === "card" ? <FileText /> : <CreditCard />}
          {note.kind === "card" ? t("notes.toNote") : t("notes.toFlashcard")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            navigator.clipboard.writeText(
              queryClient.getQueryData<Note>(qk.note(note.id))?.markdown ?? note.markdown,
            )
          }
        >
          <Copy />
          {t("notes.copyMarkdown")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            useUi.getState().set({
              shareCard: {
                kind: "note",
                id: note.id,
                name:
                  queryClient.getQueryData<Note>(qk.note(note.id))?.title ||
                  note.title ||
                  t("common.untitled"),
              },
            })
          }
        >
          <Share2 />
          {t("cards.menuShare")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem danger onSelect={() => confirm(t("notes.deleteConfirm")) && remove.mutate()}>
          <Trash2 />
          {t("common.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
