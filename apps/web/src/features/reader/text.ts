export interface Para {
  /** 段落在全文中的起始偏移（含 markdown 前缀）。 */
  start: number;
  end: number;
  text: string;
  page: number;
  pageBreak: boolean;
  /** markdown 标题级别，非标题为 0。 */
  heading: number;
  /** 需要隐藏的前缀长度（如 "## "）。 */
  prefix: number;
}

/** 按换行和分页符切段，保留每段的字符偏移与页码。 */
export function paragraphize(text: string, pageOffsets: number[]): Para[] {
  const out: Para[] = [];
  const re = /[\n\f]/g;
  let start = 0;
  let pageIdx = 0;
  let lastPage = 1;
  const push = (end: number) => {
    const t = text.slice(start, end);
    while (pageIdx + 1 < pageOffsets.length && pageOffsets[pageIdx + 1]! <= start) pageIdx++;
    const page = pageIdx + 1;
    const m = /^(#{1,6})\s+/.exec(t);
    // 连续空行只保留一个
    if (t.trim() || (out.length && out.at(-1)!.text.trim())) {
      out.push({
        start,
        end,
        text: t,
        page,
        pageBreak: page !== lastPage,
        heading: m ? m[1]!.length : 0,
        prefix: m ? m[0].length : 0,
      });
      lastPage = page;
    }
  };
  for (let m = re.exec(text); m; m = re.exec(text)) {
    push(m.index);
    start = m.index + 1;
  }
  push(text.length);
  return out;
}

export interface Segment {
  text: string;
  cls: string[];
  ids: string[];
  hidden: boolean;
}

/** 把段落按高亮区间切成若干片段，重叠区间的样式叠加。 */
export function segmentParagraph(
  p: Para,
  ranges: { start: number; end: number; cls: string; id?: string }[],
): Segment[] {
  const local = ranges
    .filter((r) => r.end > p.start && r.start < p.end)
    .map((r) => ({ ...r, s: Math.max(0, r.start - p.start), e: Math.min(p.text.length, r.end - p.start) }));
  const cuts = new Set<number>([0, p.text.length, p.prefix]);
  for (const r of local) {
    cuts.add(r.s);
    cuts.add(r.e);
  }
  const pts = [...cuts].filter((x) => x >= 0 && x <= p.text.length).sort((a, b) => a - b);
  const segs: Segment[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (a === b) continue;
    const cover = local.filter((r) => r.s <= a && r.e >= b);
    segs.push({
      text: p.text.slice(a, b),
      cls: cover.map((r) => r.cls),
      ids: cover.map((r) => r.id).filter((x): x is string => !!x),
      hidden: b <= p.prefix,
    });
  }
  return segs;
}

/** 计算节点在段落元素内的字符偏移（包括隐藏的前缀文本）。 */
function offsetWithin(block: Element, node: Node, offset: number): number {
  // 用 Range 量出「段落开头 → 选区端点」之间的文本长度。端点落在元素上（选中整个高亮、三击选段落等）
  // 时 offset 是子节点下标，逐个文本节点累加的写法会漏掉元素之前的文字。
  const r = document.createRange();
  r.selectNodeContents(block);
  r.setEnd(node, offset);
  return r.toString().length;
}

/** 当前选区在全文中的偏移。不在容器内或为空时返回 null。 */
export function selectionOffsets(
  container: HTMLElement | null,
): { start: number; end: number; text: string; rect: DOMRect } | null {
  const sel = window.getSelection();
  if (!container || !sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  const blockOf = (n: Node) =>
    (n.nodeType === Node.ELEMENT_NODE ? (n as Element) : n.parentElement)?.closest("[data-start]");
  const sb = blockOf(range.startContainer);
  const eb = blockOf(range.endContainer);
  if (!sb || !eb) return null;
  const start =
    Number(sb.getAttribute("data-start")) + offsetWithin(sb, range.startContainer, range.startOffset);
  const end = Number(eb.getAttribute("data-start")) + offsetWithin(eb, range.endContainer, range.endOffset);
  const text = sel.toString().trim();
  if (!text || end <= start) return null;
  return { start, end, text, rect: range.getBoundingClientRect() };
}
