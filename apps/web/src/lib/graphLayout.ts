import { graphlib, layout } from "@dagrejs/dagre";

export interface LayoutNode {
  id: string;
  width: number;
  height: number;
}

/** 用 dagre 计算树/图布局，返回每个节点左上角坐标。 */
export function dagreLayout(
  nodes: LayoutNode[],
  edges: { source: string; target: string }[],
  dir: "LR" | "TB" = "LR",
  gap = { node: 18, rank: 70 },
): Map<string, { x: number; y: number }> {
  const g = new graphlib.Graph();
  g.setGraph({ rankdir: dir, nodesep: gap.node, ranksep: gap.rank, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: n.width, height: n.height });
  for (const e of edges) if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  layout(g);
  const out = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const p = g.node(n.id) as { x: number; y: number } | undefined;
    if (p) out.set(n.id, { x: p.x - n.width / 2, y: p.y - n.height / 2 });
  }
  return out;
}

/** 根据文字长度估算节点宽度（中文按全角计）。 */
export function estimateWidth(label: string, min = 80, max = 260, px = 13.5): number {
  let w = 0;
  for (const ch of label) w += /[　-鿿＀-￯]/.test(ch) ? px : px * 0.58;
  return Math.max(min, Math.min(max, Math.ceil(w + 32)));
}
