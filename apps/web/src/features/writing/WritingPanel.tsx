/**
 * 写作面板：稿件（卷 → 章，每章是一篇笔记）、大纲（梗概、场景节拍、按大纲起草、一致性检查、章节摘要）、
 * 人物与设定（知识书条目，带类型）。章节正文在笔记编辑器里写；编辑区保持安静，字数只在这里显示。
 */
import {
  countWords,
  type LoreEntry,
  type Manuscript,
  type ManuscriptChapter,
  type Note,
  newId,
} from "@quirenote/core";
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from "@quirenote/ui";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  BookOpenCheck,
  Download,
  FilePlus2,
  GripVertical,
  LibraryBig,
  ListPlus,
  PenLine,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { PanelShell } from "@/components/Panel";
import { createNote } from "@/features/notes/actions";
import i18n, { currentLang, useTranslation } from "@/i18n";
import { api } from "@/lib/api";
import { contextMenu } from "@/lib/contextMenu";
import { formatNumber } from "@/lib/format";
import { qk, queryClient } from "@/lib/query";
import { useWorkspace } from "@/stores/workspace";

type Tab = "manuscript" | "outline" | "cast";

const EMPTY: Manuscript = { volumes: [], target: null };

export function WritingPanel({ notebookId }: { notebookId: string }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("manuscript");
  const nb = useQuery({ queryKey: qk.notebook(notebookId), queryFn: () => api.notebooks.get(notebookId) });
  const notes = useQuery({ queryKey: qk.notes(notebookId), queryFn: () => api.notes.list(notebookId) });
  const ms = nb.data?.manuscript ?? EMPTY;
  const byId = useMemo(() => new Map((notes.data ?? []).map((n) => [n.id, n])), [notes.data]);

  // 稿件改动：先改缓存，再保存（连续输入时合并成一次）
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = (next: Manuscript, immediate = false) => {
    const cur = queryClient.getQueryData<typeof nb.data>(qk.notebook(notebookId));
    if (cur) queryClient.setQueryData(qk.notebook(notebookId), { ...cur, manuscript: next });
    if (timer.current) clearTimeout(timer.current);
    const run = () =>
      api.notebooks.update(notebookId, { manuscript: next }).catch((e: Error) => toast.error(e.message));
    if (immediate) run();
    else timer.current = setTimeout(run, 600);
  };

  const addChapter = async (volumeIndex: number) => {
    const n = ms.volumes.reduce((a, v) => a + v.chapters.length, 0) + 1;
    const note = await createNote(notebookId, { title: t("writing.chapterN", { n }), markdown: "" });
    const volumes = ms.volumes.length
      ? structuredClone(ms.volumes)
      : [{ id: newId("vol"), title: t("writing.volume1"), chapters: [] }];
    volumes[Math.min(volumeIndex, volumes.length - 1)]!.chapters.push({
      noteId: note.id,
      synopsis: "",
      beats: [],
      target: null,
    });
    save({ ...ms, volumes }, true);
  };

  return (
    <PanelShell
      toolbar={
        <>
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <TabsList>
              <TabsTrigger value="manuscript">{t("writing.tabManuscript")}</TabsTrigger>
              <TabsTrigger value="outline">{t("writing.tabOutline")}</TabsTrigger>
              <TabsTrigger value="cast">{t("writing.tabCast")}</TabsTrigger>
            </TabsList>
          </Tabs>
          <span className="flex-1" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" aria-label={t("common.export")} title={t("common.export")}>
                <Download />
                <span className="hidden @[34rem]:inline">{t("common.export")}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(["md", "docx", "epub"] as const).map((f) => (
                <DropdownMenuItem
                  key={f}
                  onSelect={() => window.open(api.writing.exportUrl(notebookId, f, currentLang()))}
                >
                  {t(`writing.export_${f}`)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    >
      <div className="h-full overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-4">
          {tab === "manuscript" ? (
            <ManuscriptTab ms={ms} byId={byId} notes={notes.data ?? []} save={save} addChapter={addChapter} />
          ) : tab === "outline" ? (
            <OutlineTab notebookId={notebookId} ms={ms} byId={byId} save={save} addChapter={addChapter} />
          ) : (
            <CastTab notebookId={notebookId} />
          )}
        </div>
      </div>
    </PanelShell>
  );
}

const openNote = (n: Note) =>
  useWorkspace
    .getState()
    .open({ kind: "note", id: n.id, title: n.title || i18n.t("notes.titlePlaceholder") });

// ───────────── 稿件 ─────────────

function ManuscriptTab({
  ms,
  byId,
  notes,
  save,
  addChapter,
}: {
  ms: Manuscript;
  byId: Map<string, Note>;
  notes: Note[];
  save: (m: Manuscript, immediate?: boolean) => void;
  addChapter: (volumeIndex: number) => void;
}) {
  const { t } = useTranslation();
  const [drag, setDrag] = useState<{ v: number; c: number } | null>(null);
  const total = ms.volumes.reduce(
    (a, v) => a + v.chapters.reduce((b, c) => b + countWords(byId.get(c.noteId)?.markdown ?? ""), 0),
    0,
  );
  const inMs = new Set(ms.volumes.flatMap((v) => v.chapters.map((c) => c.noteId)));
  const outside = notes.filter((n) => !inMs.has(n.id) && n.kind === "note");

  const move = (from: { v: number; c: number }, to: { v: number; c: number }) => {
    const volumes = structuredClone(ms.volumes);
    const [item] = volumes[from.v]!.chapters.splice(from.c, 1);
    if (!item) return;
    const target = from.v === to.v && from.c < to.c ? to.c - 1 : to.c;
    volumes[to.v]!.chapters.splice(Math.max(0, target), 0, item);
    save({ ...ms, volumes }, true);
  };

  if (!ms.volumes.length)
    return (
      <EmptyState
        icon={<PenLine />}
        title={t("writing.emptyTitle")}
        description={t("writing.emptyDesc")}
        action={
          <Button variant="primary" onClick={() => addChapter(0)}>
            <FilePlus2 />
            {t("writing.newChapter")}
          </Button>
        }
      />
    );

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-fg-subtle">
        <span>{t("writing.total", { n: formatNumber(total) })}</span>
        <span aria-hidden>·</span>
        <label className="flex items-center gap-1">
          {t("writing.target")}
          <Input
            type="number"
            min={0}
            step={10000}
            value={ms.target ?? ""}
            placeholder="—"
            className="h-6 w-24 px-1.5 text-[12.5px]"
            onChange={(e) => save({ ...ms, target: e.target.value ? Number(e.target.value) : null })}
          />
        </label>
      </div>
      {ms.volumes.map((v, vi) => (
        <section key={v.id} className="flex flex-col gap-0.5">
          <Input
            value={v.title}
            onChange={(e) => {
              const volumes = structuredClone(ms.volumes);
              volumes[vi]!.title = e.target.value;
              save({ ...ms, volumes });
            }}
            placeholder={t("writing.volumeTitle")}
            className="h-8 border-transparent bg-transparent px-1 font-serif text-[16px] hover:border-border focus:border-border"
            aria-label={t("writing.volumeTitle")}
          />
          <ol
            aria-label={v.title || t("writing.volumeTitle")}
            className="flex min-h-2 flex-col gap-0.5"
            onDragOver={(e) => drag && e.preventDefault()}
            onDrop={(e) => {
              if (!drag) return;
              e.preventDefault();
              move(drag, { v: vi, c: v.chapters.length });
              setDrag(null);
            }}
          >
            {v.chapters.map((c, ci) => {
              const note = byId.get(c.noteId);
              if (!note) return null;
              return (
                <li
                  key={c.noteId}
                  draggable
                  onContextMenu={contextMenu(() => [
                    [
                      {
                        id: "ch.open",
                        label: t("common.open"),
                        icon: BookOpen,
                        onSelect: () => openNote(note),
                      },
                    ],
                    [
                      {
                        id: "ch.up",
                        label: t("menu.moveUp"),
                        icon: ArrowUp,
                        disabled: ci === 0,
                        onSelect: () => move({ v: vi, c: ci }, { v: vi, c: ci - 1 }),
                      },
                      {
                        id: "ch.down",
                        label: t("menu.moveDown"),
                        icon: ArrowDown,
                        disabled: ci >= v.chapters.length - 1,
                        onSelect: () => move({ v: vi, c: ci }, { v: vi, c: ci + 2 }),
                      },
                    ],
                    [
                      {
                        id: "ch.remove",
                        label: t("writing.removeFromManuscript"),
                        icon: X,
                        danger: true,
                        onSelect: () => {
                          const volumes = structuredClone(ms.volumes);
                          volumes[vi]!.chapters.splice(ci, 1);
                          save({ ...ms, volumes }, true);
                        },
                      },
                    ],
                  ])}
                  onDragStart={() => setDrag({ v: vi, c: ci })}
                  onDragEnd={() => setDrag(null)}
                  onDragOver={(e) => drag && e.preventDefault()}
                  onDrop={(e) => {
                    if (!drag) return;
                    e.preventDefault();
                    e.stopPropagation();
                    move(drag, { v: vi, c: ci });
                    setDrag(null);
                  }}
                  className={cn(
                    "group flex items-center gap-2 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-surface-hover",
                    drag?.v === vi && drag.c === ci && "opacity-50",
                  )}
                >
                  <GripVertical className="size-3.5 shrink-0 cursor-grab text-fg-subtle opacity-0 group-hover:opacity-100" />
                  <button
                    type="button"
                    onClick={() => openNote(note)}
                    className="min-w-0 flex-1 truncate text-left text-[14px] focus-ring"
                  >
                    {note.title || t("common.untitled")}
                    {c.synopsis ? (
                      <span className="ml-2 text-[12.5px] text-fg-subtle">{c.synopsis}</span>
                    ) : null}
                  </button>
                  <span className="shrink-0 text-[12px] tabular-nums text-fg-subtle">
                    {formatNumber(countWords(note.markdown))}
                  </span>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    aria-label={t("writing.removeFromManuscript")}
                    title={t("writing.removeFromManuscript")}
                    onClick={() => {
                      const volumes = structuredClone(ms.volumes);
                      volumes[vi]!.chapters.splice(ci, 1);
                      save({ ...ms, volumes }, true);
                    }}
                  >
                    <X />
                  </Button>
                </li>
              );
            })}
          </ol>
          <div className="flex gap-1 pl-6">
            <Button size="xs" variant="ghost" onClick={() => addChapter(vi)}>
              <Plus />
              {t("writing.newChapter")}
            </Button>
            {outside.length ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="xs" variant="ghost">
                    <ListPlus />
                    {t("writing.addExisting")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-80 w-64 overflow-y-auto">
                  <DropdownMenuLabel>{t("writing.addExisting")}</DropdownMenuLabel>
                  {outside.map((n) => (
                    <DropdownMenuItem
                      key={n.id}
                      onSelect={() => {
                        const volumes = structuredClone(ms.volumes);
                        volumes[vi]!.chapters.push({ noteId: n.id, synopsis: "", beats: [], target: null });
                        save({ ...ms, volumes }, true);
                      }}
                    >
                      <span className="truncate">{n.title || t("common.untitled")}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </section>
      ))}
      <Button
        size="sm"
        variant="ghost"
        className="self-start"
        onClick={() =>
          save(
            {
              ...ms,
              volumes: [
                ...ms.volumes,
                { id: newId("vol"), title: t("writing.volumeN", { n: ms.volumes.length + 1 }), chapters: [] },
              ],
            },
            true,
          )
        }
      >
        <Plus />
        {t("writing.newVolume")}
      </Button>
    </>
  );
}

// ───────────── 大纲 ─────────────

function OutlineTab({
  notebookId,
  ms,
  byId,
  save,
  addChapter,
}: {
  notebookId: string;
  ms: Manuscript;
  byId: Map<string, Note>;
  save: (m: Manuscript, immediate?: boolean) => void;
  addChapter: (volumeIndex: number) => void;
}) {
  const { t } = useTranslation();
  const update = (vi: number, ci: number, patch: Partial<ManuscriptChapter>) => {
    const volumes = structuredClone(ms.volumes);
    volumes[vi]!.chapters[ci] = { ...volumes[vi]!.chapters[ci]!, ...patch };
    save({ ...ms, volumes });
  };
  if (!ms.volumes.some((v) => v.chapters.length))
    return (
      <EmptyState
        icon={<PenLine />}
        title={t("writing.emptyTitle")}
        description={t("writing.emptyDesc")}
        action={
          <Button variant="primary" onClick={() => addChapter(0)}>
            <FilePlus2 />
            {t("writing.newChapter")}
          </Button>
        }
      />
    );
  return (
    <>
      <p className="text-[12.5px] leading-relaxed text-fg-subtle">{t("writing.outlineHint")}</p>
      {ms.volumes.map((v, vi) => (
        <section key={v.id} className="flex flex-col gap-3">
          {ms.volumes.length > 1 ? <h3 className="font-serif text-[16px]">{v.title}</h3> : null}
          {v.chapters.map((c, ci) => {
            const note = byId.get(c.noteId);
            if (!note) return null;
            return (
              <ChapterOutline
                key={c.noteId}
                notebookId={notebookId}
                note={note}
                chapter={c}
                onChange={(p) => update(vi, ci, p)}
              />
            );
          })}
        </section>
      ))}
    </>
  );
}

function ChapterOutline({
  notebookId,
  note,
  chapter,
  onChange,
}: {
  notebookId: string;
  note: Note;
  chapter: ManuscriptChapter;
  onChange: (p: Partial<ManuscriptChapter>) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<{ text: string; done: boolean } | null>(null);
  const [issues, setIssues] = useState<{ quote: string; problem: string; suggestion: string }[] | null>(null);
  const [busy, setBusy] = useState<"check" | "summary" | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  // 起草结果在卡片底部，开始和写完时各滚一次，让正文和「加到这一章末尾」在视野里
  const draftRef = useRef<HTMLDivElement>(null);
  const drafting = draft !== null;
  const draftDone = draft?.done ?? false;
  useEffect(() => {
    if (drafting || draftDone) draftRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [drafting, draftDone]);
  const summary = typeof note.props.summary === "string" ? note.props.summary : "";

  const runDraft = async () => {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setDraft({ text: "", done: false });
    try {
      await api.writing.draft(
        notebookId,
        note.id,
        (full) => setDraft({ text: full, done: false }),
        ac.signal,
      );
      setDraft((d) => (d ? { ...d, done: true } : d));
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast.error((e as Error).message);
      setDraft(null);
    }
  };

  const appendDraft = async () => {
    if (!draft?.text.trim()) return;
    const cur = queryClient.getQueryData<Note>(qk.note(note.id)) ?? note;
    const markdown = cur.markdown.trim()
      ? `${cur.markdown.trimEnd()}\n\n${draft.text.trim()}\n`
      : `${draft.text.trim()}\n`;
    try {
      const saved = await api.notes.update(note.id, { markdown, doc: null });
      queryClient.setQueryData(qk.note(note.id), saved);
      queryClient.invalidateQueries({ queryKey: qk.notes(notebookId) });
      setDraft(null);
      openNote(saved);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface p-3.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => openNote(note)}
          className="min-w-0 flex-1 truncate text-left text-[14.5px] font-medium hover:underline focus-ring"
        >
          {note.title || t("common.untitled")}
        </button>
        <span className="shrink-0 text-[12px] tabular-nums text-fg-subtle">
          {formatNumber(countWords(note.markdown))}
          {chapter.target ? ` / ${formatNumber(chapter.target)}` : ""}
        </span>
      </div>
      <Textarea
        value={chapter.synopsis}
        rows={2}
        placeholder={t("writing.synopsisPlaceholder")}
        onChange={(e) => onChange({ synopsis: e.target.value })}
        className="min-h-14 text-[13.5px]"
        aria-label={t("writing.synopsis")}
      />
      <div className="flex flex-col gap-1">
        {chapter.beats.map((b, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="w-5 shrink-0 text-right text-[12px] tabular-nums text-fg-subtle">{i + 1}.</span>
            <Input
              value={b}
              className="h-7 text-[13px]"
              onChange={(e) =>
                onChange({ beats: chapter.beats.map((x, j) => (j === i ? e.target.value : x)) })
              }
              aria-label={t("writing.beat")}
            />
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={t("common.delete")}
              onClick={() => onChange({ beats: chapter.beats.filter((_, j) => j !== i) })}
            >
              <X />
            </Button>
          </div>
        ))}
        <Button
          size="xs"
          variant="ghost"
          className="self-start"
          onClick={() => onChange({ beats: [...chapter.beats, ""] })}
        >
          <Plus />
          {t("writing.addBeat")}
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="soft" onClick={runDraft} disabled={!!draft && !draft.done}>
          <Sparkles />
          {note.markdown.trim() ? t("writing.continueByOutline") : t("writing.draftByOutline")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          loading={busy === "check"}
          disabled={!note.markdown.trim()}
          onClick={async () => {
            setBusy("check");
            try {
              setIssues((await api.writing.check(notebookId, note.id)).issues);
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setBusy(null);
            }
          }}
        >
          <BookOpenCheck />
          {t("writing.check")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          loading={busy === "summary"}
          disabled={!note.markdown.trim()}
          onClick={async () => {
            setBusy("summary");
            try {
              await api.writing.summary(note.id);
              queryClient.invalidateQueries({ queryKey: qk.notes(notebookId) });
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setBusy(null);
            }
          }}
        >
          <RefreshCw />
          {t("writing.summarize")}
        </Button>
      </div>
      {summary ? (
        <p className="border-l-2 border-border pl-2.5 text-[12.5px] leading-relaxed text-fg-muted">
          <span className="text-fg-subtle">
            {t("writing.summary")}
            {t("common.colon")}
          </span>
          {summary}
        </p>
      ) : null}
      {draft ? (
        <div ref={draftRef} className="scroll-mb-3">
          <Panel>
            <div className="max-h-72 overflow-y-auto whitespace-pre-wrap font-serif text-[14px] leading-relaxed">
              {draft.text || "…"}
            </div>
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  abort.current?.abort();
                  setDraft(null);
                }}
              >
                {t("writing.discard")}
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={!draft.done || !draft.text.trim()}
                onClick={appendDraft}
              >
                {t("writing.appendToChapter")}
              </Button>
            </div>
          </Panel>
        </div>
      ) : null}
      {issues ? (
        <Panel>
          {issues.length ? (
            <ul className="flex flex-col gap-2.5">
              {issues.map((i) => (
                <li key={i.quote} className="flex flex-col gap-0.5 text-[13px] leading-relaxed">
                  <span className="font-serif text-fg">{t("common.quoted", { text: i.quote })}</span>
                  <span className="text-fg-muted">{i.problem}</span>
                  {i.suggestion ? <span className="text-fg-subtle">{i.suggestion}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-fg-muted">{t("writing.noIssues")}</p>
          )}
          <Button size="xs" variant="ghost" className="self-end" onClick={() => setIssues(null)}>
            {t("common.close")}
          </Button>
        </Panel>
      ) : null}
    </div>
  );
}

function CastField({ label, children }: { label: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: 输入框作为子元素传进来
    <label className="flex flex-col gap-1">
      <span className="text-[12px] text-fg-subtle">{label}</span>
      {children}
    </label>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-2 rounded-lg bg-surface-sunken p-3">{children}</div>;
}

// ───────────── 人物与设定 ─────────────

const CAST_TYPES = ["character", "place", "faction", "item", "other"] as const;
type CastType = (typeof CAST_TYPES)[number];
const typeOf = (e: LoreEntry): CastType => {
  const v = (e.extensions as Record<string, unknown> | undefined)?.writing_type;
  return CAST_TYPES.includes(v as CastType) ? (v as CastType) : "other";
};

function CastTab({ notebookId }: { notebookId: string }) {
  const { t } = useTranslation();
  const book = useQuery({ queryKey: qk.lorebook(notebookId), queryFn: () => api.lorebook.get(notebookId) });
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const entries = (book.data?.entries ?? []).filter((e) =>
    `${e.name} ${e.keys.join(" ")} ${e.content}`.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.lorebook(notebookId) });

  const create = async (type: CastType) => {
    const name = t(`writing.new_${type}`);
    const e = await api.lorebook.create(notebookId, {
      name,
      keys: [],
      content: "",
      extensions: { writing_type: type },
    });
    await refresh();
    setOpen(e.id);
  };

  return (
    <>
      <p className="text-[12.5px] leading-relaxed text-fg-subtle">{t("writing.castHint")}</p>
      <div className="flex items-center gap-2">
        <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-surface px-2.5">
          <Search className="size-4 shrink-0 text-fg-subtle" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("lorebook.filter")}
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-fg-subtle"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="primary">
              <Plus />
              {t("writing.newCast")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {CAST_TYPES.map((k) => (
              <DropdownMenuItem
                key={k}
                onSelect={() => create(k).catch((e: Error) => toast.error(e.message))}
              >
                {t(`writing.type_${k}`)}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => useWorkspace.getState().open({ kind: "lorebook", title: t("nav.lorebook") })}
            >
              <LibraryBig />
              {t("writing.openLorebook")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {CAST_TYPES.map((type) => {
        const list = entries.filter((e) => typeOf(e) === type);
        if (!list.length) return null;
        return (
          <section key={type} className="flex flex-col gap-1.5">
            <h3 className="text-[12.5px] font-medium text-fg-subtle">{t(`writing.type_${type}`)}</h3>
            {list.map((e) => (
              <CastEntry
                key={e.id}
                entry={e}
                open={open === e.id}
                onToggle={() => setOpen(open === e.id ? null : e.id)}
                onSaved={refresh}
              />
            ))}
          </section>
        );
      })}
    </>
  );
}

function CastEntry({
  entry,
  open,
  onToggle,
  onSaved,
}: {
  entry: LoreEntry;
  open: boolean;
  onToggle: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState({
    name: entry.name,
    keys: entry.keys.join(t("common.listSep")),
    content: entry.content,
  });
  useEffect(
    () => setDraft({ name: entry.name, keys: entry.keys.join(t("common.listSep")), content: entry.content }),
    [entry, t],
  );
  const commit = async () => {
    const keys = draft.keys
      .split(/[、,，\n]/)
      .map((k) => k.trim())
      .filter(Boolean);
    if (
      draft.name === entry.name &&
      draft.content === entry.content &&
      keys.join("|") === entry.keys.join("|")
    )
      return;
    try {
      await api.lorebook.update(entry.id, {
        name: draft.name,
        content: draft.content,
        // 名字本身也算关键词：正文里提到就把设定交给 AI
        keys: keys.length ? keys : draft.name.trim() ? [draft.name.trim()] : [],
      });
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <div className="rounded-lg border border-border bg-surface">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left focus-ring"
        aria-expanded={open}
      >
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
          {entry.name || t("common.untitled")}
        </span>
        <span className="min-w-0 max-w-[50%] truncate text-[12px] text-fg-subtle">
          {entry.content.replace(/\s+/g, " ").slice(0, 60)}
        </span>
      </button>
      {open ? (
        <div className="flex flex-col gap-2.5 border-t border-border p-3">
          <CastField label={t("writing.castName")}>
            <Input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              onBlur={commit}
              placeholder={t("lorebook.namePlaceholder")}
            />
          </CastField>
          <CastField label={t("writing.castKeys")}>
            <Input
              value={draft.keys}
              onChange={(e) => setDraft({ ...draft, keys: e.target.value })}
              onBlur={commit}
              placeholder={t("writing.keysPlaceholder")}
            />
          </CastField>
          <CastField label={t("writing.castContent")}>
            <Textarea
              value={draft.content}
              rows={6}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })}
              onBlur={commit}
              placeholder={t("writing.castContentPlaceholder")}
            />
          </CastField>
        </div>
      ) : null}
    </div>
  );
}
