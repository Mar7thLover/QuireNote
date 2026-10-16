import { Button, cn, Field, Input, Sheet, toast } from "@quirenote/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FileText, Link2, Server, Type } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api";
import { qk, queryClient } from "@/lib/query";
import { hasServerOverride, isNative, type SharedPayload, useShareInbox } from "./native";

/** 「发送到 Quirenote」：选择 Notebook，把分享来的链接、文本、文件加入资料。 */
export function ShareInbox() {
  const { t } = useTranslation();
  const payload = useShareInbox((s) => s.payload);
  const set = useShareInbox((s) => s.set);
  const notebooks = useQuery({ queryKey: qk.notebooks, queryFn: api.notebooks.list, enabled: !!payload });
  const [target, setTarget] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: async ({ nb, p }: { nb: string; p: SharedPayload }) => importShared(nb, p),
    onSuccess: (count, { nb }) => {
      toast.success(`已加入 ${count} 份资料`);
      queryClient.invalidateQueries({ queryKey: qk.sources(nb) });
      set(null);
    },
  });

  return (
    <Sheet open={!!payload} onOpenChange={(o) => !o && set(null)} title="发送到 Quirenote">
      {payload ? (
        <div className="space-y-4 px-4 pb-6">
          <div className="space-y-1.5 rounded-xl bg-surface-sunken p-3 text-[13px]">
            {payload.texts.map((x, i) => (
              <p key={i} className="flex gap-2 break-all">
                {/^https?:\/\//.test(x.trim()) ? (
                  <Link2 className="mt-0.5 size-4 shrink-0" />
                ) : (
                  <Type className="mt-0.5 size-4 shrink-0" />
                )}
                <span className="line-clamp-3">{x}</span>
              </p>
            ))}
            {payload.files.map((f) => (
              <p key={f.uri} className="flex gap-2">
                <FileText className="mt-0.5 size-4 shrink-0" />
                {f.name}
              </p>
            ))}
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-fg-subtle">选择 Notebook</p>
            {(notebooks.data ?? []).map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => setTarget(n.id)}
                className={cn(
                  "flex h-12 w-full items-center gap-3 rounded-xl border px-3 text-left text-[15px]",
                  target === n.id ? "border-accent bg-accent-soft" : "border-border",
                )}
              >
                <span className="text-lg">{n.icon}</span>
                {n.title}
              </button>
            ))}
          </div>
          <Button
            size="lg"
            variant="primary"
            className="w-full"
            disabled={!target}
            loading={send.isPending}
            onClick={() => target && send.mutate({ nb: target, p: payload })}
          >
            {t("common.add")}
          </Button>
        </div>
      ) : null}
    </Sheet>
  );
}

async function importShared(nb: string, p: SharedPayload): Promise<number> {
  let n = 0;
  for (const raw of p.texts) {
    const text = raw.trim();
    const urls = text.match(/https?:\/\/\S+/g);
    if (urls?.length && text.length < 500) {
      for (const u of urls) await api.sources.addUrl(nb, u);
      n += urls.length;
    } else if (text) {
      await api.sources.addText(nb, p.title || text.slice(0, 30), text, "text");
      n++;
    }
  }
  for (const f of p.files) {
    const blob = await (await fetch(f.uri)).blob();
    await api.sources.addFile(nb, new File([blob], f.name, { type: f.mimeType || blob.type }));
    n++;
  }
  return n;
}

/** 原生壳首次启动：填写自托管服务器地址。 */
export function ServerOnboarding() {
  const [open, setOpen] = useState(() => isNative() && !hasServerOverride());
  const [url, setUrl] = useState("https://");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const connect = async () => {
    setChecking(true);
    setError(null);
    const base = url.trim().replace(/\/$/, "");
    try {
      const res = await fetch(`${base}/api/health`);
      if (!res.ok) throw new Error(String(res.status));
      localStorage.setItem("quirenote.server", base);
      setOpen(false);
      location.reload();
    } catch (e) {
      setError(`无法连接：${(e as Error).message}`);
    } finally {
      setChecking(false);
    }
  };
  return (
    <Sheet open={open} onOpenChange={() => {}} title="连接你的 Quirenote 服务器">
      <div className="space-y-4 px-4 pb-8">
        <div className="flex items-start gap-3 rounded-xl bg-accent-soft p-3 text-[13px] leading-relaxed text-accent-soft-fg">
          <Server className="mt-0.5 size-5 shrink-0" />
          Quirenote 的数据保存在你自托管的服务器上（docker compose 一键部署）。请填写服务器地址。
        </div>
        <Field label="服务器地址">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            inputMode="url"
            autoCapitalize="none"
            className="h-11 text-[15px]"
          />
        </Field>
        {error ? <p className="text-[13px] text-danger">{error}</p> : null}
        <Button size="lg" variant="primary" className="w-full" onClick={connect} loading={checking}>
          连接
        </Button>
      </div>
    </Sheet>
  );
}
