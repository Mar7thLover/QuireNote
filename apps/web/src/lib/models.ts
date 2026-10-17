/** 模型选择相关的查询与工具：按能力列出可选模型、解析 "providerId:model" 显示名。 */
import type { Capability, ModelChoice, ProviderConfig, ProviderModel } from "@quirenote/core";
import { useQuery } from "@tanstack/react-query";
import i18n from "@/i18n";
import { api } from "@/lib/api";
import { qk } from "@/lib/query";

export interface ModelGroup {
  provider: ProviderConfig;
  models: ProviderModel[];
}

/** 提供方目录来自服务端；名称和说明按界面语言换成 i18n 里的文字（providers.<kind>），没有的保留原文。 */
export function useProviderCatalog() {
  return useQuery({
    queryKey: qk.catalog,
    queryFn: api.providers.catalog,
    staleTime: Number.POSITIVE_INFINITY,
    select: (list) =>
      list.map((c) => ({
        ...c,
        label: i18n.t(`providers.${c.kind}.label`, { defaultValue: c.label }),
        notes: c.notes ? i18n.t(`providers.${c.kind}.notes`, { defaultValue: c.notes }) : c.notes,
      })),
  });
}

// 模型配置数据很小，又决定 AI 功能能否使用：每次挂载都向服务端确认，不吃 30 秒的缓存。
export function useProviders() {
  return useQuery({ queryKey: qk.providers, queryFn: api.providers.list, staleTime: 0 });
}

export function useAssignments() {
  return useQuery({ queryKey: qk.assignments, queryFn: api.providers.assignments, staleTime: 0 });
}

/** 已启用、类型支持该能力、并登记了该用途模型的提供方，按提供方分组。 */
export function useModelGroups(cap: Capability): { groups: ModelGroup[]; loading: boolean } {
  const catalog = useProviderCatalog();
  const providers = useProviders();
  const caps = new Map((catalog.data ?? []).map((c) => [c.kind, c.capabilities]));
  const groups = (providers.data ?? [])
    .filter((p) => p.enabled && caps.get(p.kind)?.includes(cap))
    .map((p) => ({ provider: p, models: p.models.filter((m) => m.capabilities.includes(cap)) }))
    .filter((g) => g.models.length > 0);
  return { groups, loading: catalog.isLoading || providers.isLoading };
}

export function sameChoice(a: ModelChoice | null | undefined, b: ModelChoice | null | undefined): boolean {
  return !!a && !!b && a.providerId === b.providerId && a.model === b.model;
}

/** 模型显示名（登记时填的显示名优先）与所属提供方名称。 */
export function describeModel(
  providers: ProviderConfig[] | undefined,
  choice: ModelChoice,
): { model: string; provider: string | null } {
  const p = providers?.find((x) => x.id === choice.providerId);
  const m = p?.models.find((x) => x.id === choice.model);
  return { model: m?.label || choice.model, provider: p?.name ?? null };
}

/** 解析消息上记录的 "providerId:model"（模型名本身可能含冒号）。 */
export function parseModelRef(ref: string): ModelChoice | null {
  const i = ref.indexOf(":");
  return i > 0 ? { providerId: ref.slice(0, i), model: ref.slice(i + 1) } : null;
}
