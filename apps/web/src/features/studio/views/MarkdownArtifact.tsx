import { FolioEditor } from "@/features/editor/FolioEditor";
import type { ArtifactViewProps } from "../ArtifactPanel";

/** 文稿类生成物（报告、简报、学习指南、FAQ、信息图）：直接在块编辑器里编辑。 */
export function MarkdownArtifact({ artifact, data, onChange, notebookId }: ArtifactViewProps<"markdown">) {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 pt-8 pb-24 sm:px-12">
      <FolioEditor
        key={artifact.updatedAt}
        notebookId={notebookId}
        initialDoc={null}
        initialMarkdown={data.markdown}
        onChange={({ markdown }) => onChange({ kind: "markdown", markdown })}
      />
    </div>
  );
}
