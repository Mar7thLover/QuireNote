import type { LucideIcon } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { create } from "zustand";

/**
 * 右键菜单。
 *
 * 各个区域在自己的 onContextMenu 里「登记」菜单项（`contextMenu(build)`），事件冒泡时由内到外收集；
 * 全局的 ContextMenuHost 在 document 上统一收尾：再补上通用情境（选中文字、链接、图片、输入框），
 * 有内容就弹出自己的菜单，什么都没有就让浏览器显示原生菜单。按住 Shift 右键始终是原生菜单。
 */

export interface MenuItem {
  /** 稳定标识：去重、测试用。 */
  id: string;
  label: string;
  icon?: LucideIcon;
  /** 快捷键提示，例如 "Mod+C"。 */
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  /** 勾选标记（例如当前颜色、已勾选）。 */
  checked?: boolean;
  /** 高亮色块的 class（hl-yellow 等），显示在图标位置。 */
  swatch?: string;
  onSelect?: () => void;
  /** 子菜单。 */
  items?: MenuItem[];
}

/** 一组菜单项；组与组之间画分隔线。 */
export type MenuSection = MenuItem[];

/** 通用情境。区域自己处理过的情境（例如编辑器自带剪贴板操作）不再出现通用菜单。 */
export type GenericKind = "selection" | "link" | "image" | "editable";

export interface Contribution {
  sections: MenuSection[];
  claims?: GenericKind[];
  /** 区域级菜单（面板空白处）：只在没有更具体的菜单时出现。 */
  area?: boolean;
}

const registry = new WeakMap<Event, Contribution[]>();

/** 为这次右键事件登记菜单。内层先登记，排在前面。 */
export function contribute(e: Event | { nativeEvent: Event }, c: Contribution) {
  const native = "nativeEvent" in e ? e.nativeEvent : e;
  const list = registry.get(native) ?? [];
  list.push(c);
  registry.set(native, list);
}

export function contributionsOf(e: Event): Contribution[] {
  return registry.get(e) ?? [];
}

type Built = MenuSection[] | Contribution | null | undefined | false;

/**
 * 生成 onContextMenu 处理函数：右键时调用 build，把结果登记到这次事件上。
 * build 在右键那一刻执行，菜单项可以直接捕获当时的状态（选区、点中的条目）。
 */
export function contextMenu(
  build: (e: ReactMouseEvent) => Built,
  opts: Omit<Contribution, "sections"> = {},
): (e: ReactMouseEvent) => void {
  return (e) => {
    const r = build(e);
    if (!r) return;
    contribute(e, Array.isArray(r) ? { ...opts, sections: r } : { ...opts, ...r });
  };
}

/**
 * 合成最终菜单：通用情境在前（选区、链接、图片、输入框，按情境由小到大），
 * 再接各区域由内到外的菜单；都没有时才用区域级菜单。去掉空组、重复项和空的子菜单。
 */
export function assemble(
  generic: { kind: GenericKind; section: MenuSection }[],
  contributions: Contribution[],
): MenuSection[] {
  const claimed = new Set(contributions.flatMap((c) => c.claims ?? []));
  const specific = [
    ...generic.filter((g) => !claimed.has(g.kind)).map((g) => g.section),
    ...contributions.filter((c) => !c.area).flatMap((c) => c.sections),
  ];
  const sections = clean(specific);
  if (sections.length) return sections;
  return clean(contributions.filter((c) => c.area).flatMap((c) => c.sections));
}

function clean(sections: MenuSection[]): MenuSection[] {
  const seen = new Set<string>();
  const prune = (items: MenuItem[]): MenuItem[] =>
    items.flatMap((it) => {
      if (seen.has(it.id)) return [];
      seen.add(it.id);
      if (it.items) {
        const kids = prune(it.items);
        return kids.length ? [{ ...it, items: kids }] : [];
      }
      return it.onSelect || it.disabled ? [it] : [];
    });
  return sections.map(prune).filter((s) => s.length > 0);
}

// ───────────── 右键位置上的通用情境 ─────────────

export interface TargetContext {
  /** 右键处选中的文字（不含输入框和编辑器里的选区）。 */
  selection: string | null;
  link: { href: string; external: boolean } | null;
  image: { src: string; alt: string } | null;
  field: HTMLInputElement | HTMLTextAreaElement | null;
}

const TEXT_INPUTS = new Set(["text", "search", "url", "email", "tel", "password", "number", ""]);

export function isTextField(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el) return false;
  if (el.tagName === "TEXTAREA") return true;
  return el.tagName === "INPUT" && TEXT_INPUTS.has((el as HTMLInputElement).type);
}

export function targetContext(target: Element, x: number, y: number): TargetContext {
  const fieldEl = target.closest("input, textarea");
  const field = isTextField(fieldEl) ? fieldEl : null;
  const inEditable = !!field || !!target.closest("[contenteditable=true], .ProseMirror");
  const a = inEditable ? null : target.closest<HTMLAnchorElement>("a[href]");
  const img = inEditable ? null : target.closest<HTMLImageElement>("img[src]");
  return {
    selection: inEditable ? null : selectionAt(target, x, y),
    link: a ? linkInfo(a) : null,
    image: img ? { src: img.currentSrc || img.src, alt: img.alt } : null,
    field,
  };
}

function linkInfo(a: HTMLAnchorElement): TargetContext["link"] {
  const href = a.href;
  if (!href || href.startsWith("javascript:")) return null;
  let external = false;
  try {
    const u = new URL(href);
    external = /^https?:$/.test(u.protocol) && u.origin !== window.location.origin;
  } catch {
    return null;
  }
  return { href, external };
}

/** 右键点在选中文字上才算：点到选区外面时浏览器的选区还在，但用户想操作的不是它。 */
export function selectionAt(target: Element, x: number, y: number): string | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const text = sel.toString().trim();
  if (!text) return null;
  const range = sel.getRangeAt(0);
  const rects = typeof range.getClientRects === "function" ? [...range.getClientRects()] : [];
  const pointer = x !== 0 || y !== 0;
  if (pointer && rects.length) {
    const hit = rects.some((r) => x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2);
    return hit ? text : null;
  }
  return range.intersectsNode(target) || target === document.body ? text : null;
}

// ───────────── 打开状态 ─────────────

interface MenuState {
  open: boolean;
  /** 每次打开递增，菜单按新位置重新挂载。 */
  key: number;
  x: number;
  y: number;
  sections: MenuSection[];
  /** 打开前的焦点：执行菜单项或按 Esc 关闭后还给它（输入框、编辑器）。 */
  restore: Element | null;
  show: (p: { x: number; y: number; sections: MenuSection[]; restore: Element | null }) => void;
  close: () => void;
}

export const useContextMenuState = create<MenuState>()((set) => ({
  open: false,
  key: 0,
  x: 0,
  y: 0,
  sections: [],
  restore: null,
  show: (p) => set((s) => ({ ...p, open: true, key: s.key + 1 })),
  close: () => set({ open: false }),
}));
