/**
 * 插件在前端的样子：名称、图标、它往界面里加了什么。开关状态来自服务端（/api/plugins），
 * 各处入口用 usePluginEnabled 判断要不要显示。
 */
import { useQuery } from "@tanstack/react-query";
import { Drama, type LucideIcon } from "lucide-react";
import { api } from "@/lib/api";
import { qk, queryClient } from "@/lib/query";

export interface PluginCatalogEntry {
  id: string;
  icon: LucideIcon;
  /** i18n 键前缀：plugins.<id>.name / .desc / .features（数组用 \n 分隔） */
  key: string;
}

export const PLUGIN_CATALOG: PluginCatalogEntry[] = [
  { id: "sillytavern", icon: Drama, key: "plugins.sillytavern" },
];

export const ST_PLUGIN = "sillytavern";

export function usePlugins() {
  return useQuery({ queryKey: qk.plugins, queryFn: api.plugins.list, staleTime: 60_000 });
}

export function usePluginEnabled(id: string): boolean {
  const q = usePlugins();
  return !!q.data?.find((p) => p.id === id)?.enabled;
}

/** 非 React 代码里读（缓存里没有时当作未启用）。 */
export function pluginEnabledNow(id: string): boolean {
  const list = queryClient.getQueryData<Awaited<ReturnType<typeof api.plugins.list>>>(qk.plugins);
  return !!list?.find((p) => p.id === id)?.enabled;
}

export async function setPluginEnabled(id: string, enabled: boolean): Promise<void> {
  const list = await api.plugins.set(id, enabled);
  queryClient.setQueryData(qk.plugins, list);
}
