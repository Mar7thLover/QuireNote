import { DEFAULT_PRESET_ID } from "@quirenote/core";
import { useQuery } from "@tanstack/react-query";
import { currentLang } from "@/i18n";
import { api } from "@/lib/api";
import { qk } from "@/lib/query";

/** 全部对话预设（内置在前，名称跟随界面语言）。 */
export function usePresets() {
  const lang = currentLang();
  return useQuery({ queryKey: qk.presets(lang), queryFn: () => api.presets.list(lang), staleTime: 60_000 });
}

export { DEFAULT_PRESET_ID };
