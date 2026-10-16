/**
 * 正则执行 worker。前端用法（Vite）：
 *
 * ```ts
 * import RegexWorker from "@quirenote/render/worker?worker";
 * const runner = createRuleRunner({ createWorker: () => new RegexWorker(), timeoutMs: 300 });
 * ```
 *
 * 协议：收到 `MatchRequest`，回复 `MatchResponse`（同 id）。worker 只做匹配，不做替换和渲染。
 */
import { collectMatches } from "./matcher";
import type { MatchRequest, MatchResponse } from "./types";

interface WorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent<MatchRequest>) => void): void;
  postMessage(message: MatchResponse): void;
}

const scope = globalThis as unknown as WorkerScope;

scope.addEventListener("message", (event) => {
  const { id, pattern, flags, texts } = event.data;
  scope.postMessage({ id, ...collectMatches({ pattern, flags, texts }) });
});
