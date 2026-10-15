import { create } from "zustand";

/** 是否运行在 Capacitor 原生壳里（iOS / Android）。 */
export function isNative(): boolean {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

export function hasServerOverride(): boolean {
  try {
    return !!localStorage.getItem("folio.server");
  } catch {
    return false;
  }
}

export interface SharedPayload {
  title: string;
  texts: string[];
  files: { uri: string; name: string; mimeType: string }[];
}

/** 系统分享菜单发来的内容，等待用户选择目标 Notebook。 */
export const useShareInbox = create<{
  payload: SharedPayload | null;
  set: (p: SharedPayload | null) => void;
}>()((set) => ({
  payload: null,
  set: (payload) => set({ payload }),
}));

/** 注册原生事件：接收分享、返回键。仅在原生壳中生效，Web 端什么也不做。 */
export async function initNative(): Promise<() => void> {
  if (!isNative()) return () => {};
  const [{ CapacitorShareTarget }, { App }] = await Promise.all([
    import("@capgo/capacitor-share-target"),
    import("@capacitor/app"),
  ]);
  const handles = await Promise.all([
    CapacitorShareTarget.addListener("shareReceived", (e) => {
      if (e.texts.length || e.files.length)
        useShareInbox.getState().set({ title: e.title, texts: e.texts, files: e.files });
    }),
    App.addListener("backButton", ({ canGoBack }) => {
      if (canGoBack) history.back();
      else App.exitApp();
    }),
  ]);
  return () => {
    for (const h of handles) h.remove();
  };
}
