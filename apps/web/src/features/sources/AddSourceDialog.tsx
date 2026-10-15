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
} from "@folio/ui";
import { useMutation } from "@tanstack/react-query";
import { ClipboardPaste, FileUp, Globe, Link2, UploadCloud } from "lucide-react";
import { useRef, useState } from "react";
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
