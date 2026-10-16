import { cn } from "@quirenote/ui";
import { Link } from "@tanstack/react-router";
import {
  Brain,
  Database,
  Info,
  Keyboard,
  LayoutTemplate,
  type LucideIcon,
  Palette,
  Regex,
} from "lucide-react";
import { lazy, Suspense } from "react";
import { AppHeader } from "@/components/AppHeader";
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
const ShortcutSettings = lazy(() =>
  import("@/features/settings/Shortcuts").then((m) => ({ default: m.ShortcutSettings })),
);

const SECTIONS: { id: string; icon: LucideIcon }[] = [
  { id: "appearance", icon: Palette },
  { id: "models", icon: Brain },
  { id: "templates", icon: LayoutTemplate },
  { id: "rules", icon: Regex },
  { id: "data", icon: Database },
  { id: "shortcuts", icon: Keyboard },
  { id: "about", icon: Info },
];

export function SettingsPage({ section }: { section: string }) {
  const { t } = useTranslation();
  const Body =
    {
      appearance: AppearanceSettings,
      models: ModelSettings,
      templates: TemplateSettings,
      rules: RuleSettings,
      data: DataSettings,
      shortcuts: ShortcutSettings,
      about: About,
    }[section] ?? AppearanceSettings;
  return (
    <div className="flex h-full flex-col">
      <AppHeader />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav
          className="flex shrink-0 gap-0.5 overflow-x-auto px-3 pb-2 md:w-56 md:flex-col md:px-3 md:pt-4"
          aria-label={t("settings.title")}
        >
          <h1 className="hidden px-2.5 pb-3 text-lg font-semibold md:block">{t("settings.title")}</h1>
          {SECTIONS.map((s) => (
            <Link
              key={s.id}
              to="/settings/$section"
              params={{ section: s.id }}
              className={cn(
                "flex h-8 shrink-0 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-ring",
                section === s.id && "bg-surface-hover font-medium text-fg",
              )}
            >
              <s.icon className="size-4" />
              {t(`settings.${s.id}`)}
            </Link>
          ))}
        </nav>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-4xl px-5 pt-4 pb-24 md:px-10 md:pt-8">
            <Suspense fallback={<PanelFallback />}>
              <Body />
            </Suspense>
          </div>
        </main>
      </div>
    </div>
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
          <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
          {description ? <p className="mt-1 text-[13px] text-fg-muted">{description}</p> : null}
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
