import type { DockviewApi, SerializedDockview } from "dockview-react";
import { create } from "zustand";

/** 工作区里可以打开的面板类型。带 id 的面板可以同时开多个（标签页）。 */
export type PanelKind =
  | "sources"
  | "reader"
  | "chat"
  | "notes"
  | "note"
  | "studio"
  | "artifact"
  | "elements"
  | "database"
  | "review"
  | "search"
  | "lorebook"
  | "writing";

export interface PanelSpec {
  kind: PanelKind;
  id?: string;
  title?: string;
  /** 打开后附加的参数，例如阅读器要跳转的偏移。 */
  extra?: Record<string, unknown>;
}

export interface PanelParams {
  notebookId: string;
  id?: string;
  extra?: Record<string, unknown>;
}

export const panelId = (s: Pick<PanelSpec, "kind" | "id">) => (s.id ? `${s.kind}:${s.id}` : s.kind);

/** 每类面板的默认停靠位置：左侧工具栏 / 中间编辑区 / 右侧助手区。 */
const ZONE: Record<PanelKind, "left" | "center" | "right"> = {
  sources: "left",
  notes: "left",
  elements: "left",
  search: "left",
  reader: "center",
  note: "center",
  artifact: "center",
  database: "center",
  review: "center",
  lorebook: "center",
  writing: "center",
  chat: "right",
  studio: "right",
};

interface WorkspaceState {
  api: DockviewApi | null;
  notebookId: string | null;
  /** 阅读器跳转请求：被对应 ReaderPanel 消费。 */
  jump: { sourceId: string; start: number; end: number; nonce: number } | null;
  setApi: (api: DockviewApi | null, notebookId: string | null) => void;
  open: (spec: PanelSpec) => void;
  close: (spec: Pick<PanelSpec, "kind" | "id">) => void;
  jumpTo: (sourceId: string, start: number, end: number) => void;
}

export const useWorkspace = create<WorkspaceState>()((set, get) => ({
  api: null,
  notebookId: null,
  jump: null,
  setApi: (api, notebookId) => set({ api, notebookId }),
  open: (spec) => {
    const { api, notebookId } = get();
    if (!api || !notebookId) {
      mobileOpen?.(spec);
      return;
    }
    const id = panelId(spec);
    const existing = api.getPanel(id);
    if (existing) {
      if (spec.extra) existing.api.updateParameters({ notebookId, id: spec.id, extra: spec.extra });
      existing.api.setActive();
      return;
    }
    const zone = ZONE[spec.kind];
    // 找同区域里已有的面板，作为参照放进同一组
    const sibling = api.panels.find((p) => ZONE[p.id.split(":")[0] as PanelKind] === zone);
    const params: PanelParams = { notebookId, id: spec.id, extra: spec.extra };
    const base = { id, component: spec.kind, title: spec.title ?? spec.kind, params };
    if (sibling) {
      api.addPanel({ ...base, position: { referenceGroup: sibling.group, direction: "within" } });
    } else if (zone === "center") {
      // 新开中间区域时，把独占一列的 Studio 并进对话所在的组，保持三列，避免中间过窄
      const chat = api.getPanel("chat");
      const studio = api.getPanel("studio");
      if (chat && studio && chat.group !== studio.group && studio.group.panels.length === 1) {
        studio.api.moveTo({ group: chat.group, position: "center", skipSetActive: true });
        chat.api.setActive();
      }
      const left = api.panels.find((p) => ZONE[p.id.split(":")[0] as PanelKind] === "left");
      const right = api.panels.find((p) => ZONE[p.id.split(":")[0] as PanelKind] === "right");
      if (left) {
        api.addPanel({ ...base, position: { referenceGroup: left.group, direction: "right" } });
        left.group.api.setSize({ width: 300 });
      } else if (right)
        api.addPanel({ ...base, position: { referenceGroup: right.group, direction: "left" } });
      else api.addPanel(base);
    } else {
      api.addPanel({
        ...base,
        position: { direction: zone === "left" ? "left" : "right" },
        initialWidth: zone === "left" ? 300 : 420,
      });
    }
  },
  close: (spec) => {
    const p = get().api?.getPanel(panelId(spec));
    if (p) p.api.close();
  },
  jumpTo: (sourceId, start, end) => {
    set({ jump: { sourceId, start, end, nonce: Date.now() } });
    get().open({ kind: "reader", id: sourceId });
  },
}));

/** 移动端没有 dockview，由移动布局注册打开面板的方式。 */
let mobileOpen: ((spec: PanelSpec) => void) | null = null;
export function registerMobileOpen(fn: ((spec: PanelSpec) => void) | null) {
  mobileOpen = fn;
}

// ───────────── 布局预设 ─────────────
export type PresetId = "research" | "write" | "study" | "focus";

export function applyPreset(api: DockviewApi, nb: string, preset: PresetId, t: (k: string) => string) {
  api.clear();
  const p = (kind: PanelKind) => ({
    id: kind,
    component: kind,
    title: t(`nav.${kind}`),
    params: { notebookId: nb },
  });
  if (preset === "focus") {
    api.addPanel(p("chat"));
    return;
  }
  if (preset === "research") {
    api.addPanel(p("sources"));
    api.addPanel({ ...p("chat"), position: { referencePanel: "sources", direction: "right" } });
    api.addPanel({ ...p("studio"), position: { referencePanel: "chat", direction: "right" } });
    api.addPanel({
      ...p("notes"),
      position: { referencePanel: "sources", direction: "within" },
      inactive: true,
    });
    sizeColumns(api, [300, null, 360]);
    return;
  }
  if (preset === "write") {
    api.addPanel(p("notes"));
    api.addPanel({ ...p("database"), position: { referencePanel: "notes", direction: "right" } });
    api.addPanel({ ...p("chat"), position: { referencePanel: "database", direction: "right" } });
    api.addPanel({
      ...p("sources"),
      position: { referencePanel: "notes", direction: "within" },
      inactive: true,
    });
    sizeColumns(api, [280, null, 400]);
    return;
  }
  // study
  api.addPanel(p("elements"));
  api.addPanel({ ...p("review"), position: { referencePanel: "elements", direction: "right" } });
  api.addPanel({ ...p("studio"), position: { referencePanel: "review", direction: "right" } });
  sizeColumns(api, [320, null, 380]);
}

function sizeColumns(api: DockviewApi, widths: (number | null)[]) {
  api.groups.forEach((g, i) => {
    const w = widths[i];
    if (w) g.api.setSize({ width: w });
  });
}

const LAYOUT_KEY = (nb: string) => `quirenote.layout.${nb}`;
const PRESETS_KEY = "quirenote.layout-presets";

export function saveLayout(nb: string, layout: SerializedDockview) {
  try {
    localStorage.setItem(LAYOUT_KEY(nb), JSON.stringify(layout));
  } catch {}
}
export function loadLayout(nb: string): SerializedDockview | null {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY(nb));
    return raw ? (JSON.parse(raw) as SerializedDockview) : null;
  } catch {
    return null;
  }
}

export interface CustomPreset {
  name: string;
  layout: SerializedDockview;
}
export function loadCustomPresets(): CustomPreset[] {
  try {
    return JSON.parse(localStorage.getItem(PRESETS_KEY) ?? "[]") as CustomPreset[];
  } catch {
    return [];
  }
}
export function saveCustomPresets(list: CustomPreset[]) {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(list));
  } catch {}
}

/** 自定义预设跨 Notebook 复用：把面板参数里的 notebookId 换成当前的。 */
export function retargetLayout(layout: SerializedDockview, nb: string): SerializedDockview {
  const panels = Object.fromEntries(
    Object.entries(layout.panels).map(([k, v]) => [
      k,
      { ...v, params: { ...(v.params as object | undefined), notebookId: nb } },
    ]),
  );
  return { ...layout, panels };
}
