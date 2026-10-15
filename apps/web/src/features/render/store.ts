import type { CardTemplate, RenderRule, RuleScope } from "@folio/core";
import {
  builtinRules,
  builtinTemplates,
  createRuleRunner,
  type RenderResult,
  type RuleRunner,
} from "@folio/render";
import RegexWorker from "@folio/render/worker?worker";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api } from "@/lib/api";

interface RenderState {
  templates: CardTemplate[];
  rules: RenderRule[];
  /** 被用户关闭的内置规则 id。 */
  disabledBuiltins: string[];
  version: number;
  setTemplates: (t: CardTemplate[]) => void;
  setRules: (r: RenderRule[]) => void;
  toggleBuiltin: (id: string, enabled: boolean) => void;
}

/** 用户自定义模板与规则：本地缓存优先，同时同步到服务端 settings。 */
export const useRenderStore = create<RenderState>()(
  persist(
    (set, get) => ({
      templates: [],
      rules: [],
      disabledBuiltins: [],
      version: 0,
      setTemplates: (templates) => {
        set({ templates, version: get().version + 1 });
        api.settings.put("templates", templates).catch(() => {});
      },
      setRules: (rules) => {
        set({ rules, version: get().version + 1 });
        api.settings.put("rules", rules).catch(() => {});
      },
      toggleBuiltin: (id, enabled) => {
        const disabledBuiltins = enabled
          ? get().disabledBuiltins.filter((x) => x !== id)
          : [...get().disabledBuiltins, id];
        set({ disabledBuiltins, version: get().version + 1 });
        api.settings.put("disabledBuiltins", disabledBuiltins).catch(() => {});
      },
    }),
    {
      name: "folio.render",
      partialize: (s) => ({ templates: s.templates, rules: s.rules, disabledBuiltins: s.disabledBuiltins }),
    },
  ),
);

/** 启动时从服务端拉取（多设备同步）。 */
export async function syncRenderSettings() {
  try {
    const [templates, rules, disabled] = await Promise.all([
      api.settings.get<CardTemplate[]>("templates"),
      api.settings.get<RenderRule[]>("rules"),
      api.settings.get<string[]>("disabledBuiltins"),
    ]);
    useRenderStore.setState((s) => ({
      templates: templates ?? s.templates,
      rules: rules ?? s.rules,
      disabledBuiltins: disabled ?? s.disabledBuiltins,
      version: s.version + 1,
    }));
  } catch {}
}

export function allTemplates(): Map<string, CardTemplate> {
  return new Map([...builtinTemplates, ...useRenderStore.getState().templates].map((t) => [t.id, t]));
}

export function allRules(): RenderRule[] {
  const s = useRenderStore.getState();
  return [
    ...builtinRules.map((r) => ({ ...r, enabled: r.enabled && !s.disabledBuiltins.includes(r.id) })),
    ...s.rules,
  ];
}

let runner: RuleRunner | null = null;
function getRunner(): RuleRunner {
  runner ??= createRuleRunner({ createWorker: () => new RegexWorker(), timeoutMs: 300 });
  return runner;
}

const cache = new Map<string, RenderResult>();

/** 在 Worker 中对文本应用规则；结果按文本 + 规则版本缓存。 */
export function useRenderedSegments(text: string, scope: RuleScope): RenderResult | null {
  const version = useRenderStore((s) => s.version);
  const key = `${scope}\u0000${version}\u0000${text}`;
  const [result, setResult] = useState<RenderResult | null>(() => cache.get(key) ?? null);
  useEffect(() => {
    const hit = cache.get(key);
    if (hit) {
      setResult(hit);
      return;
    }
    // 没有任何可能匹配的标记时跳过 worker 往返
    if (!/[【>]/.test(text) && !useRenderStore.getState().rules.length) {
      setResult({ segments: [{ type: "text", text }], errors: [] });
      return;
    }
    let alive = true;
    getRunner()
      .run(text, allRules(), { scope })
      .then((r) => {
        if (cache.size > 300) cache.clear();
        cache.set(key, r);
        if (alive) setResult(r);
      })
      .catch(() => alive && setResult({ segments: [{ type: "text", text }], errors: [] }));
    return () => {
      alive = false;
    };
  }, [key, text, scope]);
  return result;
}
