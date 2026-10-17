/**
 * 知识书面板：条目列表 + 条目编辑、「试一试」触发测试、这本 Notebook 的 AI 说明、整本设置。
 * 字段与触发规则见 docs/CARD_SPEC.md「知识书」。
 */
import type { LorebookSettings, LoreEntry, LoreEntryInput, LorePosition } from "@quirenote/core";
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  Select,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from "@quirenote/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, FlaskConical, LibraryBig, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { PanelShell } from "@/components/Panel";
import { currentLang, useTranslation } from "@/i18n";
import { api, type LoreTestResult } from "@/lib/api";
import { qk, queryClient } from "@/lib/query";

export function LorebookPanel({ notebookId }: { notebookId: string }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"entries" | "ai" | "settings">("entries");
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const q = useQuery({ queryKey: qk.lorebook(notebookId), queryFn: () => api.lorebook.get(notebookId) });
  const entries = q.data?.entries ?? [];
  const current = entries.find((e) => e.id === selected) ?? null;

  const create = useMutation({
    mutationFn: () => api.lorebook.create(notebookId, { name: t("lorebook.newEntry"), keys: [] }),
    onSuccess: (e) => {
      queryClient.setQueryData(qk.lorebook(notebookId), (old: typeof q.data) =>
        old ? { ...old, entries: [...old.entries, e] } : old,
      );
      setSelected(e.id);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const fromElements = useMutation({
    mutationFn: () => api.lorebook.fromElements(notebookId, currentLang()),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: qk.lorebook(notebookId) });
      toast(
        r.created ? t("lorebook.fromElementsDone", { count: r.created }) : t("lorebook.fromElementsNone"),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return entries;
    return entries.filter((e) => `${e.name} ${e.keys.join(" ")} ${e.content}`.toLowerCase().includes(f));
  }, [entries, filter]);

  return (
    <PanelShell
      toolbar={
        <>
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList>
              <TabsTrigger value="entries">{t("lorebook.tabEntries")}</TabsTrigger>
              <TabsTrigger value="ai">{t("lorebook.tabAi")}</TabsTrigger>
              <TabsTrigger value="settings">{t("lorebook.tabSettings")}</TabsTrigger>
            </TabsList>
          </Tabs>
          <span className="flex-1" />
          {tab === "entries" ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => fromElements.mutate()}
                loading={fromElements.isPending}
                aria-label={t("lorebook.fromElements")}
                title={t("lorebook.fromElements")}
              >
                <Sparkles />
                <span className="hidden @[38rem]:inline">{t("lorebook.fromElements")}</span>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t("common.export")}
                    title={t("common.export")}
                  >
                    <Download />
                    <span className="hidden @[38rem]:inline">{t("common.export")}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => window.open(api.lorebook.exportUrl(notebookId, "quire"))}>
                    {t("lorebook.exportQuire")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => window.open(api.lorebook.exportUrl(notebookId, "sillytavern"))}
                  >
                    {t("lorebook.exportSt")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                size="sm"
                variant="primary"
                className="shrink-0"
                onClick={() => create.mutate()}
                loading={create.isPending}
                aria-label={t("lorebook.newEntry")}
              >
                <Plus />
                <span className="hidden @[28rem]:inline">{t("lorebook.newEntry")}</span>
              </Button>
            </>
          ) : null}
        </>
      }
    >
      {tab === "ai" ? (
        <AiInstructions notebookId={notebookId} />
      ) : tab === "settings" ? (
        q.data ? (
          <SettingsForm notebookId={notebookId} settings={q.data.settings} />
        ) : null
      ) : (
        <div className="@container flex h-full min-h-0 flex-col">
          <TestBar notebookId={notebookId} onPick={setSelected} />
          {entries.length === 0 && q.isSuccess ? (
            <EmptyState
              className="flex-1"
              icon={<LibraryBig />}
              title={t("lorebook.emptyTitle")}
              description={t("lorebook.emptyDesc")}
            />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col @[720px]:flex-row">
              <div className="flex min-h-0 shrink-0 flex-col border-border @[720px]:w-72 @[720px]:border-r max-h-[40%] @[720px]:max-h-none border-b @[720px]:border-b-0">
                <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                  <Search className="size-4 shrink-0 text-fg-subtle" />
                  <input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder={t("lorebook.filter")}
                    className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-fg-subtle"
                  />
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                  {shown.map((e) => (
                    <EntryRow
                      key={e.id}
                      entry={e}
                      active={e.id === current?.id}
                      onClick={() => setSelected(e.id)}
                    />
                  ))}
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {current ? (
                  <EntryEditor
                    key={current.id}
                    notebookId={notebookId}
                    entry={current}
                    onDeleted={() => setSelected(null)}
                  />
                ) : (
                  <p className="px-6 py-10 text-center text-[13px] text-fg-subtle">{t("lorebook.pick")}</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </PanelShell>
  );
}

function positionLabel(t: (k: string, o?: Record<string, unknown>) => string, e: LoreEntry): string {
  return e.position === "at_depth"
    ? t("lorebook.posDepthN", { n: e.depth })
    : t(`lorebook.pos_${e.position}`);
}

function EntryRow({ entry: e, active, onClick }: { entry: LoreEntry; active: boolean; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-hover focus-ring",
        active && "bg-surface-hover",
        !e.enabled && "opacity-55",
      )}
    >
      <span className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
          {e.name || e.keys[0] || t("common.untitled")}
        </span>
        {e.constant ? <Badge>{t("lorebook.constant")}</Badge> : null}
        {!e.enabled ? <Badge>{t("lorebook.disabled")}</Badge> : null}
      </span>
      <span className="truncate text-[12px] text-fg-subtle">
        {e.constant ? positionLabel(t, e) : e.keys.join("、") || t("lorebook.noKeys")}
      </span>
    </button>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 rounded bg-surface-sunken px-1.5 text-[11px] leading-5 text-fg-muted">
      {children}
    </span>
  );
}

const splitKeys = (s: string) =>
  s
    .split(/[,，、\n]/)
    .map((k) => k.trim())
    .filter(Boolean);

/** 正则键写成 /…/，里面可能有逗号：按 / 开头的整段保留。 */
function parseKeys(s: string): string[] {
  const out: string[] = [];
  for (const part of s.split(/\n/)) {
    const trimmed = part.trim();
    if (/^\/.+\/[a-z]*$/.test(trimmed)) out.push(trimmed);
    else out.push(...splitKeys(trimmed));
  }
  return out;
}

function EntryEditor({
  notebookId,
  entry,
  onDeleted,
}: {
  notebookId: string;
  entry: LoreEntry;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const save = useMutation({
    mutationFn: (patch: LoreEntryInput) => api.lorebook.update(entry.id, patch),
    onSuccess: (e) =>
      queryClient.setQueryData(
        qk.lorebook(notebookId),
        (old: { settings: LorebookSettings; entries: LoreEntry[] } | undefined) =>
          old ? { ...old, entries: old.entries.map((x) => (x.id === e.id ? e : x)) } : old,
      ),
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: () => api.lorebook.remove(entry.id),
    onSuccess: () => {
      queryClient.setQueryData(
        qk.lorebook(notebookId),
        (old: { settings: LorebookSettings; entries: LoreEntry[] } | undefined) =>
          old ? { ...old, entries: old.entries.filter((x) => x.id !== entry.id) } : old,
      );
      onDeleted();
    },
  });
  const set = (patch: LoreEntryInput) => save.mutate(patch);
  const num = (v: string): number | null => (v.trim() === "" ? null : Number(v));
  const tri = (v: boolean | null) => (v === null ? "inherit" : v ? "yes" : "no");
  const fromTri = (v: string): boolean | null => (v === "inherit" ? null : v === "yes");
  const keysText = entry.keys.join("、");

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-5 px-5 py-5">
      <div className="flex items-center gap-2">
        <input
          defaultValue={entry.name}
          placeholder={t("lorebook.namePlaceholder")}
          onBlur={(e) => e.target.value !== entry.name && set({ name: e.target.value })}
          className="min-w-0 flex-1 bg-transparent font-serif text-[22px] outline-none placeholder:text-fg-subtle"
        />
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t("common.delete")}
          onClick={() => confirm(t("lorebook.deleteConfirm")) && remove.mutate()}
        >
          <Trash2 />
        </Button>
      </div>

      <Row label={t("lorebook.keys")} hint={t("lorebook.keysHint")}>
        <Input
          defaultValue={keysText}
          disabled={entry.constant}
          placeholder={entry.constant ? t("lorebook.constantNoKeys") : "图灵测试、Turing test、/模仿游戏?/"}
          onBlur={(e) => e.target.value !== keysText && set({ keys: parseKeys(e.target.value) })}
        />
      </Row>

      <Row label={t("lorebook.secondary")} hint={t("lorebook.secondaryHint")}>
        <div className="flex gap-2">
          <Select
            value={entry.logic}
            onValueChange={(v) => set({ logic: v as LoreEntry["logic"] })}
            options={(["and_any", "and_all", "not_any", "not_all"] as const).map((v) => ({
              value: v,
              label: t(`lorebook.logic_${v}`),
            }))}
            className="w-40 shrink-0"
            ariaLabel={t("lorebook.secondary")}
          />
          <Input
            defaultValue={entry.secondary_keys.join("、")}
            disabled={entry.constant}
            onBlur={(e) =>
              e.target.value !== entry.secondary_keys.join("、") &&
              set({ secondary_keys: parseKeys(e.target.value) })
            }
          />
        </div>
      </Row>

      <Row label={t("lorebook.content")} hint={t("lorebook.contentHint")}>
        <Textarea
          defaultValue={entry.content}
          onBlur={(e) => e.target.value !== entry.content && set({ content: e.target.value })}
          className="min-h-36 font-serif text-[15px] leading-relaxed [field-sizing:content]"
        />
      </Row>

      <div className="flex flex-wrap gap-x-8 gap-y-3">
        <Toggle
          label={t("lorebook.constant")}
          hint={t("lorebook.constantHint")}
          checked={entry.constant}
          onChange={(v) => set({ constant: v })}
        />
        <Toggle label={t("lorebook.enabled")} checked={entry.enabled} onChange={(v) => set({ enabled: v })} />
      </div>

      <div className="grid grid-cols-1 gap-4 @[520px]:grid-cols-3">
        <Row label={t("lorebook.position")}>
          <Select
            value={entry.position}
            onValueChange={(v) => set({ position: v as LorePosition })}
            options={(["before_sources", "after_sources", "at_depth"] as const).map((v) => ({
              value: v,
              label: t(`lorebook.pos_${v}`),
            }))}
            ariaLabel={t("lorebook.position")}
          />
        </Row>
        {entry.position === "at_depth" ? (
          <>
            <Row label={t("lorebook.depth")}>
              <Input
                type="number"
                min={0}
                defaultValue={entry.depth}
                onBlur={(e) => set({ depth: Number(e.target.value) || 0 })}
              />
            </Row>
            <Row label={t("lorebook.role")}>
              <Select
                value={entry.role}
                onValueChange={(v) => set({ role: v as LoreEntry["role"] })}
                options={(["system", "user", "assistant"] as const).map((v) => ({
                  value: v,
                  label: t(`lorebook.role_${v}`),
                }))}
                ariaLabel={t("lorebook.role")}
              />
            </Row>
          </>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Row label={t("lorebook.order")} hint={t("lorebook.orderHint")}>
          <Input
            type="number"
            defaultValue={entry.order}
            onBlur={(e) => set({ order: Number(e.target.value) || 0 })}
          />
        </Row>
        <Row label={t("lorebook.priority")} hint={t("lorebook.priorityHint")}>
          <Input
            type="number"
            defaultValue={entry.priority}
            onBlur={(e) => set({ priority: Number(e.target.value) || 0 })}
          />
        </Row>
        <Row label={t("lorebook.probability")}>
          <Input
            type="number"
            min={0}
            max={100}
            defaultValue={entry.probability}
            onBlur={(e) => set({ probability: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
          />
        </Row>
      </div>

      <details className="group rounded-xl border border-border">
        <summary className="cursor-pointer select-none px-4 py-2.5 text-[13px] text-fg-muted">
          {t("lorebook.more")}
        </summary>
        <div className="flex flex-col gap-4 border-t border-border px-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <Row label={t("lorebook.group")} hint={t("lorebook.groupHint")}>
              <Input
                defaultValue={entry.group}
                onBlur={(e) => e.target.value !== entry.group && set({ group: e.target.value })}
              />
            </Row>
            <Row label={t("lorebook.groupWeight")}>
              <Input
                type="number"
                min={0}
                defaultValue={entry.group_weight}
                onBlur={(e) => set({ group_weight: Number(e.target.value) || 0 })}
              />
            </Row>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Row label={t("lorebook.sticky")} hint={t("lorebook.stickyHint")}>
              <Input
                type="number"
                min={0}
                defaultValue={entry.sticky ?? ""}
                onBlur={(e) => set({ sticky: num(e.target.value) })}
              />
            </Row>
            <Row label={t("lorebook.cooldown")} hint={t("lorebook.cooldownHint")}>
              <Input
                type="number"
                min={0}
                defaultValue={entry.cooldown ?? ""}
                onBlur={(e) => set({ cooldown: num(e.target.value) })}
              />
            </Row>
            <Row label={t("lorebook.delay")} hint={t("lorebook.delayHint")}>
              <Input
                type="number"
                min={0}
                defaultValue={entry.delay ?? ""}
                onBlur={(e) => set({ delay: num(e.target.value) })}
              />
            </Row>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Row label={t("lorebook.scanDepth")}>
              <Input
                type="number"
                min={0}
                placeholder={t("lorebook.inherit")}
                defaultValue={entry.scan_depth ?? ""}
                onBlur={(e) => set({ scan_depth: num(e.target.value) })}
              />
            </Row>
            <Row label={t("lorebook.caseSensitive")}>
              <TriSelect
                value={tri(entry.case_sensitive)}
                onChange={(v) => set({ case_sensitive: fromTri(v) })}
              />
            </Row>
            <Row label={t("lorebook.wholeWords")}>
              <TriSelect
                value={tri(entry.match_whole_words)}
                onChange={(v) => set({ match_whole_words: fromTri(v) })}
              />
            </Row>
          </div>
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <Toggle
              label={t("lorebook.preventRecursion")}
              checked={entry.prevent_recursion}
              onChange={(v) => set({ prevent_recursion: v })}
            />
            <Toggle
              label={t("lorebook.excludeRecursion")}
              checked={entry.exclude_recursion}
              onChange={(v) => set({ exclude_recursion: v })}
            />
          </div>
          <Row label={t("lorebook.comment")}>
            <Textarea
              defaultValue={entry.comment}
              rows={2}
              onBlur={(e) => e.target.value !== entry.comment && set({ comment: e.target.value })}
              className="text-[13px]"
            />
          </Row>
        </div>
      </details>
    </div>
  );
}

function TriSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  return (
    <Select
      value={value}
      onValueChange={onChange}
      options={[
        { value: "inherit", label: t("lorebook.inherit") },
        { value: "yes", label: t("lorebook.yes") },
        { value: "no", label: t("lorebook.no") },
      ]}
    />
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[13px] font-medium text-fg-muted">{label}</span>
      {children}
      {hint ? <span className="text-[12px] leading-relaxed text-fg-subtle">{hint}</span> : null}
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <Switch checked={checked} onCheckedChange={onChange} className="mt-0.5" />
      <span className="flex flex-col">
        <span className="text-[13.5px]">{label}</span>
        {hint ? <span className="text-[12px] text-fg-subtle">{hint}</span> : null}
      </span>
    </label>
  );
}

/** 「试一试」：输入一句话，看会触发哪些条目。 */
function TestBar({ notebookId, onPick }: { notebookId: string; onPick: (id: string) => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [result, setResult] = useState<LoreTestResult | null>(null);
  const run = useMutation({
    mutationFn: () => api.lorebook.test(notebookId, text),
    onSuccess: setResult,
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="shrink-0 border-b border-border px-3 py-2.5">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) run.mutate();
        }}
      >
        <FlaskConical className="size-4 shrink-0 text-fg-subtle" />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("lorebook.testPlaceholder")}
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-fg-subtle"
        />
        <Button type="submit" size="sm" variant="ghost" loading={run.isPending} disabled={!text.trim()}>
          {t("lorebook.test")}
        </Button>
      </form>
      {result ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12.5px]">
          {result.entries.length === 0 ? (
            <span className="text-fg-subtle">{t("lorebook.testNone")}</span>
          ) : (
            result.entries.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => onPick(e.id)}
                className="rounded-md bg-surface-sunken px-2 py-0.5 text-fg-muted hover:text-fg"
              >
                {e.name || t("common.untitled")}
                <span className="ml-1.5 text-fg-subtle">{t(`lorebook.trigger_${e.trigger}`)}</span>
              </button>
            ))
          )}
          {result.trimmed.length ? (
            <span className="text-fg-subtle">
              {t("lorebook.testTrimmed", { names: result.trimmed.map((e) => e.name).join("、") })}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AiInstructions({ notebookId }: { notebookId: string }) {
  const { t } = useTranslation();
  const nb = useQuery({ queryKey: qk.notebook(notebookId), queryFn: () => api.notebooks.get(notebookId) });
  const save = useMutation({
    mutationFn: (aiInstructions: string) => api.notebooks.update(notebookId, { aiInstructions }),
    onSuccess: (n) => queryClient.setQueryData(qk.notebook(notebookId), n),
    onError: (e: Error) => toast.error(e.message),
  });
  if (!nb.data) return null;
  const value = nb.data.aiInstructions ?? "";
  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-3 px-5 py-6">
      <h3 className="font-serif text-[20px]">{t("lorebook.aiTitle")}</h3>
      <p className="text-[13.5px] leading-relaxed text-fg-subtle">{t("lorebook.aiDesc")}</p>
      <Textarea
        defaultValue={value}
        placeholder={t("lorebook.aiPlaceholder")}
        onBlur={(e) => e.target.value !== value && save.mutate(e.target.value)}
        className="min-h-48 text-[14px] leading-relaxed [field-sizing:content]"
      />
    </div>
  );
}

function SettingsForm({ notebookId, settings }: { notebookId: string; settings: LorebookSettings }) {
  const { t } = useTranslation();
  const save = useMutation({
    mutationFn: (patch: Partial<LorebookSettings>) => api.lorebook.updateSettings(notebookId, patch),
    onSuccess: (s) =>
      queryClient.setQueryData(
        qk.lorebook(notebookId),
        (old: { settings: LorebookSettings; entries: LoreEntry[] } | undefined) =>
          old ? { ...old, settings: s } : old,
      ),
    onError: (e: Error) => toast.error(e.message),
  });
  const set = (patch: Partial<LorebookSettings>) => save.mutate(patch);
  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-5 px-5 py-6">
      <Toggle
        label={t("lorebook.bookEnabled")}
        hint={t("lorebook.bookEnabledHint")}
        checked={settings.enabled}
        onChange={(v) => set({ enabled: v })}
      />
      <div className="grid grid-cols-2 gap-4">
        <Row label={t("lorebook.scanDepth")} hint={t("lorebook.scanDepthHint")}>
          <Input
            type="number"
            min={0}
            max={100}
            defaultValue={settings.scan_depth}
            onBlur={(e) => set({ scan_depth: Number(e.target.value) || 0 })}
          />
        </Row>
        <Row label={t("lorebook.budget")} hint={t("lorebook.budgetHint")}>
          <Input
            type="number"
            min={0}
            defaultValue={settings.token_budget}
            onBlur={(e) => set({ token_budget: Number(e.target.value) || 0 })}
          />
        </Row>
      </div>
      <Toggle
        label={t("lorebook.recursive")}
        hint={t("lorebook.recursiveHint")}
        checked={settings.recursive}
        onChange={(v) => set({ recursive: v })}
      />
      {settings.recursive ? (
        <Row label={t("lorebook.maxRecursion")}>
          <Input
            type="number"
            min={1}
            max={10}
            defaultValue={settings.max_recursion}
            onBlur={(e) => set({ max_recursion: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })}
            className="w-32"
          />
        </Row>
      ) : null}
      <Toggle
        label={t("lorebook.caseSensitive")}
        checked={settings.case_sensitive}
        onChange={(v) => set({ case_sensitive: v })}
      />
      <Toggle
        label={t("lorebook.wholeWords")}
        hint={t("lorebook.wholeWordsHint")}
        checked={settings.match_whole_words}
        onChange={(v) => set({ match_whole_words: v })}
      />
    </div>
  );
}
