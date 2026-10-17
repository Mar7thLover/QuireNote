import type { CardTemplate, RenderPack, RenderRule, RuleScope } from "@quirenote/core";
import {
  builtinRules,
  builtinTemplates,
  createRuleRunner,
  type RenderResult,
  type RuleRunner,
} from "@quirenote/render";
import RegexWorker from "@quirenote/render/worker?worker";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api } from "@/lib/api";
import { useWorkspace } from "@/stores/workspace";

interface RenderState {
  templates: CardTemplate[];
  rules: RenderRule[];
  /** 被用户关闭的内置规则 id。 */
  disabledBuiltins: string[];
  /** 各 Notebook 自带的渲染包（导入卡片时带来），只对该 Notebook 生效。 */
  notebookPacks: Record<string, RenderPack>;
  version: number;
  setNotebookPack: (notebookId: string, pack: RenderPack | undefined) => void;
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
      notebookPacks: {},
      version: 0,
      setNotebookPack: (notebookId, pack) => {
        const cur = get().notebookPacks[notebookId];
        if (JSON.stringify(cur ?? null) === JSON.stringify(pack ?? null)) return;
        const notebookPacks = { ...get().notebookPacks };
        if (pack) notebookPacks[notebookId] = pack;
        else delete notebookPacks[notebookId];
        set({ notebookPacks, version: get().version + 1 });
      },
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
      name: "quirenote.render",
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

const currentNotebook = () => useWorkspace.getState().notebookId;

export function allTemplates(notebookId: string | null = currentNotebook()): Map<string, CardTemplate> {
  const s = useRenderStore.getState();
  const pack = notebookId ? s.notebookPacks[notebookId] : undefined;
  return new Map([...builtinTemplates, ...s.templates, ...(pack?.templates ?? [])].map((t) => [t.id, t]));
}

/**
 * 执行顺序：Notebook 自带的规则 → 用户全局规则 → 内置规则，各组内按 order。
 * 用 order 偏移把三组隔开（planRules 按 order 排序）。
 */
export function allRules(notebookId: string | null = currentNotebook()): RenderRule[] {
  const s = useRenderStore.getState();
  const pack = notebookId ? s.notebookPacks[notebookId] : undefined;
  return [
    ...(pack?.rules ?? []).map((r) => ({ ...r, order: r.order - 2_000_000 })),
    ...s.rules.map((r) => ({ ...r, order: r.order - 1_000_000 })),
    ...builtinRules.map((r) => ({ ...r, enabled: r.enabled && !s.disabledBuiltins.includes(r.id) })),
  ];
}

/** 当前 Notebook 有没有可能匹配任意文本的自定义规则（没有时可以跳过 worker 往返）。 */
export function hasCustomRules(notebookId: string | null = currentNotebook()): boolean {
  const s = useRenderStore.getState();
  return s.rules.length > 0 || !!(notebookId && s.notebookPacks[notebookId]?.rules.length);
}

export function getRuleRunner(): RuleRunner {
  return getRunner();
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
  const notebookId = useWorkspace((s) => s.notebookId);
  const key = `${scope}\u0000${version}\u0000${notebookId ?? ""}\u0000${text}`;
  const [result, setResult] = useState<RenderResult | null>(() => cache.get(key) ?? null);
  useEffect(() => {
    const hit = cache.get(key);
    if (hit) {
      setResult(hit);
      return;
    }
    // 没有任何可能匹配的标记时跳过 worker 往返
    if (!/[【>]/.test(text) && !hasCustomRules(notebookId)) {
      setResult({ segments: [{ type: "text", text }], errors: [] });
      return;
    }
    let alive = true;
    getRunner()
      .run(text, allRules(notebookId), { scope })
      .then((r) => {
        if (cache.size > 300) cache.clear();
        cache.set(key, r);
        if (alive) setResult(r);
      })
      .catch(() => alive && setResult({ segments: [{ type: "text", text }], errors: [] }));
    return () => {
      alive = false;
    };
  }, [key, text, scope, notebookId]);
  return result;
}
