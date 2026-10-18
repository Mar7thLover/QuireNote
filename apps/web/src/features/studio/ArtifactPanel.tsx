import { ARTIFACT_KIND_META, type Artifact, type ArtifactData } from "@quirenote/core";
import { Badge, Button, EmptyState, Skeleton, Spinner, TypingDots, toast } from "@quirenote/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, Download, Quote, SendHorizontal, Sparkles, X } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api";
import { contribute, selectionAt } from "@/lib/contextMenu";
import { metaLabel } from "@/lib/meta";
import { qk, queryClient, upsertInList } from "@/lib/query";
import { useWorkspace } from "@/stores/workspace";
import { artifactToMarkdown } from "./export";
import { artifactSections } from "./menu";
import { MarkdownArtifact } from "./views/MarkdownArtifact";

const MindmapView = lazy(() => import("./views/MindmapView").then((m) => ({ default: m.MindmapView })));
const FlashcardsView = lazy(() =>
  import("./views/FlashcardsView").then((m) => ({ default: m.FlashcardsView })),
);
const QuizView = lazy(() => import("./views/QuizView").then((m) => ({ default: m.QuizView })));
const TimelineView = lazy(() => import("./views/TimelineView").then((m) => ({ default: m.TimelineView })));
const TableView = lazy(() => import("./views/TableView").then((m) => ({ default: m.TableView })));
const SlidesView = lazy(() => import("./views/SlidesView").then((m) => ({ default: m.SlidesView })));
const MediaView = lazy(() => import("./views/MediaView").then((m) => ({ default: m.MediaView })));

export interface ArtifactViewProps<K extends ArtifactData["kind"] = ArtifactData["kind"]> {
  artifact: Artifact;
  data: Extract<ArtifactData, { kind: K }>;
  onChange: (data: ArtifactData) => void;
  notebookId: string;
}

export function ArtifactPanel({ notebookId, artifactId }: { notebookId: string; artifactId: string }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: qk.artifact(artifactId),
    queryFn: () => api.artifacts.get(artifactId),
    refetchInterval: (s) =>
      s.state.data?.status === "generating" || s.state.data?.status === "pending" ? 3000 : false,
  });
  const a = q.data;
  /** 右键「让 AI 修改选中内容」时记下的选区，修改只针对这一段。 */
  const [refineTarget, setRefineTarget] = useState<string | null>(null);
  const panelApi = useWorkspace((s) => s.api);
  useEffect(() => {
    if (a) panelApi?.getPanel(`artifact:${a.id}`)?.api.setTitle(a.title);
  }, [panelApi, a]);

  // 用户手动编辑：防抖保存
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const save = useMutation({
    mutationFn: (patch: { title?: string; data?: ArtifactData }) => api.artifacts.update(artifactId, patch),
    onSuccess: (x) => upsertInList(qk.artifacts(notebookId), x),
  });
  const onChange = (data: ArtifactData) => {
    queryClient.setQueryData<Artifact>(qk.artifact(artifactId), (old) => (old ? { ...old, data } : old));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save.mutate({ data }), 600);
  };

  if (!a) {
    return (
      <div className="space-y-3 p-8">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    );
  }
  const meta = ARTIFACT_KIND_META[a.kind];

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/70 px-3">
        <Badge tone="accent">{metaLabel(meta)}</Badge>
        <input
          key={a.id}
          defaultValue={a.title}
          onBlur={(e) =>
            e.target.value.trim() &&
            e.target.value !== a.title &&
            save.mutate({ title: e.target.value.trim() })
          }
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className="min-w-0 flex-1 truncate rounded-md bg-transparent px-1 py-0.5 text-[14px] font-semibold outline-none hover:bg-surface-hover focus:bg-surface-sunken"
          aria-label="title"
        />
        {save.isPending ? <Spinner className="size-3.5 text-fg-subtle" /> : null}
        {a.data ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              const blob = new Blob([artifactToMarkdown(a)], { type: "text/markdown" });
              const url = URL.createObjectURL(blob);
              const link = document.createElement("a");
              link.href = url;
              link.download = `${a.title}.md`;
              link.click();
              URL.revokeObjectURL(url);
            }}
            aria-label={t("common.export")}
          >
            <Download />
          </Button>
        ) : null}
      </div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 右键菜单是快捷入口，同样的操作都有按钮或快捷键 */}
      <div
        className="relative min-h-0 flex-1 overflow-y-auto"
        onContextMenu={(e) => {
          const text = selectionAt(e.target as Element, e.clientX, e.clientY);
          if (text && a.status === "ready")
            contribute(e, {
              sections: [
                [
                  {
                    id: "art.refineSel",
                    label: t("menu.refineSelection"),
                    icon: Sparkles,
                    onSelect: () => setRefineTarget(text),
                  },
                ],
              ],
            });
          contribute(e, { area: true, sections: artifactSections(notebookId, a, { inPanel: true }) });
        }}
      >
        {a.status === "generating" || a.status === "pending" ? (
          <GeneratingState label={metaLabel(meta)} />
        ) : a.status === "error" || !a.data ? (
          <EmptyState
            className="h-full"
            icon={<AlertCircle />}
            title={t("sources.status_error")}
            description={a.error ?? undefined}
          />
        ) : (
          <Suspense fallback={<div className="skeleton m-6 h-40" />}>
            <ArtifactBody artifact={a} data={a.data} onChange={onChange} notebookId={notebookId} />
          </Suspense>
        )}
      </div>
      {a.status === "ready" ? (
        <RefineBar
          artifact={a}
          notebookId={notebookId}
          target={refineTarget}
          onTargetChange={setRefineTarget}
        />
      ) : null}
    </div>
  );
}

function ArtifactBody(props: ArtifactViewProps) {
  const d = props.data;
  switch (d.kind) {
    case "markdown":
      return <MarkdownArtifact {...props} data={d} />;
    case "mindmap":
      return <MindmapView {...props} data={d} />;
    case "flashcards":
      return <FlashcardsView {...props} data={d} />;
    case "quiz":
      return <QuizView {...props} data={d} />;
    case "timeline":
      return <TimelineView {...props} data={d} />;
    case "table":
      return <TableView {...props} data={d} />;
    case "slides":
      return <SlidesView {...props} data={d} />;
    case "audio":
    case "video":
    case "image":
      return <MediaView {...props} data={d} />;
  }
}

function GeneratingState({ label }: { label: string }) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-2xl space-y-4 px-8 py-12">
      <div className="flex items-center gap-2 text-[13px] text-fg-muted">
        <Sparkles className="size-4 animate-pulse text-accent" />
        {t("studio.generatingKind", { label })}
        <TypingDots className="text-fg-subtle" />
      </div>
      <Skeleton className="h-8 w-2/3" />
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className={i % 3 === 2 ? "h-4 w-3/5" : "h-4 w-full"} />
      ))}
    </div>
  );
}

/** 用自然语言让 AI 修改生成物的一部分（例如"把第二节改成表格""给根节点加三个分支"）。 */
function RefineBar({
  artifact,
  notebookId,
  target,
  onTargetChange,
}: {
  artifact: Artifact;
  notebookId: string;
  /** 右键选定的那段文字；为空时取提交那一刻页面上的选区。 */
  target: string | null;
  onTargetChange: (t: string | null) => void;
}) {
  const { t } = useTranslation();
  const [v, setV] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (target) inputRef.current?.focus();
  }, [target]);
  const refine = useMutation({
    mutationFn: () => {
      const selection = target ?? (window.getSelection()?.toString().trim() || undefined);
      return api.artifacts.refine(artifact.id, v.trim(), selection);
    },
    onSuccess: (a) => {
      queryClient.setQueryData(qk.artifact(a.id), a);
      upsertInList(qk.artifacts(notebookId), a);
      setV("");
      onTargetChange(null);
      toast.success(t("studio.refined"));
    },
  });
  return (
    <form
      className="shrink-0 border-t border-border/70 p-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) refine.mutate();
      }}
    >
      {target ? (
        <div className="mb-1.5 flex items-center gap-1.5 px-1 text-xs text-fg-subtle">
          <Quote className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{target}</span>
          <button
            type="button"
            onClick={() => onTargetChange(null)}
            className="rounded p-0.5 hover:bg-surface-hover hover:text-fg"
            aria-label={t("common.close")}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}
      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 focus-within:border-accent/60 focus-within:ring-3 focus-within:ring-ring/20">
        <Sparkles className="size-4 shrink-0 text-accent" />
        <input
          ref={inputRef}
          value={v}
          onChange={(e) => setV(e.target.value)}
          placeholder={t("studio.refinePlaceholder")}
          disabled={refine.isPending}
          className="h-9 flex-1 bg-transparent text-[13px] outline-none placeholder:text-fg-subtle"
        />
        <Button
          type="submit"
          size="icon-xs"
          variant="ghost"
          loading={refine.isPending}
          disabled={!v.trim()}
          aria-label={t("studio.refine")}
        >
          {refine.isPending ? null : <SendHorizontal />}
        </Button>
      </div>
    </form>
  );
}
