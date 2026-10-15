import type { AgentOp, Note } from "@folio/core";
import { ELEMENT_TYPE_META } from "@folio/core";
import { Badge, Button, cn, Dialog, DialogContent, Tag, toast } from "@folio/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FilePlus2, FileX2, GitBranchPlus, PencilLine, Sparkles, Table, Tags } from "lucide-react";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api";
import { collapseContext, diffLines } from "@/lib/diff";
import { qk, queryClient } from "@/lib/query";
import { useUi } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";

/** Agent 改动预览：所有 AI 发起的写操作都先在这里以 diff 呈现，确认后才落库，并可撤销。 */
export function AgentDiffDialog() {
  const { t } = useTranslation();
  const pending = useUi((s) => s.proposal);
  const set = useUi((s) => s.set);
  const close = () => set({ proposal: null });

  const apply = useMutation({
    mutationFn: () => api.ai.apply(pending!.notebookId, pending!.proposal),
    onSuccess: (res) => {
      const nb = pending!.notebookId;
      invalidateNotebook(nb);
      close();
      const created = res.applied.find((a) => a.op === "create_note" || a.op === "create_table");
      if (created) useWorkspace.getState().open({ kind: "note", id: created.id });
      toast.success(t("agent.applied", { count: res.applied.length }), {
        duration: 8000,
        action: {
          label: t("common.undo"),
          onClick: () =>
            api.ai.undo(res.undoToken).then(() => {
              invalidateNotebook(nb);
              toast(t("agent.undone"));
            }),
        },
      });
    },
  });

  return (
    <Dialog open={!!pending} onOpenChange={(o) => !o && close()}>
      <DialogContent title={t("agent.title")} description={t("agent.desc")} className="max-w-2xl">
        {pending ? (
          <div className="px-5 pb-5">
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-accent-soft px-3 py-2.5 text-[13px] text-accent-soft-fg">
              <Sparkles className="mt-0.5 size-4 shrink-0" />
              <span>{pending.proposal.summary}</span>
            </div>
            <div className="max-h-[52vh] space-y-3 overflow-y-auto pr-1">
              {pending.proposal.ops.map((op, i) => (
                <OpPreview key={i} op={op} />
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={close}>
                {t("agent.reject")}
              </Button>
              <Button variant="primary" onClick={() => apply.mutate()} loading={apply.isPending} autoFocus>
                {t("agent.accept")}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function invalidateNotebook(nb: string) {
  for (const key of [qk.notes(nb), qk.elements(nb), qk.artifacts(nb), qk.sources(nb)]) {
    queryClient.invalidateQueries({ queryKey: key });
  }
  queryClient.invalidateQueries({ queryKey: ["note"] });
  queryClient.invalidateQueries({ queryKey: ["artifact"] });
}

const OP_ICON = {
  create_note: FilePlus2,
  update_note: PencilLine,
  delete_note: FileX2,
  create_table: Table,
  add_mindmap_node: GitBranchPlus,
  create_element: Tags,
} as const;

function OpPreview({ op }: { op: AgentOp }) {
  const { t } = useTranslation();
  const Icon = OP_ICON[op.op];
  const tone = op.op === "delete_note" ? "danger" : op.op === "update_note" ? "warning" : "success";
  const title =
    "title" in op && op.title
      ? op.title
      : op.op === "create_element"
        ? op.name
        : op.op === "add_mindmap_node"
          ? op.label
          : "";
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border bg-surface-sunken/60 px-3 py-2">
        <Icon className="size-4 text-fg-subtle" />
        <Badge tone={tone}>{t(`agent.op_${op.op}`)}</Badge>
        <span className="truncate text-[13px] font-medium">{title}</span>
      </div>
      <OpBody op={op} />
    </div>
  );
}

function OpBody({ op }: { op: AgentOp }) {
  switch (op.op) {
    case "create_note":
      return <DiffView before="" after={op.markdown} />;
    case "update_note":
      return <UpdateNoteDiff noteId={op.noteId} after={op.markdown} />;
    case "delete_note":
      return <DeleteNotePreview noteId={op.noteId} />;
    case "create_table":
      return (
        <div className="max-h-64 overflow-auto p-2">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {op.table.columns.map((c) => (
                  <th
                    key={c.id}
                    className="border border-border bg-success-soft/50 px-2 py-1 text-left font-semibold"
                  >
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {op.table.rows.map((r, i) => (
                <tr key={i}>
                  {op.table.columns.map((c) => (
                    <td key={c.id} className="border border-border bg-success-soft/20 px-2 py-1 align-top">
                      {String(r[c.id] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "add_mindmap_node":
      return <div className="bg-success-soft/30 px-3 py-2 text-[13px]">+ {op.label}</div>;
    case "create_element":
      return (
        <div className="space-y-1 bg-success-soft/30 px-3 py-2 text-[13px]">
          <Tag color={ELEMENT_TYPE_META[op.type].color}>{ELEMENT_TYPE_META[op.type].label}</Tag>
          <p className="text-fg-muted">{op.definition}</p>
        </div>
      );
  }
}

function UpdateNoteDiff({ noteId, after }: { noteId: string; after: string }) {
  const note = useQuery({ queryKey: qk.note(noteId), queryFn: () => api.notes.get(noteId) });
  if (!note.data) return <div className="skeleton m-3 h-16" />;
  return <DiffView before={note.data.markdown} after={after} />;
}

function DeleteNotePreview({ noteId }: { noteId: string }) {
  const note = useQuery<Note>({ queryKey: qk.note(noteId), queryFn: () => api.notes.get(noteId) });
  return <DiffView before={note.data?.markdown ?? ""} after="" />;
}

export function DiffView({ before, after }: { before: string; after: string }) {
  const lines = collapseContext(diffLines(before, after), 3);
  return (
    <pre className="max-h-72 overflow-auto py-1.5 font-mono text-[12px] leading-[1.65]">
      {lines.map((l, i) =>
        l.type === "gap" ? (
          <div key={i} className="px-3 text-fg-subtle select-none">
            ⋯ {l.count} 行未改动
          </div>
        ) : (
          <div
            key={i}
            className={cn(
              "flex gap-2 px-3 whitespace-pre-wrap",
              l.type === "add" && "bg-success-soft/60 text-fg",
              l.type === "del" && "bg-danger-soft/60 text-fg-muted line-through decoration-danger/40",
            )}
          >
            <span className="w-3 shrink-0 text-fg-subtle select-none">
              {l.type === "add" ? "+" : l.type === "del" ? "−" : " "}
            </span>
            <span>{l.text || " "}</span>
          </div>
        ),
      )}
    </pre>
  );
}
