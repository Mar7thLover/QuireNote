import type { Citation, Message, UsedLore } from "@quirenote/core";
import { Button, cn, Textarea, Tooltip, TypingDots, toast } from "@quirenote/ui";
import {
  BookmarkPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FilePlus2,
  Pencil,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";
import { CitationPreview, Markdown } from "@/components/Markdown";
import { useNotebookBackground } from "@/features/lorebook/useBackground";
import { createNote } from "@/features/notes/actions";
import { useSources } from "@/features/sources/hooks";
import { useTranslation } from "@/i18n";
import { describeModel, parseModelRef, useProviders } from "@/lib/models";
import { DND_SNIPPET } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";
import type { PathItem } from "./tree";
import type { Streaming } from "./useChatStream";

export function MessageItem({
  item,
  notebookId,
  busy,
  onSwitch,
  onRegenerate,
  onEdit,
}: {
  item: PathItem;
  notebookId: string;
  busy: boolean;
  onSwitch: (m: Message) => void;
  onRegenerate: (m: Message) => void;
  onEdit: (m: Message, content: string) => void;
}) {
  const { t } = useTranslation();
  const m = item.message;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.content);

  const branch =
    item.siblings.length > 1 ? (
      <div className="flex items-center gap-0.5 text-[11px] tabular-nums text-fg-subtle">
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={busy || item.index === 0}
          onClick={() => onSwitch(item.siblings[item.index - 1]!)}
          aria-label="prev"
        >
          <ChevronLeft />
        </Button>
        {t("chat.branch", { i: item.index + 1, n: item.siblings.length })}
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={busy || item.index === item.siblings.length - 1}
          onClick={() => onSwitch(item.siblings[item.index + 1]!)}
          aria-label="next"
        >
          <ChevronRight />
        </Button>
      </div>
    ) : null;

  if (m.role === "user") {
    return (
      <div className="group flex flex-col items-end gap-1">
        {editing ? (
          <div className="w-full max-w-[85%] rounded-2xl border border-border-strong bg-surface p-2">
            <Textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-16 border-0 bg-transparent p-1 focus:ring-0"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  setEditing(false);
                  onEdit(m, draft);
                }
              }}
            />
            <div className="flex justify-end gap-1.5">
              <Button size="xs" variant="ghost" onClick={() => setEditing(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                size="xs"
                variant="primary"
                onClick={() => {
                  setEditing(false);
                  onEdit(m, draft);
                }}
              >
                {t("chat.send")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="max-w-[85%] rounded-2xl bg-surface-sunken px-4 py-2.5 text-[14.5px] leading-relaxed whitespace-pre-wrap text-fg">
            {m.content}
          </div>
        )}
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {branch}
          {!editing ? (
            <Tooltip content={t("chat.editMessage")}>
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={busy}
                onClick={() => {
                  setDraft(m.content);
                  setEditing(true);
                }}
                aria-label={t("chat.editMessage")}
              >
                <Pencil />
              </Button>
            </Tooltip>
          ) : null}
        </div>
        {item.siblings.length > 1 ? <div className="-mt-1 group-hover:hidden">{branch}</div> : null}
      </div>
    );
  }

  return (
    <div className="group">
      <AssistantBody text={m.content} citations={m.citations} lore={m.lore} error={m.status === "error"} />
      <div className="mt-2 flex items-center gap-0.5">
        {branch}
        <CopyButton text={m.content} />
        <Tooltip content={t("chat.regenerate")}>
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={busy}
            onClick={() => onRegenerate(m)}
            aria-label={t("chat.regenerate")}
          >
            <RefreshCw />
          </Button>
        </Tooltip>
        <Tooltip content={t("chat.saveAsCard")}>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => saveAs(notebookId, m, "card")}
            aria-label={t("chat.saveAsCard")}
          >
            <BookmarkPlus />
          </Button>
        </Tooltip>
        <Tooltip content={t("chat.saveAsNote")}>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => saveAs(notebookId, m, "note")}
            aria-label={t("chat.saveAsNote")}
          >
            <FilePlus2 />
          </Button>
        </Tooltip>
        {m.model ? <ModelTag modelRef={m.model} /> : null}
      </div>
    </div>
  );
}

/** 回答所用模型：「提供方 · 模型」，提供方已删除时只显示模型名。 */
function ModelTag({ modelRef }: { modelRef: string }) {
  const providers = useProviders();
  const choice = parseModelRef(modelRef);
  const d = choice ? describeModel(providers.data, choice) : null;
  return (
    <span
      className="ml-auto truncate text-[11px] text-fg-subtle opacity-0 group-hover:opacity-100"
      title={modelRef}
    >
      {d ? (d.provider ? `${d.provider} · ${d.model}` : d.model) : modelRef}
    </span>
  );
}

/** 存为卡片/笔记时，把引用编号改写成脚注形式，保留出处。 */
function withFootnotes(m: Message): string {
  if (!m.citations.length) return m.content;
  const notes = m.citations
    .map(
      (c) =>
        `[${c.n}] ${c.sourceTitle}${c.page ? `, p.${c.page}` : ""}：“${c.quote.slice(0, 80)}${c.quote.length > 80 ? "…" : ""}”`,
    )
    .join("\n");
  return `${m.content}\n\n---\n${notes}`;
}

async function saveAs(nb: string, m: Message, kind: "card" | "note") {
  const firstLine =
    m.content
      .replace(/[#*>`[\]\d]/g, "")
      .trim()
      .split("\n")[0] ?? "";
  await createNote(
    nb,
    {
      title: firstLine.slice(0, 28),
      markdown: withFootnotes(m),
      kind,
      origin: { type: "chat", refId: m.id, sourceId: null },
    },
    kind === "note",
  );
  toast.success(kind === "card" ? "已存为卡片" : "已存为笔记");
}

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const [ok, setOk] = useState(false);
  return (
    <Tooltip content={ok ? t("common.copied") : t("common.copy")}>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => {
          navigator.clipboard.writeText(text);
          setOk(true);
          setTimeout(() => setOk(false), 1200);
        }}
        aria-label={t("common.copy")}
      >
        {ok ? <Check className="!text-success" /> : <Copy />}
      </Button>
    </Tooltip>
  );
}

function AssistantBody({
  text,
  citations,
  lore,
  error,
}: {
  text: string;
  citations: Citation[];
  lore?: UsedLore[];
  error?: boolean;
}) {
  return (
    <div
      draggable={false}
      onDragStart={(e) => {
        const sel = window.getSelection()?.toString();
        if (sel) e.dataTransfer.setData(DND_SNIPPET, sel);
      }}
    >
      <Markdown
        text={text}
        citations={citations}
        scope="chat"
        className={cn("prose-serif", error && "text-danger")}
      />
      {citations.length || lore?.length ? (
        <div className="mt-3 flex flex-wrap items-start gap-x-2">
          {citations.length ? <CitationList citations={citations} /> : null}
          {lore?.length ? <LoreUsed lore={lore} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** 这条回答用到的知识书条目：默认只显示一行，点开看名称，点名称打开知识书。 */
function LoreUsed({ lore }: { lore: UsedLore[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-fg-subtle hover:bg-surface-hover hover:text-fg focus-ring"
      >
        {t("chat.loreUsed")}
      </button>
      {open ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5 px-1.5">
          {lore.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => useWorkspace.getState().open({ kind: "lorebook", title: t("nav.lorebook") })}
              className="rounded-md bg-surface-sunken px-2 py-0.5 text-xs text-fg-muted hover:text-fg"
            >
              {l.name || t("common.untitled")}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CitationList({ citations }: { citations: Citation[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const jumpTo = useWorkspace((s) => s.jumpTo);
  const bySource = new Map<string, Citation[]>();
  for (const c of citations) bySource.set(c.sourceTitle, [...(bySource.get(c.sourceTitle) ?? []), c]);
  return (
    <div className={cn(open && "basis-full")}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-fg-subtle hover:bg-surface-hover hover:text-fg focus-ring"
      >
        {t("chat.citations")} · {citations.length}
        <span className="text-fg-subtle">
          {[...bySource.keys()].slice(0, 2).join("、")}
          {bySource.size > 2 ? "…" : ""}
        </span>
      </button>
      {open ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {citations.map((c) => (
            <button
              key={c.n}
              type="button"
              onClick={() => jumpTo(c.sourceId, c.start, c.end)}
              className="rounded-lg border border-border bg-surface p-2.5 text-left transition-colors hover:border-border-strong focus-ring"
            >
              <CitationPreview citation={c} extra={<span className="cite ml-auto">{c.n}</span>} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function StreamingItem({ streaming }: { streaming: Streaming }) {
  const { t } = useTranslation();
  if (!streaming.text) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-fg-subtle">
        {t("chat.thinking")}
        <TypingDots />
      </div>
    );
  }
  return (
    <div>
      <Markdown text={`${streaming.text} ▍`} citations={streaming.citations} className="prose-serif" />
    </div>
  );
}

export function ChatEmpty({ notebookId, onAsk }: { notebookId: string; onAsk: (q: string) => void }) {
  const { t } = useTranslation();
  const sources = useSources(notebookId);
  const ready = (sources.data ?? []).filter((s) => s.status === "ready" && s.selected);
  const lore = useNotebookBackground(notebookId) && !ready.length;
  const suggestions = ready.length
    ? [
        "用三句话概括这些资料的核心观点",
        "梳理其中的关键时间线",
        `「${ready[0]!.title}」的主要论点是什么？`,
        "资料之间有哪些不一致或相互矛盾的说法？",
      ]
    : [];
  return (
    <div className="flex flex-col items-center pt-12 text-center">
      <h3 className="font-serif text-[24px] font-normal">
        {t(lore ? "chat.emptyTitleLore" : "chat.emptyTitle")}
      </h3>
      <p className="mt-2 max-w-sm text-[13.5px] leading-relaxed text-fg-subtle">
        {t(lore ? "chat.emptyDescLore" : "chat.emptyDesc")}
      </p>
      {suggestions.length ? (
        <div className="mt-6 grid w-full max-w-lg gap-2">
          <p className="text-left text-xs font-medium text-fg-subtle">{t("chat.suggestions")}</p>
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onAsk(s)}
              className="rounded-lg border border-border bg-surface px-3.5 py-2.5 text-left text-[13.5px] text-fg-muted transition-colors hover:border-border-strong hover:text-fg focus-ring"
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
