import { useEffect, useRef } from "react";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** 判断键盘事件是否匹配 "Mod+Shift+K" 这样的组合。Mod 在 Mac 上是 ⌘，其他平台是 Ctrl。 */
export function matchHotkey(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split("+");
  const key = parts.pop()!;
  const want = {
    mod: parts.includes("mod"),
    shift: parts.includes("shift"),
    alt: parts.includes("alt"),
  };
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (mod !== want.mod || e.shiftKey !== want.shift || e.altKey !== want.alt) return false;
  const k = e.key.toLowerCase();
  if (key === "/" && (k === "/" || e.code === "Slash")) return true;
  if (key === "\\" && e.code === "Backslash") return true;
  if (key === "." && e.code === "Period") return true;
  return k === key || e.code.toLowerCase() === `key${key}` || e.code.toLowerCase() === `digit${key}`;
}

function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

/**
 * 注册全局快捷键。带 Mod 的组合在输入框里也生效，不带的只在非输入状态生效。
 */
export function useHotkeys(map: Record<string, (e: KeyboardEvent) => void>) {
  const ref = useRef(map);
  ref.current = map;
  // 回调总是从 ref 读取最新的映射，所以只需注册一次
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      for (const [combo, fn] of Object.entries(ref.current)) {
        if (!matchHotkey(e, combo)) continue;
        if (!/mod/i.test(combo) && isEditable(e.target)) continue;
        e.preventDefault();
        fn(e);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export const SHORTCUTS = {
  palette: "Mod+K",
  newNote: "Mod+Alt+N",
  addSource: "Mod+Shift+O",
  focusChat: "Mod+L",
  toggleFocus: "Mod+.",
  toggleTheme: "Mod+Shift+L",
  search: "Mod+Shift+F",
  openSources: "Mod+1",
  openNotes: "Mod+2",
  openStudio: "Mod+3",
  help: "Mod+/",
} as const;
