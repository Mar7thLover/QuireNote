import { cn } from "@quirenote/ui";
import { Link } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { AppHeader } from "@/components/AppHeader";
import { AppShell, SETTINGS_SECTIONS } from "@/components/AppSidebar";
import { PanelFallback } from "@/features/panels";
import { useTranslation } from "@/i18n";

const AppearanceSettings = lazy(() =>
  import("@/features/settings/Appearance").then((m) => ({ default: m.AppearanceSettings })),
);
const ModelSettings = lazy(() =>
  import("@/features/settings/Models").then((m) => ({ default: m.ModelSettings })),
);
const TemplateSettings = lazy(() =>
  import("@/features/settings/Templates").then((m) => ({ default: m.TemplateSettings })),
);
const RuleSettings = lazy(() =>
  import("@/features/settings/Rules").then((m) => ({ default: m.RuleSettings })),
);
const DataSettings = lazy(() =>
  import("@/features/settings/Data").then((m) => ({ default: m.DataSettings })),
);
const SharingSettings = lazy(() =>
  import("@/features/settings/Sharing").then((m) => ({ default: m.SharingSettings })),
);
const PresetSettings = lazy(() =>
  import("@/features/settings/Presets").then((m) => ({ default: m.PresetSettings })),
);
const PluginSettings = lazy(() =>
  import("@/features/settings/Plugins").then((m) => ({ default: m.PluginSettings })),
);
const ShortcutSettings = lazy(() =>
  import("@/features/settings/Shortcuts").then((m) => ({ default: m.ShortcutSettings })),
);

export function SettingsPage({ section }: { section: string }) {
  const { t } = useTranslation();
  const Body =
    {
      appearance: AppearanceSettings,
      models: ModelSettings,
      templates: TemplateSettings,
      rules: RuleSettings,
      data: DataSettings,
      sharing: SharingSettings,
      plugins: PluginSettings,
      presets: PresetSettings,
      shortcuts: ShortcutSettings,
      about: About,
    }[section] ?? ModelSettings;
  return (
    <AppShell>
      <div className="md:hidden">
        <AppHeader />
        {/* 窄屏没有侧栏：分区导航横排 */}
        <nav className="flex gap-0.5 overflow-x-auto px-3 pb-2" aria-label={t("settings.title")}>
          {SETTINGS_SECTIONS.map((s) => (
            <Link
              key={s.id}
              to="/settings/$section"
              params={{ section: s.id }}
              className={cn(
                "flex h-8 shrink-0 items-center rounded-md px-2.5 text-[13.5px] text-fg-muted hover:bg-surface-hover focus-ring",
                section === s.id && "bg-surface-hover font-medium text-fg",
              )}
            >
              {t(`settings.${s.id}`)}
            </Link>
          ))}
        </nav>
      </div>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[880px] px-5 pt-6 pb-24 sm:px-10 sm:pt-12">
          <h1 className="mb-8 font-serif text-[30px] leading-tight font-normal">
            {t(`settings.${section}`)}
          </h1>
          <Suspense fallback={<PanelFallback />}>
            <Body />
          </Suspense>
        </div>
      </main>
    </AppShell>
  );
}

export function SettingsSection({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[17px] font-semibold">{title}</h2>
          {description ? <p className="mt-1 text-[13.5px] text-fg-subtle">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function About() {
  return (
    <SettingsSection title="关于 QuireNote" description="前端优先、多模型、可自托管的 AI Notebook。">
      <div className="space-y-2 text-[13.5px] leading-relaxed text-fg-muted">
        <p>数据保存在你自己的服务器上；API Key 在服务端加密存储，任何接口都不回传明文。</p>
        <p>
          QuireNote = quire（书帖）+ note。源代码与文档见仓库 README。按 <kbd>Ctrl</kbd>+<kbd>/</kbd>{" "}
          查看全部快捷键。
        </p>
      </div>
    </SettingsSection>
  );
}
