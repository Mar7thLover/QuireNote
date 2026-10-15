import { EmptyState } from "@folio/ui";
import type { IDockviewPanelProps } from "dockview-react";
import { Construction } from "lucide-react";
import { type ComponentType, lazy, Suspense, useEffect } from "react";
import { useTranslation } from "@/i18n";
import type { PanelKind, PanelParams } from "@/stores/workspace";
import { ChatPanel } from "./chat/ChatPanel";
import { ReaderPanel } from "./reader/ReaderPanel";
import { SourcesPanel } from "./sources/SourcesPanel";

const NotesPanel = lazy(() => import("./notes/NotesPanel").then((m) => ({ default: m.NotesPanel })));
const NoteEditorPanel = lazy(() =>
  import("./notes/NoteEditorPanel").then((m) => ({ default: m.NoteEditorPanel })),
);
const StudioPanel = lazy(() => import("./studio/StudioPanel").then((m) => ({ default: m.StudioPanel })));
const ArtifactPanel = lazy(() =>
  import("./studio/ArtifactPanel").then((m) => ({ default: m.ArtifactPanel })),
);
const ElementsPanel = lazy(() =>
  import("./elements/ElementsPanel").then((m) => ({ default: m.ElementsPanel })),
);
const DatabasePanel = lazy(() =>
  import("./database/DatabasePanel").then((m) => ({ default: m.DatabasePanel })),
);
const ReviewPanel = lazy(() => import("./review/ReviewPanel").then((m) => ({ default: m.ReviewPanel })));
const SearchPanel = lazy(() => import("./search/SearchPanel").then((m) => ({ default: m.SearchPanel })));

export interface PanelBodyProps {
  notebookId: string;
  id?: string;
  extra?: Record<string, unknown>;
}

/** 面板内容组件：dockview 和移动端布局共用。 */
export const PANEL_BODIES: Record<PanelKind, ComponentType<PanelBodyProps>> = {
  sources: ({ notebookId }) => <SourcesPanel notebookId={notebookId} />,
  reader: ({ notebookId, id }) => <ReaderPanel notebookId={notebookId} sourceId={id!} />,
  chat: ({ notebookId, extra }) => (
    <ChatPanel notebookId={notebookId} onlySource={extra?.onlySource as string | undefined} />
  ),
  notes: ({ notebookId }) => <NotesPanel notebookId={notebookId} />,
  note: ({ notebookId, id }) => <NoteEditorPanel notebookId={notebookId} noteId={id!} />,
  studio: ({ notebookId }) => <StudioPanel notebookId={notebookId} />,
  artifact: ({ notebookId, id }) => <ArtifactPanel notebookId={notebookId} artifactId={id!} />,
  elements: ({ notebookId, extra }) => (
    <ElementsPanel notebookId={notebookId} focus={extra?.focus as string | undefined} />
  ),
  database: ({ notebookId }) => <DatabasePanel notebookId={notebookId} />,
  review: ({ notebookId }) => <ReviewPanel notebookId={notebookId} />,
  search: ({ notebookId }) => <SearchPanel notebookId={notebookId} />,
};

export function PanelFallback() {
  return (
    <div className="space-y-3 p-4">
      <div className="skeleton h-5 w-1/3" />
      <div className="skeleton h-4 w-full" />
      <div className="skeleton h-4 w-2/3" />
    </div>
  );
}

export function NotImplemented() {
  return <EmptyState className="h-full" icon={<Construction />} title="即将推出" />;
}

function makeDockPanel(kind: PanelKind) {
  const Body = PANEL_BODIES[kind];
  return function DockPanel(props: IDockviewPanelProps<PanelParams>) {
    const { t } = useTranslation();
    const { notebookId, id, extra } = props.params;
    // 固定面板的标题跟随语言
    useEffect(() => {
      if (!id) props.api.setTitle(t(`nav.${kind}`));
    }, [id, t, props.api]);
    return (
      <Suspense fallback={<PanelFallback />}>
        <Body notebookId={notebookId} id={id} extra={extra} />
      </Suspense>
    );
  };
}

export const PANEL_COMPONENTS = Object.fromEntries(
  (Object.keys(PANEL_BODIES) as PanelKind[]).map((k) => [k, makeDockPanel(k)]),
) as Record<PanelKind, ComponentType<IDockviewPanelProps<PanelParams>>>;
