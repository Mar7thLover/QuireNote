import { Button, cn, Tooltip } from "@quirenote/ui";
import { ArrowUp, BookOpen, Quote, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNotebookBackground } from "@/features/lorebook/useBackground";
import { useSources } from "@/features/sources/hooks";
import { useTranslation } from "@/i18n";
import { useChatDraft } from "@/lib/ai";
import { DND_SNIPPET, DND_SOURCE } from "@/stores/ui";

export function Composer({
  notebookId,
  onlySource,
  streaming,
  onStop,
  onSubmit,
  modelPicker,
}: {
  notebookId: string;
  onlySource?: string;
  streaming: boolean;
  onStop: () => void;
  onSubmit: (content: string, sourceIds: string[]) => void;
  /** 底栏左侧的模型切换。 */
  modelPicker?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const sources = useSources(notebookId);
  const background = useNotebookBackground(notebookId);
  const draft = useChatDraft();
  const [text, setText] = useState("");
  const [only, setOnly] = useState<string[] | null>(onlySource ? [onlySource] : null);
  const [quote, setQuote] = useState<typeof draft.quote>(null);
  const [dropping, setDropping] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  // 接收其它面板发来的草稿（划词提问、拖入资料等）
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只响应 nonce 变化
  useEffect(() => {
    if (!draft.nonce) return;
    if (draft.quote) setQuote(draft.quote);
    if (draft.text) setText(draft.text);
    if (draft.onlySourceIds) setOnly(draft.onlySourceIds);
    draft.clear();
    setTimeout(() => ref.current?.focus(), 30);
  }, [draft.nonce]);

  useEffect(() => {
    if (onlySource) setOnly([onlySource]);
  }, [onlySource]);

  // 自适应高度
  // biome-ignore lint/correctness/useExhaustiveDependencies: 依赖 text
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);

  const ready = (sources.data ?? []).filter((s) => s.status === "ready");
  const selected = ready.filter((s) => s.selected);
  const scope = only ? ready.filter((s) => only.includes(s.id)) : selected;
  const canSend = !!text.trim() && (scope.length > 0 || background) && !streaming;

  const submit = () => {
    if (!canSend) return;
    const content = quote ? `> ${quote.text.replace(/\n+/g, " ")}\n\n${text.trim()}` : text.trim();
    onSubmit(
      content,
      scope.map((s) => s.id),
    );
    setText("");
    setQuote(null);
  };

  return (
    <div className="shrink-0 px-3 pb-3">
      <div
        className={cn(
          "relative mx-auto max-w-3xl rounded-2xl bg-surface shadow-md transition-shadow",
          "focus-within:shadow-[0_0_0_0.5px_var(--border-strong),0_2px_10px_rgb(31_30_29/0.07)]",
          dropping && "ring-2 ring-ring/40",
        )}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(DND_SOURCE) || e.dataTransfer.types.includes(DND_SNIPPET)) {
            e.preventDefault();
            setDropping(true);
          }
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(e) => {
          setDropping(false);
          const sid = e.dataTransfer.getData(DND_SOURCE);
          const snip = e.dataTransfer.getData(DND_SNIPPET);
          if (sid) {
            e.preventDefault();
            setOnly((o) => [...new Set([...(o ?? []), sid])]);
          } else if (snip) {
            e.preventDefault();
            setQuote({ text: snip });
          }
        }}
      >
        {quote || only ? (
          <div className="flex flex-wrap gap-1.5 px-2.5 pt-2.5">
            {quote ? (
              <Chip icon={<Quote />} onRemove={() => setQuote(null)}>
                {quote.text.slice(0, 60)}
                {quote.text.length > 60 ? "…" : ""}
              </Chip>
            ) : null}
            {only
              ? ready
                  .filter((s) => only.includes(s.id))
                  .map((s) => (
                    <Chip
                      key={s.id}
                      icon={<BookOpen />}
                      onRemove={() =>
                        setOnly((o) => (o && o.length > 1 ? o.filter((x) => x !== s.id) : null))
                      }
                    >
                      {s.title}
                    </Chip>
                  ))
              : null}
          </div>
        ) : null}
        <textarea
          ref={ref}
          data-chat-input
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={
            scope.length
              ? t("chat.placeholder")
              : background
                ? t("chat.placeholderLore")
                : t("chat.placeholderNoSources")
          }
          className="block max-h-56 w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[14.5px] leading-relaxed outline-none placeholder:text-fg-subtle"
          aria-label={t("chat.placeholder")}
        />
        {/* 按输入框自身宽度（而不是窗口宽度）决定显示哪些提示，窄面板里也保持一行。 */}
        <div className="@container flex min-w-0 items-center gap-2 px-2 pb-2">
          <span
            className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs whitespace-nowrap text-fg-subtle"
            title={t("chat.sourcesUsed", { count: scope.length })}
          >
            <BookOpen className="size-3.5" />
            <span className="hidden @xs:inline">{t("chat.sourcesUsed", { count: scope.length })}</span>
            <span className="@xs:hidden">{scope.length}</span>
          </span>
          {modelPicker}
          <div className="flex-1" />
          {streaming ? (
            <Tooltip content={t("chat.stop")}>
              <Button variant="secondary" size="icon-sm" onClick={onStop} aria-label={t("chat.stop")}>
                <Square className="fill-current" />
              </Button>
            </Tooltip>
          ) : (
            <Button
              variant="accent"
              size="icon-sm"
              onClick={submit}
              disabled={!canSend}
              aria-label={t("chat.send")}
            >
              <ArrowUp />
            </Button>
          )}
        </div>
        {dropping ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-xl bg-accent-soft/85 text-[13px] font-medium text-accent-soft-fg">
            {t("chat.dropSource")}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Chip({
  icon,
  children,
  onRemove,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-surface-sunken py-0.5 pr-0.5 pl-1.5 text-xs text-fg-muted [&>svg]:size-3 [&>svg]:shrink-0">
      {icon}
      <span className="truncate">{children}</span>
      <button
        type="button"
        onClick={onRemove}
        className="rounded p-0.5 hover:bg-surface-hover hover:text-fg"
        aria-label="remove"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}
