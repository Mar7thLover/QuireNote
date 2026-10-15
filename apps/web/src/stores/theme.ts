import type { ThemeSettings } from "@folio/core";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export const ACCENTS: Record<string, { h: number; c: number; label: string }> = {
  indigo: { h: 272, c: 0.19, label: "靛蓝" },
  violet: { h: 300, c: 0.2, label: "紫罗兰" },
  blue: { h: 250, c: 0.17, label: "海蓝" },
  teal: { h: 190, c: 0.12, label: "青绿" },
  green: { h: 152, c: 0.15, label: "森绿" },
  amber: { h: 65, c: 0.15, label: "琥珀" },
  rose: { h: 12, c: 0.19, label: "玫瑰" },
  graphite: { h: 272, c: 0.025, label: "石墨" },
};

export const FONT_PRESETS = {
  sans: [
    {
      label: "Inter",
      value: '"Inter Variable", "PingFang SC", "Microsoft YaHei UI", "Noto Sans SC", system-ui, sans-serif',
    },
    { label: "系统默认", value: 'system-ui, "PingFang SC", "Microsoft YaHei UI", sans-serif' },
    { label: "思源宋体风格", value: '"Source Serif 4 Variable", "Noto Serif SC", "Songti SC", serif' },
  ],
  serif: [
    {
      label: "Source Serif",
      value: '"Source Serif 4 Variable", "Songti SC", "Noto Serif SC", "SimSun", Georgia, serif',
    },
    { label: "无衬线", value: '"Inter Variable", "PingFang SC", "Microsoft YaHei UI", sans-serif' },
  ],
};

export const BACKGROUNDS: {
  id: string;
  label: string;
  type: ThemeSettings["background"]["type"];
  value: string;
}[] = [
  { id: "none", label: "纯色", type: "none", value: "" },
  {
    id: "dawn",
    label: "晨曦",
    type: "gradient",
    value:
      "radial-gradient(1200px 600px at 10% -10%, oklch(0.85 0.08 60 / .55), transparent 60%), radial-gradient(900px 500px at 100% 0%, oklch(0.8 0.09 300 / .45), transparent 60%)",
  },
  {
    id: "ocean",
    label: "深海",
    type: "gradient",
    value:
      "radial-gradient(1000px 600px at 0% 100%, oklch(0.7 0.1 220 / .45), transparent 60%), radial-gradient(800px 500px at 100% 0%, oklch(0.75 0.1 180 / .35), transparent 60%)",
  },
  { id: "aurora", label: "极光（动态）", type: "aurora", value: "" },
];

export const defaultTheme: ThemeSettings = {
  mode: "system",
  accent: "indigo",
  fontSans: FONT_PRESETS.sans[0]!.value,
  fontSerif: FONT_PRESETS.serif[0]!.value,
  fontMono: '"JetBrains Mono Variable", ui-monospace, monospace',
  radius: 10,
  density: "comfortable",
  background: { type: "none", value: "", opacity: 0.6 },
};

interface ThemeState extends ThemeSettings {
  set: (patch: Partial<ThemeSettings>) => void;
  reset: () => void;
}

export const useTheme = create<ThemeState>()(
  persist(
    (set) => ({
      ...defaultTheme,
      set: (patch) => set(patch),
      reset: () => set(defaultTheme),
    }),
    { name: "folio.theme", version: 1 },
  ),
);

const media = typeof matchMedia !== "undefined" ? matchMedia("(prefers-color-scheme: dark)") : null;

export function resolvedMode(mode: ThemeSettings["mode"]): "light" | "dark" {
  if (mode === "system") return media?.matches ? "dark" : "light";
  return mode;
}

/** 把主题设置写到 <html> 上（data 属性 + CSS 变量）。 */
export function applyTheme(t: ThemeSettings) {
  const root = document.documentElement;
  root.dataset.theme = resolvedMode(t.mode);
  root.dataset.density = t.density;
  const acc = ACCENTS[t.accent] ?? ACCENTS.indigo!;
  root.style.setProperty("--accent-h", String(acc.h));
  root.style.setProperty("--accent-c", String(acc.c));
  root.style.setProperty("--radius", `${t.radius}px`);
  root.style.setProperty("--font-sans", t.fontSans);
  root.style.setProperty("--font-serif", t.fontSerif);
  root.style.setProperty("--font-mono", t.fontMono);
  root.dataset.bg = t.background.type;
  root.style.setProperty(
    "--app-bg-image",
    t.background.type === "image" ? `url("${t.background.value}")` : t.background.value || "none",
  );
  root.style.setProperty("--app-bg-opacity", String(t.background.opacity));
}

export function initTheme() {
  applyTheme(useTheme.getState());
  useTheme.subscribe((s) => applyTheme(s));
  media?.addEventListener("change", () => applyTheme(useTheme.getState()));
}
