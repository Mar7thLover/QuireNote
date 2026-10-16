import { SOURCE_KIND_META, type SourceContent } from "@quirenote/core";
import {
  Badge,
  Button,
  cn,
  EmptyState,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  Tooltip,
  toast,
} from "@quirenote/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ExternalLink, FileQuestion, Highlighter, Pencil, RotateCcw, Sparkles } from "lucide-react";
import { type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { PanelShell } from "@/components/Panel";
import i18n, { useTranslation } from "@/i18n";
import { api } from "@/lib/api";
import { qk } from "@/lib/query";
import { useWorkspace } from "@/stores/workspace";
import { HighlightsSidebar } from "./HighlightsSidebar";
import { SelectionToolbar, type ToolbarTarget } from "./SelectionToolbar";
import { applyEditResult, SourceEditor } from "./SourceEditor";
import { type Para, paragraphize, segmentParagraph, selectionOffsets } from "./text";

type Mode = "parsed" | "original" | "split";

export function ReaderPanel({ notebookId, sourceId }: { notebookId: string; sourceId: string }) {
  const { t } = useTranslation();
  const source = useQuery({ queryKey: qk.source(sourceId), queryFn: () => api.sources.get(sourceId) });
  const content = useQuery({
    queryKey: qk.content(sourceId),
    queryFn: () => api.sources.content(sourceId),
    enabled: source.data?.status === "ready",
  });
  const [mode, setMode] = useState<Mode>("parsed");
  const [showSide, setShowSide] = useState(false);
  const [editing, setEditing] = useState(false);
  const s = source.data;
  const ready = s?.status === "ready" && !!content.data;
  const revert = useMutation({
    mutationFn: () => api.sources.revertContent(sourceId),
    onSuccess: (r) => applyEditResult(r, t("reader.reverted")),
    onError: (e: Error) => toast.error(e.message),
  });
  const dockApi = useWorkspace((x) => x.api);
  useEffect(() => {
    if (s) dockApi?.getPanel(`reader:${s.id}`)?.api.setTitle(s.title);
  }, [dockApi, s]);
  const hasOriginal = !!s?.hasFile && ["pdf", "image", "audio", "video"].includes(s.kind);

  const auto = useMutation({
    mutationFn: () => api.sources.autoHighlight(sourceId),
    onSuccess: () => toast(t("reader.autoHighlight"), { description: t("sources.status_processing") }),
  });

  return (
    <PanelShell
      toolbar={
        <>
          <div className="flex min-w-0 flex-1 items-center gap-2 px-1">
            <span className="truncate text-[13px] font-semibold">{s?.title ?? "…"}</span>
            {s ? <Badge>{SOURCE_KIND_META[s.kind].label}</Badge> : null}
            {s?.props.edited ? <Badge tone="accent">{t("reader.edited")}</Badge> : null}
            {s?.url ? (
              <a
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="text-fg-subtle hover:text-fg"
                aria-label="open url"
              >
                <ExternalLink className="size-3.5" />
              </a>
            ) : null}
          </div>
          {hasOriginal && !editing ? (
            <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
              <TabsList className="h-7">
                <TabsTrigger value="parsed" className="h-6 px-2 text-xs">
                  {t("reader.parsed")}
                </TabsTrigger>
                <TabsTrigger value="original" className="h-6 px-2 text-xs">
                  {t("reader.original")}
                </TabsTrigger>
                <TabsTrigger value="split" className="h-6 px-2 text-xs">
                  {t("reader.split")}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          ) : null}
          {s?.props.edited && !editing ? (
            <Tooltip content={t("reader.revert")}>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={!ready}
                loading={revert.isPending}
                onClick={() => confirm(t("reader.revertConfirm")) && revert.mutate()}
                aria-label={t("reader.revert")}
              >
                {revert.isPending ? null : <RotateCcw />}
              </Button>
            </Tooltip>
          ) : null}
          <Tooltip content={ready ? t("reader.edit") : t("reader.busy")}>
            <Button
              variant="ghost"
              size="sm"
              disabled={!ready || editing}
              className={cn(editing && "bg-surface-hover text-fg")}
              onClick={() => setEditing(true)}
            >
              <Pencil />
              {t("reader.edit")}
            </Button>
          </Tooltip>
          <Tooltip content={t("reader.autoHighlight")}>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => auto.mutate()}
              loading={auto.isPending}
              aria-label={t("reader.autoHighlight")}
            >
              {auto.isPending ? null : <Sparkles />}
            </Button>
          </Tooltip>
          <Tooltip content={t("reader.highlightsList")}>
            <Button
              variant="ghost"
              size="sm"
              className={cn(showSide && "bg-surface-hover text-fg")}
              onClick={() => setShowSide((v) => !v)}
              aria-pressed={showSide}
            >
              <Highlighter />
              {t("reader.highlightsCount", { count: content.data?.highlights.length ?? 0 })}
            </Button>
          </Tooltip>
        </>
      }
    >
      <div className="flex h-full">
        {!s || (s.status === "ready" && !content.data) ? (
          <div className="mx-auto w-full max-w-2xl space-y-3 px-8 py-10">
            <Skeleton className="h-7 w-2/3" />
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className={cn("h-4", i % 3 === 2 ? "w-4/5" : "w-full")} />
            ))}
          </div>
        ) : s.status !== "ready" ? (
          <EmptyState
            className="flex-1"
            icon={<FileQuestion />}
            title={t(`sources.status_${s.status}`)}
            description={s.error ?? undefined}
          />
        ) : editing ? (
          <SourceEditor source={s} text={content.data!.text} onClose={() => setEditing(false)} />
        ) : (
          <>
            {mode !== "original" ? (
              <ParsedText
                notebookId={notebookId}
                sourceId={sourceId}
                sourceTitle={s.title}
                content={content.data!}
                className={mode === "split" ? "border-r border-border" : ""}
              />
            ) : null}
            {mode !== "parsed" ? <OriginalView sourceId={sourceId} kind={s.kind} /> : null}
            {showSide ? (
              <HighlightsSidebar sourceId={sourceId} content={content.data!} summary={s.summary} />
            ) : null}
          </>
        )}
      </div>
    </PanelShell>
  );
}

function OriginalView({ sourceId, kind }: { sourceId: string; kind: string }) {
  const { t } = useTranslation();
  const url = api.sources.fileUrl(sourceId);
  const page = useWorkspace((s) => (s.jump?.sourceId === sourceId ? s.jump : null));
  void page;
  return (
    <div className="min-w-0 flex-1 bg-surface-sunken">
      {kind === "pdf" ? (
        <iframe title="original" src={url} className="size-full border-0" />
      ) : kind === "image" ? (
        <div className="grid h-full place-items-center overflow-auto p-4">
          <img src={url} alt="" className="max-w-full rounded-lg shadow-md" />
        </div>
      ) : kind === "audio" ? (
        <div className="grid h-full place-items-center p-6">
          {/* biome-ignore lint/a11y/useMediaCaption: 转写文本即字幕 */}
          <audio src={url} controls className="w-full max-w-md" />
        </div>
      ) : kind === "video" ? (
        <div className="grid h-full place-items-center p-4">
          {/* biome-ignore lint/a11y/useMediaCaption: 转写文本即字幕 */}
          <video src={url} controls className="max-h-full max-w-full rounded-lg" />
        </div>
      ) : (
        <EmptyState className="h-full" icon={<FileQuestion />} title={t("reader.noOriginal")} />
      )}
    </div>
  );
}

function ParsedText({
  notebookId,
  sourceId,
  sourceTitle,
  content,
  className,
}: {
  notebookId: string;
  sourceId: string;
  sourceTitle: string;
  content: SourceContent;
  className?: string;
}) {
  const paras = useMemo(
    () => paragraphize(content.text, content.pageOffsets),
    [content.text, content.pageOffsets],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const jump = useWorkspace((s) => (s.jump?.sourceId === sourceId ? s.jump : null));
  const [sel, setSel] = useState<ToolbarTarget | null>(null);

  const v = useVirtualizer({
    count: paras.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => Math.max(28, Math.ceil((paras[i]?.text.length ?? 0) / 38) * 30 + 14),
    overscan: 6,
  });

  // 引用跳转：滚动到目标段落并闪烁高亮
  useEffect(() => {
    if (!jump) return;
    const idx = paras.findIndex((p) => jump.start >= p.start && jump.start < p.end + 1);
    if (idx >= 0) v.scrollToIndex(idx, { align: "center" });
    const t = setTimeout(() => {
      // 等虚拟列表测量后再精确定位
      const el = scrollRef.current?.querySelector(".hl-jump");
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 120);
    return () => clearTimeout(t);
  }, [jump, paras, v]);

  const onMouseUp = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-toolbar]")) return;
    const container = scrollRef.current;
    const r = selectionOffsets(container);
    if (!r || !container) {
      // 没有选中文字时点到高亮：对这条高亮弹出同一个工具栏（改颜色、批注、取消高亮）。
      const mark = (e.target as HTMLElement).closest<HTMLElement>("mark[data-hid]");
      const h = mark?.dataset.hid ? content.highlights.find((x) => x.id === mark.dataset.hid) : undefined;
      if (!h || !container) {
        setSel(null);
        return;
      }
      const box = container.getBoundingClientRect();
      const first = container.querySelector(`mark[data-hid="${h.id}"]`) ?? mark!;
      const rect = first.getBoundingClientRect();
      setSel({
        start: h.start,
        end: h.end,
        text: content.text.slice(h.start, h.end),
        x: e.clientX - box.left,
        y: rect.top - box.top + container.scrollTop,
      });
      return;
    }
    const box = container.getBoundingClientRect();
    setSel({
      ...r,
      x: r.rect.left + r.rect.width / 2 - box.left,
      y: r.rect.top - box.top + container.scrollTop,
    });
  };

  const ranges = useMemo(
    () => [
      ...content.highlights.map((h) => ({
        start: h.start,
        end: h.end,
        cls: h.by === "ai" ? "hl-ai" : `hl-${h.color}`,
        id: h.id,
      })),
      ...(jump ? [{ start: jump.start, end: jump.end, cls: "hl-jump", id: undefined }] : []),
    ],
    [content.highlights, jump],
  );

  return (
    <div
      ref={scrollRef}
      className={cn("relative min-w-0 flex-1 overflow-y-auto", className)}
      onMouseUp={onMouseUp}
    >
      <div className="relative mx-auto max-w-[44rem] px-8 py-8" style={{ height: v.getTotalSize() + 64 }}>
        {v.getVirtualItems().map((row) => {
          const p = paras[row.index]!;
          return (
            <div
              key={row.key}
              data-index={row.index}
              ref={v.measureElement}
              className="absolute right-8 left-8"
              style={{ transform: `translateY(${row.start + 32}px)` }}
            >
              <Paragraph para={p} ranges={ranges} sourceId={sourceId} />
            </div>
          );
        })}
      </div>
      {sel ? (
        <SelectionToolbar
          key={`${sel.start}-${sel.end}`}
          notebookId={notebookId}
          sourceId={sourceId}
          sourceTitle={sourceTitle}
          target={sel}
          highlights={content.highlights}
          onDone={() => {
            setSel(null);
            window.getSelection()?.removeAllRanges();
          }}
        />
      ) : null}
    </div>
  );
}

function Paragraph({
  para,
  ranges,
  sourceId,
}: {
  para: Para;
  ranges: { start: number; end: number; cls: string; id?: string }[];
  sourceId: string;
}) {
  const segs = segmentParagraph(para, ranges);
  const H = para.heading ? (`h${Math.min(para.heading, 3) + 1}` as "h2" | "h3" | "h4") : "p";
  return (
    <>
      {para.pageBreak ? (
        <div className="mt-6 mb-5 flex items-center gap-3 text-[11px] font-medium text-fg-subtle select-none">
          <span className="h-px flex-1 bg-border" />第 {para.page} 页
          <span className="h-px flex-1 bg-border" />
        </div>
      ) : null}
      <H
        data-start={para.start}
        data-source={sourceId}
        className={cn(
          "font-serif text-fg",
          para.heading === 1 && "mt-2 mb-3 font-sans text-[26px] font-semibold tracking-tight",
          para.heading === 2 && "mt-6 mb-2 font-sans text-[19px] font-semibold",
          para.heading && para.heading >= 3 && "mt-4 mb-1.5 font-sans text-[16px] font-semibold",
          !para.heading && "mb-3.5 text-[16.5px] leading-[1.85]",
          !para.text.trim() && "h-2",
        )}
      >
        {segs.map((s, i) =>
          s.hidden ? (
            <span key={i} className="hidden">
              {s.text}
            </span>
          ) : s.cls.length ? (
            <mark
              key={i}
              className={cn("hl bg-transparent text-inherit", s.cls)}
              data-hid={s.ids[0]}
              title={s.ids.length ? i18n.t("reader.highlightHint") : undefined}
            >
              {s.text}
            </mark>
          ) : (
            <span key={i}>{s.text}</span>
          ),
        )}
      </H>
    </>
  );
}
