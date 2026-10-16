import type { Capability, ProviderConfig, ProviderKind } from "@quirenote/core";
import {
  Badge,
  Button,
  cn,
  Dialog,
  DialogContent,
  Field,
  Input,
  Select,
  Skeleton,
  Switch,
  toast,
} from "@quirenote/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Plug,
  Plus,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "@/i18n";
import { api, type ProviderCatalogEntry } from "@/lib/api";
import { qk, queryClient, removeFromList, upsertInList } from "@/lib/query";
import { SettingsSection } from "@/routes/settings";

const CAPS: Capability[] = ["chat", "embedding", "search", "tts", "stt", "image", "video"];

export function ModelSettings() {
  const { t } = useTranslation();
  const catalog = useQuery({
    queryKey: qk.catalog,
    queryFn: api.providers.catalog,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const providers = useQuery({ queryKey: qk.providers, queryFn: api.providers.list });
  const [adding, setAdding] = useState(false);
  const cat = new Map((catalog.data ?? []).map((c) => [c.kind, c]));

  return (
    <>
      <SettingsSection
        title={t("models.providers")}
        description={t("models.keySecurity")}
        action={
          <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
            <Plus />
            {t("models.addProvider")}
          </Button>
        }
      >
        <div className="space-y-2">
          <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3.5">
            <ProviderGlyph kind="local" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Local</p>
              <p className="text-xs text-fg-subtle">{t("models.builtinLocal")}</p>
            </div>
            <Badge tone="success">
              <ShieldCheck />
              内置
            </Badge>
          </div>
          {providers.isLoading ? <Skeleton className="h-16 rounded-xl" /> : null}
          {(providers.data ?? []).map((p) => (
            <ProviderRow key={p.id} p={p} entry={cat.get(p.kind)} />
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title={t("models.assignments")} description={t("models.assignmentsDesc")}>
        <Assignments catalog={cat} providers={providers.data ?? []} />
      </SettingsSection>

      <AddProviderDialog open={adding} onOpenChange={setAdding} catalog={catalog.data ?? []} />
    </>
  );
}

function ProviderGlyph({ kind }: { kind: string }) {
  const hue = [...kind].reduce((a, c) => a + c.charCodeAt(0) * 7, 0) % 360;
  return (
    <span
      className="grid size-9 shrink-0 place-items-center rounded-lg text-[13px] font-bold uppercase"
      style={{ background: `oklch(0.93 0.04 ${hue})`, color: `oklch(0.45 0.12 ${hue})` }}
    >
      {kind.slice(0, 2)}
    </span>
  );
}

function ProviderRow({ p, entry }: { p: ProviderConfig; entry?: ProviderCatalogEntry }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(p.baseUrl ?? "");
  const test = useMutation({ mutationFn: () => api.providers.test(p.id) });
  const update = useMutation({
    mutationFn: (patch: Parameters<typeof api.providers.update>[1]) => api.providers.update(p.id, patch),
    onSuccess: (x) => {
      upsertInList(qk.providers, x);
      setKey("");
      setEditing(false);
      toast.success(t("common.save"));
    },
  });
  const remove = useMutation({
    mutationFn: () => api.providers.remove(p.id),
    onMutate: () => removeFromList(qk.providers, p.id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.assignments }),
  });

  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="flex items-center gap-3 p-3.5">
        <ProviderGlyph kind={p.kind} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-medium">
            {p.name}
            <span className="text-xs font-normal text-fg-subtle">{entry?.label ?? p.kind}</span>
          </p>
          <p className="mt-0.5 flex items-center gap-2 text-xs text-fg-subtle">
            {p.hasKey ? (
              <span className="inline-flex items-center gap-1">
                <KeyRound className="size-3" />
                ••••{p.keyHint}
              </span>
            ) : entry?.requiresKey ? (
              <span className="text-warning">未设置 Key</span>
            ) : null}
            {p.baseUrl ? <span className="truncate">{p.baseUrl}</span> : null}
            {entry ? <span>{entry.capabilities.map((c) => t(`models.cap_${c}`)).join(" · ")}</span> : null}
          </p>
        </div>
        {test.data ? (
          test.data.ok ? (
            <Badge tone="success">
              <CheckCircle2 />
              {t("models.testOk", { ms: test.data.latencyMs })}
            </Badge>
          ) : (
            <Badge tone="danger" title={test.data.error}>
              <XCircle />
              {t("models.testFail", { error: (test.data.error ?? "").slice(0, 40) })}
            </Badge>
          )
        ) : null}
        <Button size="sm" variant="ghost" onClick={() => test.mutate()} loading={test.isPending}>
          {test.isPending ? null : <Plug />}
          {t("models.test")}
        </Button>
        <Switch
          checked={p.enabled}
          onCheckedChange={(v) => update.mutate({ enabled: v })}
          aria-label={t("models.enabled")}
        />
        <Button size="sm" variant="ghost" onClick={() => setEditing((e) => !e)}>
          {t("common.edit")}
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => confirm(t("models.deleteConfirm", { name: p.name })) && remove.mutate()}
          aria-label={t("common.delete")}
        >
          <Trash2 />
        </Button>
      </div>
      {entry?.notes ? (
        <p className="mx-3.5 mb-3 flex gap-1.5 rounded-lg bg-warning-soft/60 px-2.5 py-1.5 text-xs leading-relaxed text-fg-muted">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
          {entry.notes}
        </p>
      ) : null}
      {editing ? (
        <form
          className="grid gap-3 border-t border-border p-3.5 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate({ ...(key ? { apiKey: key } : {}), baseUrl: baseUrl || null });
          }}
        >
          <Field
            label={t("models.apiKey")}
            hint={p.hasKey ? t("models.apiKeyKeep", { hint: p.keyHint }) : undefined}
          >
            <Input
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={p.hasKey ? "••••••••" : "sk-…"}
            />
          </Field>
          <Field label={t("models.baseUrl")}>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={entry?.defaultBaseUrl ?? ""}
            />
          </Field>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" size="sm" loading={update.isPending}>
              {t("common.save")}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function AddProviderDialog({
  open,
  onOpenChange,
  catalog,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  catalog: ProviderCatalogEntry[];
}) {
  const { t } = useTranslation();
  const choices = catalog.filter((c) => c.kind !== "local");
  const [kind, setKind] = useState<string>("anthropic");
  const entry = catalog.find((c) => c.kind === kind);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const create = useMutation({
    mutationFn: () =>
      api.providers.create({
        kind: kind as ProviderKind,
        name: name.trim() || entry?.label || kind,
        apiKey: key || undefined,
        baseUrl: baseUrl || null,
      }),
    onSuccess: (p) => {
      upsertInList(qk.providers, p);
      queryClient.setQueryData<ProviderConfig[]>(qk.providers, (old) =>
        old?.some((x) => x.id === p.id) ? old : [...(old ?? []), p],
      );
      onOpenChange(false);
      setName("");
      setKey("");
      setBaseUrl("");
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t("models.addProvider")}
        description={t("models.keySecurity")}
        className="max-w-xl"
      >
        <form
          className="space-y-4 px-5 pb-5"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
            {choices.map((c) => (
              <button
                key={c.kind}
                type="button"
                onClick={() => setKind(c.kind)}
                className={cn(
                  "flex h-16 flex-col items-start justify-center gap-0.5 rounded-lg border px-2.5 text-left transition-colors focus-ring",
                  kind === c.kind ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-hover",
                )}
              >
                <span className="text-[13px] font-medium">{c.label}</span>
                <span className="line-clamp-1 text-[10.5px] text-fg-subtle">
                  {c.capabilities.map((x) => t(`models.cap_${x}`)).join("·")}
                </span>
              </button>
            ))}
          </div>
          {entry?.notes ? (
            <p className="rounded-lg bg-surface-sunken p-2.5 text-xs leading-relaxed text-fg-muted">
              {entry.notes}
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("models.name")}>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={entry?.label} />
            </Field>
            <Field label={t("models.baseUrl")}>
              <Input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={entry?.defaultBaseUrl ?? "默认"}
              />
            </Field>
            {entry?.requiresKey !== false ? (
              <Field label={t("models.apiKey")} className="sm:col-span-2">
                <Input
                  type="password"
                  autoComplete="off"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="sk-…"
                />
              </Field>
            ) : null}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" loading={create.isPending}>
              {t("common.add")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Assignments({
  catalog,
  providers,
}: {
  catalog: Map<string, ProviderCatalogEntry>;
  providers: ProviderConfig[];
}) {
  const { t } = useTranslation();
  const assignments = useQuery({ queryKey: qk.assignments, queryFn: api.providers.assignments });
  const assign = useMutation({
    mutationFn: api.providers.assign,
    onSuccess: (list) => queryClient.setQueryData(qk.assignments, list),
  });
  const all = [
    { id: "local", kind: "local", name: "Local", enabled: true },
    ...providers.filter((p) => p.enabled),
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      {CAPS.map((cap, i) => {
        const a = assignments.data?.find((x) => x.capability === cap);
        const options = all.filter((p) => catalog.get(p.kind)?.capabilities.includes(cap));
        const prov = all.find((p) => p.id === a?.providerId);
        const models = prov ? (catalog.get(prov.kind)?.models[cap] ?? []) : [];
        return (
          <div
            key={cap}
            className={cn(
              "grid items-center gap-3 p-3.5 sm:grid-cols-[9rem_1fr_1fr]",
              i > 0 && "border-t border-border",
            )}
          >
            <span className="text-[13.5px] font-medium">{t(`models.cap_${cap}`)}</span>
            <Select
              value={a?.providerId}
              onValueChange={(providerId) => {
                const kind = all.find((p) => p.id === providerId)?.kind ?? "";
                const model = catalog.get(kind)?.models[cap]?.[0] ?? "";
                assign.mutate({ capability: cap, providerId, model });
              }}
              options={options.map((p) => ({ value: p.id, label: p.name }))}
              placeholder={options.length ? "选择提供方" : "没有支持该能力的提供方"}
            />
            <ModelInput
              key={`${cap}-${a?.providerId}-${a?.model}`}
              value={a?.model ?? ""}
              suggestions={models}
              disabled={!a}
              onCommit={(model) => a && model !== a.model && assign.mutate({ ...a, model })}
            />
            {cap === "embedding" && prov?.kind === "anthropic" ? (
              <p className="text-xs text-danger sm:col-span-3">
                Anthropic 没有 Embedding 接口，请改用 OpenAI、Gemini、Ollama 或内置 Local。
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ModelInput({
  value,
  suggestions,
  disabled,
  onCommit,
}: {
  value: string;
  suggestions: string[];
  disabled: boolean;
  onCommit: (v: string) => void;
}) {
  const { t } = useTranslation();
  const id = `models-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <>
      <Input
        list={id}
        defaultValue={value}
        disabled={disabled}
        placeholder={t("models.modelPlaceholder")}
        onBlur={(e) => onCommit(e.target.value.trim())}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className="font-mono text-[13px]"
      />
      <datalist id={id}>
        {suggestions.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
    </>
  );
}
