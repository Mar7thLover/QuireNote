import type { RenderRule } from "@folio/core";
import {
  applyMatches,
  normalizeSegments,
  planRules,
  ruleError,
  textsOf,
  toSegments,
  validateRulePattern,
} from "./engine";
import type {
  ApplyOptions,
  MatchOutcome,
  MatchRequest,
  MatchResponse,
  RenderResult,
  RuleError,
  Segment,
} from "./types";

/**
 * 宿主注入的 worker 的最小接口。浏览器原生 `Worker`（包括 Vite 的 `?worker` 导入）直接满足；
 * Node `worker_threads` 需要一层很薄的适配（见测试）。
 */
export interface WorkerLike {
  postMessage(message: MatchRequest): void;
  terminate(): void;
  addEventListener(type: "message", listener: (event: MessageEvent<MatchResponse>) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
}

export interface RuleRunnerOptions {
  /** 创建一个运行 `@folio/render/worker` 的 worker。超时后旧 worker 会被 terminate，并在下次需要时重新调用。 */
  createWorker: () => WorkerLike;
  /** 单条规则（在整段文本上）的执行超时，默认 300ms。 */
  timeoutMs?: number;
}

export interface RuleRunner {
  /** 执行规则；多次调用会排队串行执行。 */
  run(
    input: string | readonly Segment[],
    rules: readonly RenderRule[],
    options?: ApplyOptions,
  ): Promise<RenderResult>;
  /** 终止 worker；之后再调用 run 会被拒绝。 */
  dispose(): void;
  /** 因超时或崩溃而重建 worker 的次数（诊断用）。 */
  readonly restarts: number;
}

type ExecResult =
  | { kind: "done"; outcome: MatchOutcome }
  | { kind: "timeout" }
  | { kind: "crash"; message: string };

interface Pending {
  id: number;
  timer: ReturnType<typeof setTimeout>;
  resolve: (r: ExecResult) => void;
}

export const DEFAULT_RULE_TIMEOUT_MS = 300;

export function createRuleRunner({
  createWorker,
  timeoutMs = DEFAULT_RULE_TIMEOUT_MS,
}: RuleRunnerOptions): RuleRunner {
  let worker: WorkerLike | null = null;
  let pending: Pending | null = null;
  let seq = 0;
  let restarts = 0;
  let disposed = false;
  let queue: Promise<unknown> = Promise.resolve();

  function settle(result: ExecResult): void {
    const p = pending;
    if (!p) return;
    pending = null;
    clearTimeout(p.timer);
    p.resolve(result);
  }

  function kill(): void {
    const w = worker;
    worker = null;
    try {
      w?.terminate();
    } catch {
      // 忽略：worker 已经不可用
    }
  }

  function ensureWorker(): WorkerLike {
    if (worker) return worker;
    const w = createWorker();
    w.addEventListener("message", (event) => {
      if (w !== worker) return; // 已被替换的旧 worker 的迟到消息
      const data = event.data;
      if (pending && data && data.id === pending.id) {
        const { id: _id, ...outcome } = data;
        settle({ kind: "done", outcome: outcome as MatchOutcome });
      }
    });
    w.addEventListener("error", (event) => {
      if (w !== worker) return;
      kill();
      restarts++;
      settle({ kind: "crash", message: event?.message || "worker 异常退出" });
    });
    worker = w;
    return w;
  }

  function exec(pattern: string, flags: string, texts: string[]): Promise<ExecResult> {
    return new Promise<ExecResult>((resolve) => {
      const id = ++seq;
      const timer = setTimeout(() => {
        if (pending?.id !== id) return;
        // 正则仍在 worker 里回溯：直接终止，下次执行时重建。
        kill();
        restarts++;
        settle({ kind: "timeout" });
      }, timeoutMs);
      pending = { id, timer, resolve };
      try {
        ensureWorker().postMessage({ id, pattern, flags, texts });
      } catch (e) {
        kill();
        settle({ kind: "crash", message: e instanceof Error ? e.message : String(e) });
      }
    });
  }

  async function runNow(
    input: string | readonly Segment[],
    rules: readonly RenderRule[],
    options: ApplyOptions,
  ): Promise<RenderResult> {
    let segments = normalizeSegments(toSegments(input));
    const errors: RuleError[] = [];
    for (const rule of planRules(rules, options)) {
      if (disposed) throw new Error("RuleRunner 已销毁");
      const invalid = validateRulePattern(rule.pattern, rule.flags);
      if (invalid) {
        errors.push(ruleError(rule, "invalid-pattern", invalid));
        continue;
      }
      const texts = textsOf(segments);
      if (texts.length === 0) break;
      const res = await exec(rule.pattern, rule.flags, texts);
      if (res.kind === "timeout") {
        errors.push(ruleError(rule, "timeout", `规则「${rule.name}」执行超过 ${timeoutMs}ms，已终止并跳过`));
      } else if (res.kind === "crash") {
        errors.push(ruleError(rule, "worker-error", res.message));
      } else if (!res.outcome.ok) {
        errors.push(ruleError(rule, "invalid-pattern", res.outcome.error));
      } else {
        segments = applyMatches(segments, rule, res.outcome.results);
      }
    }
    return { segments, errors };
  }

  return {
    run(input, rules, options = {}) {
      if (disposed) return Promise.reject(new Error("RuleRunner 已销毁"));
      const job = queue.then(() => runNow(input, rules, options));
      queue = job.catch(() => undefined);
      return job;
    },
    dispose() {
      disposed = true;
      kill();
      settle({ kind: "crash", message: "RuleRunner 已销毁" });
    },
    get restarts() {
      return restarts;
    },
  };
}
