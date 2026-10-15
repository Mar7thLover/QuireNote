/**
 * 动效规范：克制、短促、以 ease-out 为主。
 * - fast：hover / 按下反馈
 * - base：弹层、面板展开
 * - slow：页面级过渡、抽屉
 * 弹性曲线只用于开关、拖放落位等"物理感"场景。
 */
export const durations = { fast: 0.12, base: 0.18, slow: 0.28 } as const;
export const easings = {
  out: [0.22, 1, 0.36, 1] as [number, number, number, number],
  spring: { type: "spring", stiffness: 520, damping: 38, mass: 0.8 } as const,
};

export const fadeUp = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 4 },
  transition: { duration: durations.base, ease: easings.out },
};

export const listItem = (i: number) => ({
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: durations.base, ease: easings.out, delay: Math.min(i, 12) * 0.025 },
});
