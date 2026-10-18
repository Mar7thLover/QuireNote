/**
 * 插件：笔记本本体之外的可选功能。现在都是内置插件，在「设置 → 插件」里开关；关掉只隐藏入口，
 * 已经导入的内容（笔记、知识书、规则、预设）都保留。将来第三方插件也通过这里的接入点注册。
 */
import type { CardImporter } from "@quirenote/card";
import { PLUGIN_ID as ST, sillytavernImporter } from "@quirenote/plugin-sillytavern";
import type { AppContext } from "./context";
import { ApiError, notFound } from "./errors";
import { currentLang, parseLang, withLang } from "./lang";
import { msg } from "./messages";

export interface ServerPlugin {
  id: string;
  version: string;
  /** 卡片导入器（别的格式 → Quire 卡）。 */
  importers?: CardImporter[];
}

// 插件一律默认关闭，只有用户在「设置 → 插件」里打开才启用（数据里已有酒馆内容也不自动打开）
export const BUILTIN_PLUGINS: ServerPlugin[] = [
  { id: ST, version: "0.1.0", importers: [sillytavernImporter] },
];

const SETTINGS_KEY = "plugins";

/** 各插件的开关；没设置过的算关闭。 */
export async function pluginStates(ctx: AppContext): Promise<Record<string, boolean>> {
  const saved = (await ctx.store.settings.get<Record<string, boolean>>(SETTINGS_KEY)) ?? {};
  return Object.fromEntries(BUILTIN_PLUGINS.map((p) => [p.id, saved[p.id] === true]));
}

export async function isPluginEnabled(ctx: AppContext, id: string): Promise<boolean> {
  return (await pluginStates(ctx))[id] === true;
}

export async function setPluginEnabled(ctx: AppContext, id: string, enabled: boolean): Promise<void> {
  if (!BUILTIN_PLUGINS.some((p) => p.id === id)) throw notFound("plugin");
  const states = await pluginStates(ctx);
  await ctx.store.settings.set(SETTINGS_KEY, { ...states, [id]: enabled });
}

/** 所有已安装插件的导入器（不论是否启用：先识别出格式，再按开关决定能不能导入）。 */
export const cardImporters: CardImporter[] = BUILTIN_PLUGINS.flatMap((p) => p.importers ?? []);

/** 用到了没启用的插件：400 + plugin_disabled，前端据此给出「启用插件」的按钮。 */
export async function requirePlugin(ctx: AppContext, id: string, lang?: string): Promise<void> {
  if (await isPluginEnabled(ctx, id)) return;
  const m = withLang(parseLang(lang) ?? currentLang(), msg);
  throw new ApiError(400, "plugin_disabled", m.pluginNeeded(m.pluginName[id] ?? id), { plugin: id });
}
