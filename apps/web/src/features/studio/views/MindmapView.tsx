import "@xyflow/react/dist/style.css";
import { type MindmapNode, newId } from "@folio/core";
import { Button, cn, Tooltip } from "@folio/ui";
import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import { ChevronRight, Plus, Trash2 } from "lucide-react";
import { createContext, memo, useContext, useEffect, useMemo, useState } from "react";
import { dagreLayout, estimateWidth } from "@/lib/graphLayout";
import type { ArtifactViewProps } from "../ArtifactPanel";

interface Ctx {
  update: (id: string, patch: Partial<MindmapNode>) => void;
  addChild: (id: string) => void;
  remove: (id: string) => void;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  childCount: (id: string) => number;
}
const MindCtx = createContext<Ctx | null>(null);

const DEPTH_HUE = [272, 300, 200, 152, 40, 10];

type MindNodeData = { node: MindmapNode; depth: number };

const MindNode = memo(function MindNode({ data, selected }: NodeProps<Node<MindNodeData>>) {
  const ctx = useContext(MindCtx)!;
  const { node, depth } = data;
  const hue = DEPTH_HUE[depth % DEPTH_HUE.length]!;
  const editing = ctx.editingId === node.id;
  const kids = ctx.childCount(node.id);
  return (
    <div
      className={cn(
        "group relative rounded-lg border px-3 py-1.5 text-[13.5px] shadow-sm transition-shadow",
        depth === 0 ? "font-semibold text-[15px]" : "font-medium",
        selected && "shadow-md ring-2 ring-accent/50",
      )}
      style={{
        background:
          depth === 0
            ? `oklch(0.55 0.17 ${hue})`
            : `color-mix(in srgb, oklch(0.75 0.12 ${hue}) 16%, var(--surface))`,
        borderColor: `oklch(0.7 0.12 ${hue} / 0.5)`,
        color: depth === 0 ? "white" : "var(--fg)",
      }}
      onDoubleClick={() => ctx.setEditingId(node.id)}
    >
      <Handle type="target" position={Position.Left} className="!size-1.5 !border-0 !bg-transparent" />
      {editing ? (
        <input
          autoFocus
          defaultValue={node.label}
          className="nodrag w-full min-w-24 bg-transparent outline-none"
          onBlur={(e) => {
            ctx.update(node.id, { label: e.target.value.trim() || node.label });
            ctx.setEditingId(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") ctx.setEditingId(null);
            e.stopPropagation();
          }}
        />
      ) : (
        <span className="block whitespace-normal">{node.label}</span>
      )}
      <Handle type="source" position={Position.Right} className="!size-1.5 !border-0 !bg-transparent" />
      {kids > 0 ? (
        <button
          type="button"
          className="nodrag absolute top-1/2 -right-3 grid size-5 -translate-y-1/2 place-items-center rounded-full border border-border bg-surface text-[10px] text-fg-muted shadow-sm hover:text-fg"
          onClick={(e) => {
            e.stopPropagation();
            ctx.update(node.id, { collapsed: !node.collapsed });
          }}
          aria-label="toggle"
        >
          {node.collapsed ? kids : <ChevronRight className="size-3 rotate-180" />}
        </button>
      ) : null}
      {selected && !editing ? (
        <div className="nodrag absolute -top-9 left-1/2 flex -translate-x-1/2 gap-0.5 rounded-md border border-border bg-surface-raised p-0.5 shadow-md">
          <Tooltip content="添加子节点 (Tab)">
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => ctx.addChild(node.id)}
              aria-label="add child"
            >
              <Plus />
            </Button>
          </Tooltip>
          {depth > 0 ? (
            <Tooltip content="删除 (Delete)">
              <Button size="icon-xs" variant="ghost" onClick={() => ctx.remove(node.id)} aria-label="delete">
                <Trash2 />
              </Button>
            </Tooltip>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

const nodeTypes = { mind: MindNode };

export function MindmapView(props: ArtifactViewProps<"mindmap">) {
  return (
    <ReactFlowProvider>
      <Mindmap {...props} />
    </ReactFlowProvider>
  );
}

function Mindmap({ data, onChange }: ArtifactViewProps<"mindmap">) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const flow = useReactFlow();
  const nodes = data.nodes;

  const { rfNodes, rfEdges } = useMemo(() => {
    const kids = new Map<string | null, MindmapNode[]>();
    for (const n of nodes) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n]);
    const visible: { n: MindmapNode; depth: number }[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const n of kids.get(parent) ?? []) {
        visible.push({ n, depth });
        if (!n.collapsed) walk(n.id, depth + 1);
      }
    };
    walk(null, 0);
    const sized = visible.map(({ n, depth }) => ({
      id: n.id,
      width: estimateWidth(n.label, 70, 240, depth === 0 ? 15 : 13.5),
      height: 36,
    }));
    const edges = visible.filter((v) => v.n.parentId).map((v) => ({ source: v.n.parentId!, target: v.n.id }));
    const pos = dagreLayout(sized, edges, "LR", { node: 14, rank: 64 });
    const rfNodes: Node<MindNodeData>[] = visible.map(({ n, depth }) => ({
      id: n.id,
      type: "mind",
      position: pos.get(n.id) ?? { x: 0, y: 0 },
      data: { node: n, depth },
      selected: n.id === selectedId,
    }));
    const rfEdges: Edge[] = edges.map((e) => ({
      id: `${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      type: "default",
      style: { stroke: "var(--border-strong)", strokeWidth: 1.5 },
    }));
    return { rfNodes, rfEdges };
  }, [nodes, selectedId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 首次加载适配视图
  useEffect(() => {
    const t = setTimeout(() => flow.fitView({ padding: 0.15, duration: 300 }), 50);
    return () => clearTimeout(t);
  }, [nodes.length]);

  const ctx: Ctx = {
    editingId,
    setEditingId,
    childCount: (id) => nodes.filter((n) => n.parentId === id).length,
    update: (id, patch) =>
      onChange({ kind: "mindmap", nodes: nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }),
    addChild: (id) => {
      const child: MindmapNode = {
        id: newId("mn"),
        label: "新节点",
        note: "",
        parentId: id,
        collapsed: false,
      };
      onChange({
        kind: "mindmap",
        nodes: nodes.map((n) => (n.id === id ? { ...n, collapsed: false } : n)).concat(child),
      });
      setSelectedId(child.id);
      setEditingId(child.id);
    },
    remove: (id) => {
      const drop = new Set([id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const n of nodes)
          if (n.parentId && drop.has(n.parentId) && !drop.has(n.id)) {
            drop.add(n.id);
            grew = true;
          }
      }
      onChange({ kind: "mindmap", nodes: nodes.filter((n) => !drop.has(n.id)) });
      setSelectedId(null);
    },
  };

  return (
    <MindCtx.Provider value={ctx}>
      <div
        className="absolute inset-0"
        onKeyDown={(e) => {
          if (!selectedId || editingId) return;
          if (e.key === "Tab") {
            e.preventDefault();
            ctx.addChild(selectedId);
          } else if (e.key === "Enter" || e.key === "F2") {
            e.preventDefault();
            setEditingId(selectedId);
          } else if (e.key === "Delete" || e.key === "Backspace") {
            const n = nodes.find((x) => x.id === selectedId);
            if (n?.parentId) ctx.remove(selectedId);
          }
        }}
      >
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          onNodeClick={(_, n) => setSelectedId(n.id)}
          onPaneClick={() => setSelectedId(null)}
          nodesDraggable={false}
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
          minZoom={0.2}
          fitView
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--border-strong)" />
          <Controls
            showInteractive={false}
            className="!rounded-lg !border !border-border !shadow-sm [&_button]:!border-border [&_button]:!bg-surface [&_button]:!fill-fg-muted"
          />
        </ReactFlow>
        <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-surface/80 px-3 py-1 text-[11px] text-fg-subtle backdrop-blur">
          双击编辑 · Tab 添加子节点 · Delete 删除 · 底部输入框可让 AI 扩展分支
        </p>
      </div>
    </MindCtx.Provider>
  );
}
