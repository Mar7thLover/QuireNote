import type { Conversation, Message, ModelChoice } from "@quirenote/core";
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
  toast,
} from "@quirenote/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ChevronDown, History, MessageSquareDashed, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { markAsked } from "@/components/GettingStarted";
import { PanelShell } from "@/components/Panel";
import { useSources } from "@/features/sources/hooks";
import { useTranslation } from "@/i18n";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { useAssignments } from "@/lib/models";
import { qk, queryClient, removeFromList, upsertInList } from "@/lib/query";
import { Composer } from "./Composer";
import { ChatEmpty, MessageItem, StreamingItem } from "./MessageItem";
import { ModelPicker } from "./ModelPicker";
import { latestLeaf, visiblePath } from "./tree";
import { useChatStream } from "./useChatStream";

export function ChatPanel({ notebookId, onlySource }: { notebookId: string; onlySource?: string }) {
  const { t } = useTranslation();
  const convs = useQuery({
    queryKey: qk.conversations(notebookId),
    queryFn: () => api.conversations.list(notebookId),
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const sorted = useMemo(
    () => [...(convs.data ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [convs.data],
  );
  const conv = sorted.find((c) => c.id === activeId) ?? (activeId === "new" ? undefined : sorted[0]);

  const messages = useQuery({
    queryKey: qk.messages(conv?.id ?? "none"),
    queryFn: () => api.conversations.messages(conv!.id),
    enabled: !!conv,
  });
  const { streaming, send, stop } = useChatStream(notebookId, conv?.id ?? null);
  const sources = useSources(notebookId);
  const path = useMemo(
    () => visiblePath(messages.data ?? [], conv?.activeLeafId ?? null),
    [messages.data, conv?.activeLeafId],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 内容变化时滚动到底
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [path.length, streaming?.text, conv?.id]);

  // 还没有对话时选的模型，创建对话时一并带上。
  const [draftModel, setDraftModel] = useState<ModelChoice | null>(null);
  const model = conv ? (conv.model ?? null) : draftModel;
  const changeModel = (next: ModelChoice | null) => {
    if (!conv) return setDraftModel(next);
    upsertInList(qk.conversations(notebookId), { ...conv, model: next });
    api.conversations.update(conv.id, { model: next }).catch((e: Error) => {
      upsertInList(qk.conversations(notebookId), conv);
      toast.error(e.message);
    });
  };

  const ensureConversation = async (firstLine: string): Promise<Conversation> => {
    if (conv) return conv;
    const c = await api.conversations.create(notebookId, firstLine.slice(0, 40), draftModel);
    upsertInList(qk.conversations(notebookId), c);
    queryClient.setQueryData(qk.messages(c.id), []);
    setActiveId(c.id);
    return c;
  };

  const submit = async (content: string, sourceIds: string[]) => {
    try {
      const c = await ensureConversation(content);
      stick.current = true;
      await send(c.id, { content, parentId: path.at(-1)?.message.id ?? null, sourceIds });
      markAsked();
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast.error((e as Error).message);
    }
  };

  const switchBranch = (target: Message) => {
    if (!conv) return;
    const leaf = latestLeaf(messages.data ?? [], target.id);
    upsertInList(qk.conversations(notebookId), { ...conv, activeLeafId: leaf });
    api.conversations.update(conv.id, { activeLeafId: leaf });
  };

  const assignments = useAssignments();
  const noModel = !!assignments.data && !model && !assignments.data.some((a) => a.capability === "chat");

  const selectedIds = (sources.data ?? []).filter((s) => s.selected && s.status === "ready").map((s) => s.id);

  return (
    <PanelShell
      toolbar={
        <>
          <ConversationMenu
            notebookId={notebookId}
            list={sorted}
            current={conv}
            onSelect={(id) => setActiveId(id)}
          />
          <div className="flex-1" />
          <Tooltip content={t("chat.newChat")}>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setActiveId("new")}
              aria-label={t("chat.newChat")}
            >
              <Plus />
            </Button>
          </Tooltip>
        </>
      }
    >
      <div className="flex h-full flex-col">
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto"
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          <div className="mx-auto w-full max-w-3xl px-4 py-5">
            {path.length === 0 && !streaming ? (
              <ChatEmpty notebookId={notebookId} onAsk={(q) => submit(q, selectedIds)} />
            ) : (
              <div className="space-y-6">
                {path.map((p) =>
                  streaming && p.message.role === "assistant" && p.message.id === streaming.id ? null : (
                    <MessageItem
                      key={p.message.id}
                      item={p}
                      notebookId={notebookId}
                      busy={!!streaming}
                      onSwitch={switchBranch}
                      onRegenerate={(m) =>
                        conv &&
                        send(conv.id, { parentId: m.parentId, regenerateOf: m.id, sourceIds: selectedIds })
                      }
                      onEdit={(m, content) =>
                        conv && send(conv.id, { content, parentId: m.parentId, sourceIds: selectedIds })
                      }
                    />
                  ),
                )}
                {streaming ? <StreamingItem streaming={streaming} /> : null}
              </div>
            )}
          </div>
        </div>
        {noModel ? <NoModelNotice /> : null}
        <Composer
          notebookId={notebookId}
          onlySource={onlySource}
          streaming={!!streaming}
          onStop={stop}
          onSubmit={submit}
          modelPicker={<ModelPicker value={model} onChange={changeModel} />}
        />
      </div>
    </PanelShell>
  );
}

function ConversationMenu({
  notebookId,
  list,
  current,
  onSelect,
}: {
  notebookId: string;
  list: Conversation[];
  current?: Conversation;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const remove = useMutation({
    mutationFn: (id: string) => api.conversations.remove(id),
    onMutate: (id) => removeFromList(qk.conversations(notebookId), id),
  });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-[13px] font-semibold hover:bg-surface-hover focus-ring"
        >
          <span className="truncate">{current?.title || t("chat.newChat")}</span>
          <ChevronDown className="size-3.5 shrink-0 text-fg-subtle" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="flex items-center gap-1.5">
          <History className="size-3.5" />
          {t("chat.history")}
        </DropdownMenuLabel>
        {list.length === 0 ? (
          <div className="flex items-center gap-2 px-2 py-3 text-[13px] text-fg-subtle">
            <MessageSquareDashed className="size-4" />—
          </div>
        ) : (
          list.slice(0, 30).map((c) => (
            <DropdownMenuItem
              key={c.id}
              onSelect={() => onSelect(c.id)}
              className={cn("group", c.id === current?.id && "bg-surface-hover")}
            >
              <span className="min-w-0 flex-1 truncate">{c.title || t("common.untitled")}</span>
              <span className="shrink-0 text-[11px] text-fg-subtle group-hover:hidden">
                {relativeTime(c.updatedAt)}
              </span>
              <button
                type="button"
                className="hidden rounded p-0.5 text-fg-subtle hover:text-danger group-hover:block"
                onClick={(e) => {
                  e.stopPropagation();
                  remove.mutate(c.id);
                }}
                aria-label={t("common.delete")}
              >
                <Trash2 className="size-3.5" />
              </button>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onSelect("new")}>
          <Plus />
          {t("chat.newChat")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 没有任何可用的对话模型时，在输入框上方提示并直达设置。 */
function NoModelNotice() {
  const { t } = useTranslation();
  return (
    <div className="mx-3 mb-2 flex items-start gap-2.5 rounded-xl border border-warning/40 bg-warning-soft/60 p-3 sm:mx-auto sm:w-[calc(100%-1.5rem)] sm:max-w-3xl">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium">{t("chat.noModelTitle")}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">{t("chat.noModelDesc")}</p>
      </div>
      <Button size="sm" variant="primary" asChild>
        <Link to="/settings/$section" params={{ section: "models" }}>
          {t("chat.noModelAction")}
        </Link>
      </Button>
    </div>
  );
}
