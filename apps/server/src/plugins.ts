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
  /** 没有设置过开关时，根据已有数据判断要不要默认开启。 */
  detect?: (ctx: AppContext) => Promise<boolean>;
}

export const BUILTIN_PLUGINS: ServerPlugin[] = [
  {
    id: ST,
    version: "0.1.0",
    importers: [sillytavernImporter],
    // 数据里已经有从酒馆导入的内容（世界书条目、正则规则）时默认开启，新安装默认关闭
    async detect(ctx) {
      const lore = await ctx.store.lore.list();
      if (lore.some((e) => !!(e.extensions as Record<string, unknown> | undefined)?.sillytavern)) return true;
      const notebooks = await ctx.store.notebooks.list();
      return notebooks.some((n) => n.render?.rules.some((r) => r.id.startsWith("st_")));
    },
  },
];

const SETTINGS_KEY = "plugins";

/** 各插件的开关；还没设置过的按 detect 的结果补上并保存。 */
export async function pluginStates(ctx: AppContext): Promise<Record<string, boolean>> {
  const saved = (await ctx.store.settings.get<Record<string, boolean>>(SETTINGS_KEY)) ?? {};
  let changed = false;
  for (const p of BUILTIN_PLUGINS) {
    if (typeof saved[p.id] === "boolean") continue;
    saved[p.id] = p.detect ? await p.detect(ctx) : false;
    changed = true;
  }
  if (changed) await ctx.store.settings.set(SETTINGS_KEY, saved);
  return saved;
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
