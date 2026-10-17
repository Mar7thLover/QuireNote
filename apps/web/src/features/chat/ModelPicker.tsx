import type { ModelChoice } from "@quirenote/core";
import {
  cn,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@quirenote/ui";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ChevronDown, Settings2, Sparkles } from "lucide-react";
import { useTranslation } from "@/i18n";
import { describeModel, sameChoice, useAssignments, useModelGroups, useProviders } from "@/lib/models";

/** 对话输入框里的模型切换：跟随默认分配，或指定某个提供方的某个对话模型。 */
export function ModelPicker({
  value,
  onChange,
}: {
  value: ModelChoice | null;
  onChange: (v: ModelChoice | null) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const providers = useProviders();
  const assignments = useAssignments();
  const { groups } = useModelGroups("chat");
  const fallback = assignments.data?.find((a) => a.capability === "chat") ?? null;
  // 选中的模型所在提供方被删除或停用时，服务端会退回默认分配；这里同样显示默认。
  const usable = value && groups.some((g) => g.provider.id === value.providerId) ? value : null;
  const effective = usable ?? fallback;
  const label = effective ? describeModel(providers.data, effective).model : t("chat.modelMissing");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex min-w-0 max-w-52 shrink items-center gap-1 rounded-md px-1.5 py-0.5 text-xs transition-colors hover:bg-surface-hover focus-ring",
            effective ? "text-fg-subtle hover:text-fg" : "text-warning",
          )}
          aria-label={t("chat.model")}
          title={t("chat.model")}
        >
          {effective ? (
            <Sparkles className="size-3.5 shrink-0" />
          ) : (
            <AlertTriangle className="size-3.5 shrink-0" />
          )}
          <span className="truncate">{label}</span>
          <ChevronDown className="size-3 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-96 w-72 overflow-y-auto">
        <DropdownMenuLabel>{t("chat.model")}</DropdownMenuLabel>
        <DropdownMenuCheckboxItem checked={!usable} className="h-auto py-1.5" onSelect={() => onChange(null)}>
          <span className="min-w-0 flex-1">
            <span className="block">{t("chat.modelDefault")}</span>
            <span className="block truncate text-[11px] text-fg-subtle">
              {fallback
                ? (() => {
                    const d = describeModel(providers.data, fallback);
                    return d.provider ? `${d.provider} · ${d.model}` : d.model;
                  })()
                : t("chat.modelMissing")}
            </span>
          </span>
        </DropdownMenuCheckboxItem>
        {groups.map((g) => (
          <div key={g.provider.id}>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="truncate">{g.provider.name}</DropdownMenuLabel>
            {g.models.map((m) => {
              const choice = { providerId: g.provider.id, model: m.id };
              return (
                <DropdownMenuCheckboxItem
                  key={m.id}
                  checked={sameChoice(usable, choice)}
                  onSelect={() => onChange(choice)}
                >
                  <span className="min-w-0 flex-1 truncate">{m.label || m.id}</span>
                  {m.label ? (
                    <span className="max-w-28 shrink-0 truncate font-mono text-[10.5px] text-fg-subtle">
                      {m.id}
                    </span>
                  ) : null}
                </DropdownMenuCheckboxItem>
              );
            })}
          </div>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => navigate({ to: "/settings/$section", params: { section: "models" } })}
        >
          <Settings2 />
          {t("chat.modelManage")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
