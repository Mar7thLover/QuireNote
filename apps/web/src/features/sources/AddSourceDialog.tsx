import {
  Button,
  cn,
  Dialog,
  DialogContent,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from "@quirenote/ui";
import { useMutation } from "@tanstack/react-query";
import { ClipboardPaste, FileUp, Globe, Link2, Mic, Square, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api";
import { qk, upsertInList } from "@/lib/query";
import { useUi } from "@/stores/ui";
import { useWorkspace } from "@/stores/workspace";
import { uploadFiles } from "./hooks";

const ACCEPT =
  ".pdf,.docx,.epub,.md,.markdown,.txt,.html,.png,.jpg,.jpeg,.webp,.mp3,.m4a,.wav,.mp4,.webm,.mov";

export function AddSourceDialog({ notebookId }: { notebookId: string }) {
  const { t } = useTranslation();
  const open = useUi((s) => s.addSourceOpen);
  const tab = useUi((s) => s.addSourceTab);
  const set = useUi((s) => s.set);
  const close = () => set({ addSourceOpen: false });

  return (
    <Dialog open={open} onOpenChange={(o) => set({ addSourceOpen: o })}>
      <DialogContent title={t("sources.add")} className="max-w-xl">
        <Tabs
          value={tab}
          onValueChange={(v) => {
            if (v === "search") {
              close();
              useWorkspace.getState().open({ kind: "search", title: t("nav.search") });
              return;
            }
            set({ addSourceTab: v as typeof tab });
          }}
          className="px-5 pb-5"
        >
          <TabsList className="mb-4 w-full">
            <TabsTrigger value="upload" className="flex-1">
              <FileUp />
              {t("sources.upload")}
            </TabsTrigger>
            <TabsTrigger value="url" className="flex-1">
              <Link2 />
              {t("sources.url")}
            </TabsTrigger>
            <TabsTrigger value="paste" className="flex-1">
              <ClipboardPaste />
              {t("sources.paste")}
            </TabsTrigger>
            <TabsTrigger value="record" className="flex-1">
              <Mic />
              录音
            </TabsTrigger>
            <TabsTrigger value="search" className="flex-1">
              <Globe />
              {t("sources.webSearch")}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="upload">
            <UploadTab notebookId={notebookId} onDone={close} />
          </TabsContent>
          <TabsContent value="url">
            <UrlTab notebookId={notebookId} onDone={close} />
          </TabsContent>
          <TabsContent value="record">
            <RecordTab notebookId={notebookId} onDone={close} />
          </TabsContent>
          <TabsContent value="paste">
            <PasteTab notebookId={notebookId} onDone={close} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function UploadTab({ notebookId, onDone }: { notebookId: string; onDone: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const up = useMutation({
    mutationFn: (files: File[]) => uploadFiles(notebookId, files),
    onSuccess: onDone,
  });
  return (
    <button
      type="button"
      onClick={() => ref.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (e.dataTransfer.files.length) up.mutate([...e.dataTransfer.files]);
      }}
      className={cn(
        "flex h-48 w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border-strong transition-colors focus-ring",
        over ? "border-accent bg-accent-soft" : "hover:border-accent/60 hover:bg-surface-hover",
      )}
    >
      <div className="grid size-12 place-items-center rounded-full bg-accent-soft text-accent-soft-fg">
        <UploadCloud className={cn("size-6", up.isPending && "animate-bounce")} />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium">{t("sources.uploadHint")}</p>
        <p className="mt-1 text-xs text-fg-subtle">{t("sources.uploadTypes")}</p>
      </div>
      <input
        ref={ref}
        type="file"
        multiple
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          if (files.length) up.mutate(files);
          e.target.value = "";
        }}
      />
    </button>
  );
}

function UrlTab({ notebookId, onDone }: { notebookId: string; onDone: () => void }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState("");
  const add = useMutation({
    mutationFn: async () => {
      const urls = url
        .split(/\s+/)
        .map((u) => u.trim())
        .filter((u) => /^https?:\/\//.test(u));
      if (!urls.length) throw new Error("请输入以 http(s):// 开头的链接");
      for (const u of urls) upsertInList(qk.sources(notebookId), await api.sources.addUrl(notebookId, u));
    },
    onSuccess: () => {
      setUrl("");
      onDone();
    },
  });
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate();
      }}
    >
      <Textarea
        autoFocus
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder={`${t("sources.urlPlaceholder")}\nhttps://…`}
        rows={4}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) add.mutate();
        }}
      />
      <p className="text-xs text-fg-subtle">支持一次粘贴多个链接（每行一个）。YouTube 链接会自动抓取字幕。</p>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={add.isPending} disabled={!url.trim()}>
          {t("common.add")}
        </Button>
      </div>
    </form>
  );
}

function PasteTab({ notebookId, onDone }: { notebookId: string; onDone: () => void }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const add = useMutation({
    mutationFn: () => api.sources.addText(notebookId, title.trim() || text.trim().slice(0, 30), text),
    onSuccess: (s) => {
      upsertInList(qk.sources(notebookId), s);
      setTitle("");
      setText("");
      toast.success(s.title);
      onDone();
    },
  });
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate();
      }}
    >
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("sources.pasteTitle")} />
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("sources.pasteBody")}
        rows={9}
        className="font-mono text-[13px]"
      />
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={add.isPending} disabled={!text.trim()}>
          {t("common.add")}
        </Button>
      </div>
    </form>
  );
}

/** 录音：浏览器 / 原生 WebView 的 MediaRecorder，上传后由服务端转写为文本资料。 */
function RecordTab({ notebookId, onDone }: { notebookId: string; onDone: () => void }) {
  const [state, setState] = useState<"idle" | "recording" | "uploading">("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  useEffect(() => {
    if (state !== "recording") return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [state]);
  useEffect(
    () => () =>
      recRef.current?.stream.getTracks().forEach((t) => {
        t.stop();
      }),
    [],
  );

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.onstop = async () => {
        for (const t of stream.getTracks()) t.stop();
        setState("uploading");
        const type = rec.mimeType || "audio/webm";
        const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        const file = new File(chunks.current, `录音 ${new Date().toLocaleString("zh-CN")}.${ext}`, { type });
        try {
          await uploadFiles(notebookId, [file]);
          onDone();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setState("idle");
        }
      };
      recRef.current = rec;
      rec.start(1000);
      setSeconds(0);
      setState("recording");
    } catch (e) {
      setError(`无法使用麦克风：${(e as Error).message}`);
    }
  };

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return (
    <div className="flex h-48 flex-col items-center justify-center gap-4 rounded-xl border border-border bg-surface-sunken/50">
      <button
        type="button"
        onClick={() => (state === "recording" ? recRef.current?.stop() : start())}
        disabled={state === "uploading"}
        className={cn(
          "grid size-16 place-items-center rounded-full shadow-md transition-transform active:scale-95 focus-ring",
          state === "recording" ? "bg-danger text-white" : "bg-accent text-accent-fg",
        )}
        aria-label={state === "recording" ? "停止录音" : "开始录音"}
      >
        {state === "recording" ? <Square className="size-6 fill-current" /> : <Mic className="size-7" />}
      </button>
      <p className="font-mono text-sm tabular-nums text-fg-muted">
        {state === "uploading"
          ? "上传中…"
          : state === "recording"
            ? `● ${mm}:${ss}`
            : "点击开始录音，结束后自动转写为资料"}
      </p>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}
