/** 设置 → 插件：每个插件一张卡片，写明它加了什么，开关即时生效。 */
import { Skeleton, Switch, toast } from "@quirenote/ui";
import { PLUGIN_CATALOG, setPluginEnabled, usePlugins } from "@/features/plugins/catalog";
import { useTranslation } from "@/i18n";
import { SettingsSection } from "@/routes/settings";

export function PluginSettings() {
  const { t } = useTranslation();
  const plugins = usePlugins();
  return (
    <SettingsSection title={t("settings.plugins")} description={t("plugins.desc")}>
      <div className="flex flex-col gap-3">
        {plugins.isLoading ? <Skeleton className="h-40 rounded-xl" /> : null}
        {PLUGIN_CATALOG.map((p) => {
          const state = plugins.data?.find((x) => x.id === p.id);
          if (!state) return null;
          const features = t(`${p.key}.features`).split("\n").filter(Boolean);
          return (
            <div key={p.id} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-sunken text-fg-muted [&_svg]:size-[18px]">
                  <p.icon />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[14.5px] font-medium">{t(`${p.key}.name`)}</span>
                  <span className="text-[13px] leading-relaxed text-fg-subtle">{t(`${p.key}.desc`)}</span>
                </div>
                <Switch
                  checked={state.enabled}
                  aria-label={t(`${p.key}.name`)}
                  onCheckedChange={(v) =>
                    setPluginEnabled(p.id, v).catch((e: Error) => toast.error(e.message))
                  }
                />
              </div>
              <ul className="mt-3 ml-12 flex list-disc flex-col gap-1 pl-4 text-[13px] leading-relaxed text-fg-muted">
                {features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          );
        })}
        <p className="text-[12.5px] leading-relaxed text-fg-subtle">{t("plugins.keepData")}</p>
      </div>
    </SettingsSection>
  );
}
