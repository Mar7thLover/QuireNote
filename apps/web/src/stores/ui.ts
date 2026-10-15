import type { AgentProposal } from "@folio/core";
import { create } from "zustand";

interface UiState {
  paletteOpen: boolean;
  /** 打开命令面板时预填的文本（例如从选区发起自然语言命令）。 */
  paletteSeed: string;
  focusMode: boolean;
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
  openAddSource: (tab?: UiState["addSourceTab"]) => void;
  set: (patch: Partial<UiState>) => void;
}

export const useUi = create<UiState>()((set) => ({
  paletteOpen: false,
  paletteSeed: "",
  focusMode: false,
  addSourceOpen: false,
  addSourceTab: "upload",
  shortcutsOpen: false,
  newNotebookOpen: false,
  proposal: null,
  dragging: null,
  openPalette: (seed = "") => set({ paletteOpen: true, paletteSeed: seed }),
  closePalette: () => set({ paletteOpen: false, paletteSeed: "" }),
  toggleFocus: () => set((s) => ({ focusMode: !s.focusMode })),
  openAddSource: (tab = "upload") => set({ addSourceOpen: true, addSourceTab: tab }),
  set: (patch) => set(patch),
}));

/** 拖拽数据的 MIME 类型。 */
export const DND_SOURCE = "application/x-folio-source";
export const DND_SNIPPET = "application/x-folio-snippet";
