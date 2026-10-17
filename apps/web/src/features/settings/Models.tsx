import type {
  Capability,
  ModelAssignment,
  ProviderConfig,
  ProviderHeadersPatch,
  ProviderKind,
  ProviderModel,
} from "@quirenote/core";
import {
  Badge,
  Button,
  Checkbox,
  cn,
  Dialog,
  DialogContent,
  EmptyState,
  Field,
  Input,
  Select,
  Skeleton,
  Spinner,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@quirenote/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  CloudDownload,
  Info,
  KeyRound,
  Plug,
  Plus,
  Search,
  Server,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "@/i18n";
import { api, type ProviderCatalogEntry } from "@/lib/api";
import { useAssignments, useProviderCatalog, useProviders } from "@/lib/models";
import { qk, queryClient, removeFromList, upsertInList } from "@/lib/query";
import { SettingsSection } from "@/routes/settings";
import { useUi } from "@/stores/ui";

const CAPS: Capability[] = ["chat", "embedding", "search", "tts", "stt", "image", "video"];

export function ModelSettings() {
  const { t } = useTranslation();
  const catalog = useProviderCatalog();
  const providers = useProviders();
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
          {providers.isLoading ? <Skeleton className="h-16 rounded-xl" /> : null}
          {providers.data && !providers.data.length ? (
            <EmptyState
              icon={<Server />}
              title={t("models.addProvider")}
              description={t("models.noProviders")}
              action={
                <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
                  <Plus />
                  {t("models.addProvider")}
                </Button>
              }
            />
          ) : null}
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

function useUpdateProvider(id: string, onDone?: () => void) {
  return useMutation({
    mutationFn: (patch: Parameters<typeof api.providers.update>[1]) => api.providers.update(id, patch),
    onSuccess: (x) => {
      upsertInList(qk.providers, x);
      onDone?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

function ProviderRow({ p, entry }: { p: ProviderConfig; entry?: ProviderCatalogEntry }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const test = useMutation({ mutationFn: () => api.providers.test(p.id) });
  const update = useUpdateProvider(p.id);
  const remove = useMutation({
    mutationFn: () => api.providers.remove(p.id),
    onMutate: () => removeFromList(qk.providers, p.id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.assignments }),
  });

  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-3 p-3.5">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-medium">
            <span className="truncate">{p.name}</span>
            <span className="shrink-0 text-xs font-normal text-fg-subtle">{entry?.label ?? p.kind}</span>
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-fg-subtle">
            {p.hasKey ? (
              <span className="inline-flex items-center gap-1">
                <KeyRound className="size-3" />
                ••••{p.keyHint}
              </span>
            ) : entry?.requiresKey ? (
              <span className="text-warning">{t("models.noKey")}</span>
            ) : null}
            {p.baseUrl ? <span className="max-w-64 truncate">{p.baseUrl}</span> : null}
            <span>{t("models.modelsCount", { count: p.models.length })}</span>
            {p.headerNames.length ? (
              <span>
                {t("models.headers")} × {p.headerNames.length}
              </span>
            ) : null}
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
        <Button size="sm" variant={open ? "soft" : "ghost"} onClick={() => setOpen((o) => !o)}>
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
      {open ? (
        <div className="border-t border-border p-3.5">
          {entry?.notes ? (
            <p className="mb-3 flex gap-1.5 rounded-lg bg-warning-soft/60 px-2.5 py-1.5 text-xs leading-relaxed text-fg-muted">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
              {entry.notes}
            </p>
          ) : null}
          <Tabs defaultValue="models">
            <TabsList>
              <TabsTrigger value="models">{t("models.modelList")}</TabsTrigger>
              <TabsTrigger value="connection">{t("models.connection")}</TabsTrigger>
            </TabsList>
            <TabsContent value="models" className="pt-3">
              <ModelList p={p} entry={entry} />
            </TabsContent>
            <TabsContent value="connection" className="pt-3">
              <ConnectionForm p={p} entry={entry} />
            </TabsContent>
          </Tabs>
        </div>
      ) : null}
    </div>
  );
}

// ───────────── 连接：Key / Base URL / 自定义请求头 ─────────────

interface HeaderRow {
  key: number;
  name: string;
  value: string;
  /** 已保存在服务端的请求头（值不回传，留空表示不修改）。 */
  saved: boolean;
}

function ConnectionForm({ p, entry }: { p: ProviderConfig; entry?: ProviderCatalogEntry }) {
  const { t } = useTranslation();
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(p.baseUrl ?? "");
  const initialRows = () => p.headerNames.map((name, i) => ({ key: i, name, value: "", saved: true }));
  const [rows, setRows] = useState<HeaderRow[]>(initialRows);
  const update = useUpdateProvider(p.id, () => {
    setKey("");
    toast.success(t("common.save"));
  });

  const headerPatch = (): ProviderHeadersPatch | undefined => {
    const patch: ProviderHeadersPatch = {};
    const kept = new Set(rows.filter((r) => r.saved).map((r) => r.name.toLowerCase()));
    for (const name of p.headerNames) if (!kept.has(name.toLowerCase())) patch[name] = null;
    for (const r of rows) if (r.name.trim() && r.value) patch[r.name.trim()] = r.value;
    return Object.keys(patch).length ? patch : undefined;
  };

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const headers = headerPatch();
        update.mutate(
          { ...(key ? { apiKey: key } : {}), baseUrl: baseUrl || null, ...(headers ? { headers } : {}) },
          {
            onSuccess: (x) =>
              setRows(x.headerNames.map((name, i) => ({ key: i, name, value: "", saved: true }))),
          },
        );
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
          placeholder={entry?.defaultBaseUrl ?? "https://…/v1"}
        />
      </Field>
      <div className="space-y-2 sm:col-span-2">
        <div>
          <p className="text-[13px] font-medium">{t("models.headers")}</p>
          <p className="text-xs text-fg-subtle">{t("models.headersDesc")}</p>
        </div>
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-2">
            <Input
              value={r.name}
              disabled={r.saved}
              onChange={(e) =>
                setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, name: e.target.value } : x)))
              }
              placeholder={t("models.headerName")}
              aria-label={t("models.headerName")}
              className="w-56 font-mono text-[13px]"
            />
            <Input
              type="password"
              autoComplete="off"
              value={r.value}
              onChange={(e) =>
                setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, value: e.target.value } : x)))
              }
              placeholder={r.saved ? `${t("models.headerSaved")} ••••` : t("models.headerValue")}
              aria-label={t("models.headerValue")}
              className="flex-1 font-mono text-[13px]"
            />
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
              aria-label={t("common.delete")}
            >
              <X />
            </Button>
          </div>
        ))}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setRows((rs) => [...rs, { key: Date.now(), name: "", value: "", saved: false }])}
        >
          <Plus />
          {t("models.addHeader")}
        </Button>
      </div>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setKey("");
            setBaseUrl(p.baseUrl ?? "");
            setRows(initialRows());
          }}
        >
          {t("common.cancel")}
        </Button>
        <Button type="submit" variant="primary" size="sm" loading={update.isPending}>
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}

// ───────────── 模型列表 ─────────────

function CapToggles({
  caps,
  value,
  onChange,
}: {
  caps: Capability[];
  value: Capability[];
  onChange: (next: Capability[]) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-1">
      {caps.map((c) => {
        const on = value.includes(c);
        return (
          <button
            key={c}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== c) : [...value, c])}
            className={cn(
              "rounded-md border px-1.5 py-0.5 text-[11.5px] transition-colors focus-ring",
              on
                ? "border-border-strong bg-surface-sunken text-fg"
                : "border-border text-fg-subtle hover:bg-surface-hover hover:text-fg",
            )}
          >
            {t(`models.cap_${c}`)}
          </button>
        );
      })}
    </div>
  );
}

function ModelList({ p, entry }: { p: ProviderConfig; entry?: ProviderCatalogEntry }) {
  const { t } = useTranslation();
  const caps = (entry?.capabilities ?? []) as Capability[];
  const defaultCaps: Capability[] = caps.includes("chat") ? ["chat"] : caps.slice(0, 1);
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [newCaps, setNewCaps] = useState<Capability[]>(defaultCaps);
  const [fetching, setFetching] = useState(false);
  const update = useUpdateProvider(p.id);
  const save = (models: ProviderModel[]) => update.mutate({ models });

  const add = () => {
    const mid = id.trim();
    if (!mid) return;
    if (p.models.some((m) => m.id === mid)) return toast.error(t("models.modelExists", { id: mid }));
    if (!newCaps.length) return toast.error(t("models.capsRequired"));
    update.mutate(
      { models: [...p.models, { id: mid, label: label.trim() || null, capabilities: newCaps }] },
      {
        onSuccess: () => {
          setId("");
          setLabel("");
          setNewCaps(defaultCaps);
        },
      },
    );
  };

  return (
    <div className="space-y-3">
      {p.models.length ? (
        <div className="overflow-hidden rounded-lg border border-border">
          {p.models.map((m, i) => (
            <div
              key={m.id}
              className={cn(
                "grid items-center gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,10rem)_auto_auto]",
                i > 0 && "border-t border-border",
              )}
            >
              <span className="truncate font-mono text-[13px]" title={m.id}>
                {m.id}
              </span>
              <Input
                defaultValue={m.label ?? ""}
                placeholder={t("models.modelLabel")}
                aria-label={t("models.modelLabel")}
                className="h-7 text-[13px]"
                onBlur={(e) => {
                  const v = e.target.value.trim() || null;
                  if (v !== m.label) save(p.models.map((x) => (x.id === m.id ? { ...x, label: v } : x)));
                }}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              />
              <CapToggles
                caps={caps}
                value={m.capabilities}
                onChange={(next) =>
                  next.length
                    ? save(p.models.map((x) => (x.id === m.id ? { ...x, capabilities: next } : x)))
                    : toast.error(t("models.capsRequired"))
                }
              />
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => save(p.models.filter((x) => x.id !== m.id))}
                aria-label={t("common.delete")}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-lg bg-surface-sunken p-3 text-xs text-fg-muted">{t("models.noModels")}</p>
      )}
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Input
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder={t("models.modelId")}
          aria-label={t("models.modelId")}
          className="h-8 w-56 font-mono text-[13px]"
        />
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t("models.modelLabel")}
          aria-label={t("models.modelLabel")}
          className="h-8 w-40 text-[13px]"
        />
        <CapToggles caps={caps} value={newCaps} onChange={setNewCaps} />
        <Button type="submit" size="sm" variant="secondary" disabled={!id.trim()} loading={update.isPending}>
          <Plus />
          {t("models.addModel")}
        </Button>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => setFetching(true)}>
          <CloudDownload />
          {t("models.fetchModels")}
        </Button>
      </form>
      {fetching ? <FetchModelsDialog p={p} entry={entry} onClose={() => setFetching(false)} /> : null}
    </div>
  );
}

function FetchModelsDialog({
  p,
  entry,
  onClose,
}: {
  p: ProviderConfig;
  entry?: ProviderCatalogEntry;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const remote = useQuery({
    queryKey: ["remote-models", p.id],
    queryFn: () => api.providers.remoteModels(p.id),
  });
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Map<string, ProviderModel>>(new Map());
  const update = useUpdateProvider(p.id, onClose);
  const existing = new Set(p.models.map((m) => m.id));
  const shown = useMemo(
    () => (remote.data ?? []).filter((m) => m.id.toLowerCase().includes(q.trim().toLowerCase())),
    [remote.data, q],
  );
  const caps = (entry?.capabilities ?? []) as Capability[];

  const toggle = (m: ProviderModel) =>
    setPicked((cur) => {
      const next = new Map(cur);
      if (next.has(m.id)) next.delete(m.id);
      else next.set(m.id, m);
      return next;
    });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={t("models.fetchModels")}
        description={t("models.fetchModelsDesc")}
        className="max-w-xl"
      >
        <div className="space-y-3 px-5 pb-5">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-subtle" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("models.searchModels")}
              className="pl-8"
            />
          </div>
          <div className="max-h-80 overflow-y-auto rounded-lg border border-border">
            {remote.isLoading ? (
              <div className="grid place-items-center p-6">
                <Spinner />
              </div>
            ) : remote.isError ? (
              <p className="p-3 text-xs text-danger">{(remote.error as Error).message}</p>
            ) : !shown.length ? (
              <p className="p-3 text-xs text-fg-subtle">{t("models.fetchEmpty")}</p>
            ) : (
              shown.map((m, i) => {
                const added = existing.has(m.id);
                const sel = picked.get(m.id);
                return (
                  <div
                    key={m.id}
                    className={cn("flex items-center gap-2.5 px-3 py-1.5", i > 0 && "border-t border-border")}
                  >
                    <Checkbox
                      checked={added || !!sel}
                      disabled={added}
                      onCheckedChange={() => toggle(m)}
                      aria-label={m.id}
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]" title={m.id}>
                      {m.id}
                    </span>
                    {added ? (
                      <span className="text-[11px] text-fg-subtle">{t("models.alreadyAdded")}</span>
                    ) : sel ? (
                      <CapToggles
                        caps={caps}
                        value={sel.capabilities}
                        onChange={(next) =>
                          next.length &&
                          setPicked((cur) => new Map(cur).set(m.id, { ...sel, capabilities: next }))
                        }
                      />
                    ) : (
                      <span className="text-[11px] text-fg-subtle">
                        {m.capabilities.map((c) => t(`models.cap_${c}`)).join(" · ")}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              disabled={!picked.size}
              loading={update.isPending}
              onClick={() => update.mutate({ models: [...p.models, ...picked.values()] })}
            >
              {t("models.addSelected", { count: picked.size })}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── 添加提供方 ─────────────

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
      queryClient.setQueryData<ProviderConfig[]>(qk.providers, (old) =>
        old?.some((x) => x.id === p.id) ? old : [...(old ?? []), p],
      );
      // 服务端会用新提供方补上还没分配的对话 / 联网搜索 / 插图。
      queryClient.invalidateQueries({ queryKey: qk.assignments });
      onOpenChange(false);
      setName("");
      setKey("");
      setBaseUrl("");
    },
    onError: (e: Error) => toast.error(e.message),
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
            {catalog.map((c) => (
              <button
                key={c.kind}
                type="button"
                onClick={() => setKind(c.kind)}
                className={cn(
                  "flex h-16 flex-col items-start justify-center gap-0.5 rounded-lg border px-2.5 text-left transition-colors focus-ring",
                  kind === c.kind
                    ? "border-fg-subtle bg-surface-hover"
                    : "border-border hover:bg-surface-hover",
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
                placeholder={
                  entry?.defaultBaseUrl ?? (entry?.baseUrlRequired ? "https://…/v1" : t("models.default"))
                }
                required={!!entry?.baseUrlRequired && !entry.defaultBaseUrl}
              />
            </Field>
            <Field label={t("models.apiKey")} className="sm:col-span-2">
              <Input
                type="password"
                autoComplete="off"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={entry?.requiresKey === false ? t("models.optional") : "sk-…"}
              />
            </Field>
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

// ───────────── 能力分配 ─────────────

function Assignments({
  catalog,
  providers,
}: {
  catalog: Map<string, ProviderCatalogEntry>;
  providers: ProviderConfig[];
}) {
  const { t } = useTranslation();
  const assignments = useAssignments();
  const onError = (e: Error) => toast.error(e.message);
  const assign = useMutation({
    mutationFn: api.providers.assign,
    onSuccess: (list) => queryClient.setQueryData(qk.assignments, list),
    onError,
  });
  const unassign = useMutation({
    mutationFn: api.providers.unassign,
    onSuccess: (list) => queryClient.setQueryData(qk.assignments, list),
    onError,
  });
  const enabled = providers.filter((p) => p.enabled);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      {CAPS.map((cap, i) => {
        const a: ModelAssignment | undefined = assignments.data?.find((x) => x.capability === cap);
        const options = enabled.filter((p) => catalog.get(p.kind)?.capabilities.includes(cap));
        const prov = providers.find((p) => p.id === a?.providerId);
        const models = (prov?.models ?? []).filter((m) => m.capabilities.includes(cap));
        const modelOptions = models.map((m) => ({
          value: m.id,
          label: m.label ? `${m.label} · ${m.id}` : m.id,
        }));
        if (a && !models.some((m) => m.id === a.model))
          modelOptions.unshift({ value: a.model, label: a.model });
        return (
          <div
            key={cap}
            className={cn(
              "grid items-center gap-3 p-3.5 sm:grid-cols-[9rem_1fr_1fr_2rem]",
              i > 0 && "border-t border-border",
            )}
          >
            <span className="text-[13.5px] font-medium">{t(`models.cap_${cap}`)}</span>
            {!a && !options.length ? (
              <Fallback cap={cap} />
            ) : (
              <>
                <Select
                  value={a?.providerId}
                  onValueChange={(providerId) => {
                    const first = providers
                      .find((p) => p.id === providerId)
                      ?.models.find((m) => m.capabilities.includes(cap));
                    if (!first) return toast.error(t("models.noModelsForCap"));
                    assign.mutate({ capability: cap, providerId, model: first.id });
                  }}
                  options={options.map((p) => ({ value: p.id, label: p.name }))}
                  placeholder={options.length ? t("models.pickProvider") : t("models.noProviderForCap")}
                  ariaLabel={`${t(`models.cap_${cap}`)} · ${t("models.pickProvider")}`}
                />
                <Select
                  value={a?.model}
                  onValueChange={(model) => a && model !== a.model && assign.mutate({ ...a, model })}
                  options={modelOptions}
                  placeholder={a ? t("models.modelPlaceholder") : t("models.notAssigned")}
                  ariaLabel={`${t(`models.cap_${cap}`)} · ${t("models.model")}`}
                  className="font-mono text-[13px]"
                />
                {a ? (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => unassign.mutate(cap)}
                    aria-label={t("models.unassign")}
                    title={t("models.unassign")}
                  >
                    <X />
                  </Button>
                ) : (
                  <span />
                )}
              </>
            )}
            {a || !options.length ? null : <FallbackNote cap={cap} />}
          </div>
        );
      })}
    </div>
  );
}

/** 未分配模型时实际会发生什么：有替代方案的照实说明，没有的说明影响哪些功能。 */
const FALLBACK: Partial<Record<Capability, { works: boolean; manual?: string }>> = {
  embedding: { works: true, manual: "chat" },
  search: { works: false, manual: "research" },
  tts: { works: true, manual: "studio" },
  stt: { works: false, manual: "sources" },
  image: { works: false, manual: "studio" },
  video: { works: true, manual: "studio" },
};

function Fallback({ cap }: { cap: Capability }) {
  const { t } = useTranslation();
  const f = FALLBACK[cap];
  return (
    <div className="flex min-h-9 items-start gap-2 rounded-lg bg-surface-sunken px-3 py-2 sm:col-span-2">
      {f?.works ? (
        <Check className="mt-0.5 size-4 shrink-0 text-success" strokeWidth={2} />
      ) : (
        <Info className="mt-0.5 size-4 shrink-0 text-fg-subtle" strokeWidth={1.8} />
      )}
      <span className="flex-1 text-[13px] leading-relaxed text-fg-muted">
        <span className={cn(f?.works && "font-medium text-fg")}>{t(`models.fallback_${cap}`)}</span>
        {f?.manual ? (
          <button
            type="button"
            onClick={() => useUi.getState().set({ manual: f.manual! })}
            className="ml-2 text-fg-subtle underline decoration-border-strong underline-offset-4 hover:text-fg"
          >
            {t("models.learnMore")}
          </button>
        ) : null}
      </span>
    </div>
  );
}

/** 有可选的提供方但还没分配：在两个下拉框下面说明不分配时的行为。 */
function FallbackNote({ cap }: { cap: Capability }) {
  const { t } = useTranslation();
  if (!FALLBACK[cap]?.works) return null;
  return (
    <p className="flex items-center gap-1.5 text-[12.5px] text-fg-subtle sm:col-span-4 sm:col-start-2">
      <Check className="size-3.5 shrink-0 text-success" strokeWidth={2} />
      {t(`models.fallbackNote_${cap}`)}
    </p>
  );
}
