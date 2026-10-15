import { Worker as NodeWorker } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import { builtinRuleSamples, builtinRules } from "./builtin/rules";
import { applyRulesSync } from "./engine";
import { collectMatches } from "./matcher";
import { createRuleRunner, type RuleRunner, type WorkerLike } from "./runner";
import { makeRule } from "./test-utils";
import type { MatchRequest, MatchResponse } from "./types";

// 类型层面保证浏览器原生 Worker（Vite 的 ?worker 导入）可以直接交给 createRuleRunner。
const _browserWorkerIsCompatible = (w: Worker): WorkerLike => w;
void _browserWorkerIsCompatible;

type Listener = (event: never) => void;

/** 把 Node worker_threads 适配成 WorkerLike，worker 内运行真实的 collectMatches。 */
function nodeWorkerFactory(created: NodeWorker[]) {
  const source = `
const { parentPort } = require("node:worker_threads");
const collectMatches = ${collectMatches.toString()};
parentPort.on("message", (req) => parentPort.postMessage({ id: req.id, ...collectMatches(req) }));
`;
  return (): WorkerLike => {
    const w = new NodeWorker(source, { eval: true });
    created.push(w);
    const addEventListener = (type: string, listener: Listener) => {
      if (type === "message") w.on("message", (data) => listener({ data } as never));
      else w.on("error", (err) => listener({ message: err.message } as never));
    };
    return {
      postMessage: (m) => w.postMessage(m),
      terminate: () => void w.terminate(),
      addEventListener: addEventListener as WorkerLike["addEventListener"],
    };
  };
}

/** 进程内模拟 worker：遇到 hang 关键字就永不回复，模拟灾难性回溯。 */
class MockWorker {
  static created: MockWorker[] = [];
  terminated = false;
  private listeners: { message: Listener[]; error: Listener[] } = { message: [], error: [] };
  constructor() {
    MockWorker.created.push(this);
  }
  postMessage(req: MatchRequest) {
    if (req.pattern.includes("HANG")) return;
    if (req.pattern.includes("CRASH")) {
      queueMicrotask(() => {
        for (const l of this.listeners.error) l({ message: "boom" } as never);
      });
      return;
    }
    const res: MatchResponse = { id: req.id, ...collectMatches(req) };
    setTimeout(() => {
      if (this.terminated) return;
      for (const l of this.listeners.message) l({ data: res } as never);
    }, 1);
  }
  terminate() {
    this.terminated = true;
  }
  addEventListener(type: "message" | "error", listener: Listener) {
    this.listeners[type].push(listener);
  }
}

const mockFactory = () => new MockWorker() as unknown as WorkerLike;

let runner: RuleRunner | null = null;
afterEach(() => {
  runner?.dispose();
  runner = null;
  MockWorker.created = [];
});

describe("createRuleRunner（模拟 worker）", () => {
  it("结果与同步版一致", async () => {
    runner = createRuleRunner({ createWorker: mockFactory, timeoutMs: 1000 });
    const input = Object.values(builtinRuleSamples).join("\n\n");
    const result = await runner.run(input, builtinRules);
    expect(result).toEqual(applyRulesSync(input, builtinRules));
    expect(result.segments.filter((s) => s.type === "card")).toHaveLength(builtinRules.length);
  });

  it("超时后 terminate 并重建 worker，跳过该规则并报告超时", async () => {
    runner = createRuleRunner({ createWorker: mockFactory, timeoutMs: 30 });
    const rules = [
      makeRule({ id: "before", pattern: "a", replacement: "b", order: 1 }),
      makeRule({ id: "slow", name: "慢规则", pattern: "HANG", order: 2 }),
      makeRule({ id: "after", pattern: "c", replacement: "d", order: 3 }),
    ];
    const result = await runner.run("ac", rules);
    expect(result.segments).toEqual([{ type: "text", text: "bd" }]);
    expect(result.errors).toEqual([
      expect.objectContaining({ ruleId: "slow", ruleName: "慢规则", kind: "timeout" }),
    ]);
    expect(MockWorker.created).toHaveLength(2);
    expect(MockWorker.created[0]?.terminated).toBe(true);
    expect(MockWorker.created[1]?.terminated).toBe(false);
    expect(runner.restarts).toBe(1);
  });

  it("worker 崩溃时报告 worker-error 并重建", async () => {
    runner = createRuleRunner({ createWorker: mockFactory, timeoutMs: 1000 });
    const rules = [
      makeRule({ id: "crash", pattern: "CRASH", order: 1 }),
      makeRule({ id: "ok", pattern: "x", replacement: "y", order: 2 }),
    ];
    const result = await runner.run("x", rules);
    expect(result.errors).toEqual([
      expect.objectContaining({ ruleId: "crash", kind: "worker-error", message: "boom" }),
    ]);
    expect(result.segments).toEqual([{ type: "text", text: "y" }]);
  });

  it("非法正则在主线程直接报告，不进入 worker", async () => {
    runner = createRuleRunner({ createWorker: mockFactory });
    const result = await runner.run("x", [makeRule({ id: "bad", pattern: "[" })]);
    expect(result.errors).toEqual([expect.objectContaining({ kind: "invalid-pattern" })]);
    expect(MockWorker.created).toHaveLength(0);
  });

  it("并发调用串行执行，dispose 后拒绝", async () => {
    runner = createRuleRunner({ createWorker: mockFactory });
    const rules = [makeRule({ id: "r", pattern: "\\d", replacement: "#" })];
    const [a, b] = await Promise.all([runner.run("1a", rules), runner.run("b2", rules)]);
    expect(a.segments).toEqual([{ type: "text", text: "#a" }]);
    expect(b.segments).toEqual([{ type: "text", text: "b#" }]);
    runner.dispose();
    await expect(runner.run("1", rules)).rejects.toThrow();
  });
});

describe("createRuleRunner（Node worker_threads + 真实正则）", () => {
  const created: NodeWorker[] = [];
  afterEach(async () => {
    await Promise.all(created.splice(0).map((w) => w.terminate()));
  });

  it("灾难性回溯会被超时终止，后续规则与后续调用照常工作", async () => {
    runner = createRuleRunner({ createWorker: nodeWorkerFactory(created), timeoutMs: 300 });
    const evil = `${"a".repeat(40)}!`;
    const rules = [
      makeRule({ id: "redos", name: "ReDoS", pattern: "^(a+)+$", replacement: "never", order: 1 }),
      makeRule({ id: "bang", pattern: "!", replacement: "?", order: 2 }),
    ];
    const started = Date.now();
    const result = await runner.run(evil, rules);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(result.errors).toEqual([expect.objectContaining({ ruleId: "redos", kind: "timeout" })]);
    expect(result.segments).toEqual([{ type: "text", text: `${"a".repeat(40)}?` }]);
    expect(created.length).toBe(2);

    const again = await runner.run("【术语：熵｜不确定性】", builtinRules);
    expect(again.errors).toEqual([]);
    expect(again.segments[0]).toMatchObject({ type: "card", templateId: "builtin.term" });
  }, 15000);
});
