import type { AgentProposal } from "@quirenote/core";
import { create } from "zustand";

interface UiState {
  paletteOpen: boolean;
  /** 打开命令面板时预填的文本（例如从选区发起自然语言命令）。 */
  paletteSeed: string;
  focusMode: boolean;
  /** 工作区侧栏只显示图标（记住在本机）。 */
  sidebarCollapsed: boolean;
  /** 侧栏分组的展开状态（跨页面保持，切换页面时不跳动）。 */
  sidebarGroups: { notebooks: boolean; settings: boolean };
  /** 内置使用手册（打开时定位到的章节）。 */
  manual: string | null;
  addSourceOpen: boolean;
  addSourceTab: "upload" | "url" | "paste" | "record" | "search";
  shortcutsOpen: boolean;
  newNotebookOpen: boolean;
  /** 待确认的 Agent 改动。 */
  proposal: { notebookId: string; proposal: AgentProposal } | null;
  /** 正在拖拽的条目（资料拖进对话、片段拖进笔记）。 */
  dragging: { kind: "source" | "snippet"; id?: string; text?: string } | null;

  openPalette: (seed?: string) => void;
  closePalette: () => void;
  toggleFocus: () => void;
  toggleSidebar: () => void;
  openAddSource: (tab?: UiState["addSourceTab"]) => void;
  set: (patch: Partial<UiState>) => void;
}

const SIDEBAR_KEY = "quirenote.sidebarCollapsed";

function loadSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

export const useUi = create<UiState>()((set) => ({
  paletteOpen: false,
  paletteSeed: "",
  focusMode: false,
  sidebarCollapsed: loadSidebarCollapsed(),
  sidebarGroups: { notebooks: true, settings: false },
  manual: null,
  addSourceOpen: false,
  addSourceTab: "upload",
  shortcutsOpen: false,
  newNotebookOpen: false,
  proposal: null,
  dragging: null,
  openPalette: (seed = "") => set({ paletteOpen: true, paletteSeed: seed }),
  closePalette: () => set({ paletteOpen: false, paletteSeed: "" }),
  toggleFocus: () => set((s) => ({ focusMode: !s.focusMode })),
  toggleSidebar: () =>
    set((s) => {
      const next = !s.sidebarCollapsed;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      } catch {}
      return { sidebarCollapsed: next };
    }),
  openAddSource: (tab = "upload") => set({ addSourceOpen: true, addSourceTab: tab }),
  set: (patch) => set(patch),
}));

/** 拖拽数据的 MIME 类型。 */
export const DND_SOURCE = "application/x-quirenote-source";
export const DND_SNIPPET = "application/x-quirenote-snippet";
