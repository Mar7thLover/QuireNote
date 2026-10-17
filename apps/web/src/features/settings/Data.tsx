import { Button, Field, Input, Skeleton, toast } from "@quirenote/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { del } from "idb-keyval";
import { DatabaseBackup, HardDriveDownload, RefreshCcw, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api";
import { formatBytes, formatCount } from "@/lib/format";
import { qk, queryClient } from "@/lib/query";
import { SettingsSection } from "@/routes/settings";

export function DataSettings() {
  const { t } = useTranslation();
  const stats = useQuery({ queryKey: qk.adminStats, queryFn: api.admin.stats, refetchInterval: 10_000 });
  const fileRef = useRef<HTMLInputElement>(null);
  const reindex = useMutation({
    mutationFn: () => api.admin.reindex(),
    onSuccess: () => toast.success(t("data.reindex"), { description: t("data.jobStarted") }),
  });
  const restore = useMutation({
    mutationFn: api.admin.restore,
    onSuccess: () => {
      toast.success(t("data.restored"));
      queryClient.invalidateQueries();
    },
  });
  const s = stats.data;
  const embeddedPct = s && s.chunks ? Math.round((s.embedded / s.chunks) * 100) : 0;

  return (
    <>
      <SettingsSection title={t("data.storage")}>
        {!s ? (
          <Skeleton className="h-28 rounded-xl" />
        ) : (
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label={t("data.database")} value={formatBytes(s.dbBytes)} />
            <Stat label={t("data.files")} value={formatBytes(s.filesBytes)} />
            <Stat label={t("data.statNotebooks")} value={`${s.notebooks} / ${s.sources}`} />
            <Stat label={t("data.statNotes")} value={`${s.notes} / ${s.artifacts} / ${s.elements}`} />
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        title={t("data.index")}
        description={t("data.reindexDesc")}
        action={
          <Button size="sm" onClick={() => reindex.mutate()} loading={reindex.isPending}>
            <RefreshCcw />
            {t("data.reindex")}
          </Button>
        }
      >
        {s ? (
          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-baseline justify-between text-[13px]">
              <span>
                {t("data.chunks", { n: formatCount(s.chunks) })} ·{" "}
                {t("data.embedded", { n: formatCount(s.embedded) })}
              </span>
              <span className="font-mono text-xs text-fg-subtle">{s.embeddingModel}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-sunken">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-500"
                style={{ width: `${embeddedPct}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-fg-subtle">
              {embeddedPct}% · {t("data.pendingJobs", { count: s.pendingJobs })}
            </p>
          </div>
        ) : null}
      </SettingsSection>

      <SettingsSection title={t("home.backup")}>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <a href={api.admin.backupUrl()} download>
              <HardDriveDownload />
              {t("data.backup")}
            </a>
          </Button>
          <Button onClick={() => fileRef.current?.click()} loading={restore.isPending}>
            <Upload />
            {t("data.restore")}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".zip"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f && confirm(t("data.restoreConfirm"))) restore.mutate(f);
              e.target.value = "";
            }}
          />
        </div>
      </SettingsSection>

      <SettingsSection title={t("data.clearCache")} description={t("data.clearCacheDesc")}>
        <Button
          variant="ghost"
          className="text-danger"
          onClick={async () => {
            await del("quirenote.query-cache");
            queryClient.clear();
            toast.success(t("common.done"));
          }}
        >
          <Trash2 />
          {t("data.clearCache")}
        </Button>
      </SettingsSection>

      <ServerSetting />
    </>
  );
}

function ServerSetting() {
  const { t } = useTranslation();
  const [v, setV] = useState(() => {
    try {
      return localStorage.getItem("quirenote.server") ?? "";
    } catch {
      return "";
    }
  });
  return (
    <SettingsSection title={t("settings.server")} description={t("settings.serverHint")}>
      <div className="flex max-w-lg gap-2">
        <Field label="" className="flex-1">
          <Input value={v} onChange={(e) => setV(e.target.value)} placeholder={t("data.serverPlaceholder")} />
        </Field>
        <Button
          onClick={() => {
            try {
              if (v.trim()) localStorage.setItem("quirenote.server", v.trim());
              else localStorage.removeItem("quirenote.server");
            } catch {}
            queryClient.clear();
            location.reload();
          }}
        >
          <DatabaseBackup />
          {t("common.save")}
        </Button>
      </div>
    </SettingsSection>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs text-fg-subtle">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight">{value}</p>
    </div>
  );
}
