/**
 * 插画区的底色（首页「最近打开」、Studio 卡片）：参照 Claude Console 模型卡片的那组颜色——
 * 灰蓝、陶土、象牙、鼠尾草、沙、薰衣草。低饱和，和暖象牙底放在一起不跳。
 * 深色模式下与表面色混合压暗，线描图标始终用墨色。
 */
export const TINTS = {
  blue: "oklch(0.74 0.075 245)",
  clay: "oklch(0.74 0.1 45)",
  ivory: "oklch(0.91 0.018 90)",
  sage: "oklch(0.83 0.04 175)",
  sand: "oklch(0.85 0.05 80)",
  lavender: "oklch(0.8 0.045 290)",
} as const;
export type Tint = keyof typeof TINTS;

const ORDER: Tint[] = ["blue", "clay", "ivory", "sage", "sand", "lavender"];

/** 由 id 决定的稳定颜色：同一条笔记每次都是同一种颜色，相邻卡片大多不同。 */
export function tintFor(id: string): Tint {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ORDER[h % ORDER.length]!;
}

export function tintBg(t: Tint): string {
  return `color-mix(in srgb, ${TINTS[t]} var(--tint-strength, 100%), var(--surface-sunken))`;
}

/** 插画区里的线描图标颜色。 */
export const tintInk = "color-mix(in srgb, var(--fg) 82%, transparent)";
