import type { Message } from "@quirenote/core";

export interface PathItem {
  message: Message;
  /** 同一父节点下的兄弟（含自己），按时间排序。 */
  siblings: Message[];
  index: number;
}

function childrenMap(messages: Message[]) {
  const map = new Map<string | null, Message[]>();
  for (const m of [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const list = map.get(m.parentId) ?? [];
    list.push(m);
    map.set(m.parentId, list);
  }
  return map;
}

/** 从某节点一路沿"最新的子节点"走到叶子。 */
export function latestLeaf(messages: Message[], fromId: string): string {
  const kids = childrenMap(messages);
  let cur = fromId;
  for (;;) {
    const next = kids.get(cur);
    if (!next?.length) return cur;
    cur = next.at(-1)!.id;
  }
}

/** 计算当前可见的对话路径（根 → activeLeaf）。activeLeaf 缺失时取最新叶子。 */
export function visiblePath(messages: Message[], activeLeafId: string | null): PathItem[] {
  if (!messages.length) return [];
  const byId = new Map(messages.map((m) => [m.id, m]));
  const kids = childrenMap(messages);
  let leaf = activeLeafId && byId.has(activeLeafId) ? activeLeafId : null;
  if (!leaf) {
    const roots = kids.get(null) ?? [];
    if (!roots.length) return [];
    leaf = latestLeaf(messages, roots.at(-1)!.id);
  }
  const chain: Message[] = [];
  for (let cur = byId.get(leaf); cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined)
    chain.unshift(cur);
  return chain.map((m) => {
    const siblings = kids.get(m.parentId) ?? [m];
    return { message: m, siblings, index: siblings.findIndex((s) => s.id === m.id) };
  });
}
