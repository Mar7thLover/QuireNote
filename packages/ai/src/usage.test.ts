import { describe, expect, it } from "vitest";
import { sanitizeSvg } from "./image";
import { estimateCost, priceOf } from "./usage";

const zero = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, searches: 0 };

describe("cost estimates", () => {
  it("prices current Claude models at list price", () => {
    expect(estimateCost("claude-sonnet-5-5", { ...zero, inputTokens: 1_000_000 })).toBeCloseTo(2);
    expect(estimateCost("claude-opus-5-5", { ...zero, outputTokens: 1_000_000 })).toBeCloseTo(20);
    expect(
      estimateCost("claude-haiku-5-5", { ...zero, inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    ).toBeCloseTo(0.6);
    expect(priceOf("claude-fable-5-1")?.input).toBe(10);
  });

  it("bills cache reads and writes separately from fresh input", () => {
    // 100 万输入里 80 万命中缓存：20 万按 $2，80 万按 $0.2
    const cost = estimateCost("claude-sonnet-5-5", {
      ...zero,
      inputTokens: 1_000_000,
      cacheReadTokens: 800_000,
    });
    expect(cost).toBeCloseTo(0.4 + 0.16);
    const write = estimateCost("claude-sonnet-5-5", {
      ...zero,
      inputTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
    });
    expect(write).toBeCloseTo(2.5);
  });

  it("adds per-search fees and leaves unknown models unpriced", () => {
    expect(estimateCost("claude-haiku-5-5", { ...zero, searches: 1000 })).toBeCloseTo(10);
    expect(estimateCost("gpt-6.1-sol", { ...zero, inputTokens: 1000 })).toBeNull();
    expect(estimateCost("unknown", { ...zero, searches: 10 })).toBeCloseTo(0.1);
  });
});

describe("sanitizeSvg", () => {
  it("keeps drawing elements and strips anything executable or external", () => {
    const raw = `Here you go:
\`\`\`svg
<svg viewBox="0 0 10 10" onload="alert(1)"><script>alert(1)</script>
<rect width="10" height="10" fill="url(#g)" onclick="x()"/>
<a href="https://evil.example"><circle r="2"/></a>
<image href="https://evil.example/x.png"/>
<foreignObject><div>hi</div></foreignObject>
<style>@import url(https://evil.example/a.css); rect { fill: url(https://evil.example/f) }</style>
</svg>
\`\`\``;
    const svg = sanitizeSvg(raw)!;
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain("<rect");
    expect(svg).toContain('fill="url(#g)"');
    expect(svg).not.toMatch(/script|onload|onclick|foreignObject|<image|evil\.example|@import/i);
  });

  it("returns null when there is no svg", () => {
    expect(sanitizeSvg("sorry, I can't draw that")).toBeNull();
  });
});
