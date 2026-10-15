import "@xyflow/react/dist/style.css";
import { ELEMENT_TYPE_META, type Element } from "@folio/core";
import { tagColor } from "@folio/ui";
import { Background, BackgroundVariant, Controls, type Edge, type Node, ReactFlow } from "@xyflow/react";
import { useMemo } from "react";
import { dagreLayout, estimateWidth } from "@/lib/graphLayout";

/** 元素关系图：边来自元素间的 relations；孤立元素按类型分组排在一起。 */
export function ElementGraph({
  elements,
  onOpen,
  activeId,
}: {
  elements: Element[];
  onOpen: (id: string) => void;
  activeId: string | null;
}) {
  const { nodes, edges } = useMemo(() => {
    const ids = new Set(elements.map((e) => e.id));
    const edges = elements.flatMap((e) =>
      e.relations
        .filter((r) => ids.has(r.targetId))
        .map((r) => ({ source: e.id, target: r.targetId, label: r.label })),
    );
    // 没有关系时按类型串成浅色虚边，避免节点堆成一排
    if (edges.length === 0) {
      const byType = new Map<string, Element[]>();
      for (const e of elements) byType.set(e.type, [...(byType.get(e.type) ?? []), e]);
      for (const group of byType.values())
        for (let i = 1; i < group.length; i++)
          edges.push({ source: group[0]!.id, target: group[i]!.id, label: "" });
    }
    const sized = elements.map((e) => ({ id: e.id, width: estimateWidth(e.name, 60, 200), height: 34 }));
    const pos = dagreLayout(sized, edges, "LR", { node: 12, rank: 90 });
    const nodes: Node[] = elements.map((e) => {
      const c = tagColor(ELEMENT_TYPE_META[e.type].color);
      return {
        id: e.id,
        position: pos.get(e.id) ?? { x: 0, y: 0 },
        data: { label: e.name },
        style: {
          width: sized.find((s) => s.id === e.id)!.width,
          borderRadius: 8,
          border: `1.5px solid ${c}`,
          background: `color-mix(in srgb, ${c} ${e.id === activeId ? 26 : 10}%, var(--surface))`,
          color: "var(--fg)",
          fontSize: 13,
          fontWeight: 500,
          padding: "6px 10px",
          boxShadow: e.id === activeId ? "var(--shadow-md)" : "none",
        },
        sourcePosition: "right" as never,
        targetPosition: "left" as never,
      };
    });
    const rfEdges: Edge[] = edges.map((e, i) => ({
      id: `e${i}`,
      source: e.source,
      target: e.target,
      label: e.label || undefined,
      labelStyle: { fontSize: 11, fill: "var(--fg-muted)" },
      labelBgStyle: { fill: "var(--surface)" },
      style: { stroke: "var(--border-strong)", strokeDasharray: e.label ? undefined : "4 4" },
    }));
    return { nodes, edges: rfEdges };
  }, [elements, activeId]);

  return (
    <div className="absolute inset-0">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodeClick={(_, n) => onOpen(n.id)}
        fitView
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
        minZoom={0.2}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--border-strong)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
