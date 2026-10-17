import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@quirenote/ui";
import {
  BookmarkPlus,
  ClipboardPaste,
  Copy,
  Download,
  ExternalLink,
  FilePlus2,
  Globe,
  Image,
  Lightbulb,
  Link2,
  MessagesSquare,
  Scissors,
  TextSelect,
} from "lucide-react";
import { useEffect, useRef } from "react";
import i18n from "@/i18n";
import { copyImage, copyText, download, insertIntoField, readClipboardText } from "@/lib/clipboard";
import {
  assemble,
  contributionsOf,
  type GenericKind,
  type MenuSection,
  type TargetContext,
  targetContext,
  useContextMenuState,
} from "@/lib/contextMenu";
import { addUrlAsSource, askInChat, explainInChat, saveQuoteAsCard, searchWeb } from "@/lib/workspaceActions";
import { activeNotebookId } from "@/stores/workspace";
import { MenuItems } from "./MenuItems";

/**
 * 全局右键菜单：收集这次右键各区域登记的菜单，补上通用情境，然后在指针处弹出。
 * 没有可用的条目、按住 Shift、或点在视频 / 音频 / 内嵌页上时，交给浏览器的原生菜单。
 */
export function ContextMenuHost() {
  const { open, key, x, y, sections } = useContextMenuState();
  const pending = useRef<(() => void) | null>(null);
  const escaped = useRef(false);

  useEffect(() => {
    let pointer = "mouse";
    const onPointerDown = (e: PointerEvent) => {
      pointer = e.pointerType;
    };
    const onContextMenu = (e: MouseEvent) => {
      if (e.defaultPrevented || e.shiftKey) return;
      const node = e.target as Node | null;
      const target = node instanceof Element ? node : node?.parentElement;
      if (!target) return;
      // 菜单里再右键：什么都不做，也不弹原生菜单。
      if (target.closest("[data-context-menu], [role=menu]")) return e.preventDefault();
      if (target.closest("video, audio, iframe")) return;
      // 触屏长按：文字、输入框交给系统的选择菜单，只弹各区域自己的菜单。
      const ctx = targetContext(target, e.clientX, e.clientY);
      const generic = pointer === "touch" ? [] : genericSections(ctx);
      const list = assemble(generic, contributionsOf(e));
      if (!list.length) return;
      e.preventDefault();
      let px = e.clientX;
      let py = e.clientY;
      // 键盘（菜单键、Shift+F10）打开：放在目标元素左上角附近。
      if (px === 0 && py === 0) {
        const r = target.getBoundingClientRect();
        px = r.left + Math.min(16, r.width / 2);
        py = r.top + Math.min(24, r.height);
      }
      useContextMenuState.getState().show({ x: px, y: py, sections: list, restore: document.activeElement });
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("contextmenu", onContextMenu);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("contextmenu", onContextMenu);
    };
  }, []);

  // 打开时页面滚动、窗口变化或失焦就关掉，菜单不会和内容脱节。
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const t = e.target;
      if (t instanceof Element && t.closest("[data-context-menu]")) return;
      useContextMenuState.getState().close();
    };
    window.addEventListener("wheel", close, { capture: true, passive: true });
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("wheel", close, { capture: true });
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [open]);

  const onOpenChange = (next: boolean) => {
    if (next) return;
    const { restore } = useContextMenuState.getState();
    const fn = pending.current;
    const back = !!fn || escaped.current;
    pending.current = null;
    escaped.current = false;
    useContextMenuState.getState().close();
    // 等菜单卸载后再执行：焦点先回到原处（输入框、编辑器），粘贴、格式化才落在对的位置。
    setTimeout(() => {
      if (back) focusBack(restore);
      fn?.();
    }, 0);
  };

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          tabIndex={-1}
          className="pointer-events-none fixed size-0"
          style={{ left: x, top: y }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        key={key}
        data-context-menu
        side="bottom"
        align="start"
        sideOffset={2}
        alignOffset={2}
        collisionPadding={8}
        className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-max min-w-52 max-w-[22rem] overflow-y-auto"
        onCloseAutoFocus={(e) => e.preventDefault()}
        onEscapeKeyDown={() => {
          escaped.current = true;
        }}
      >
        <MenuItems
          sections={sections}
          run={(fn) => {
            pending.current = fn;
          }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 焦点还给打开菜单前的元素；编辑器用自己的 focus 恢复选区。 */
function focusBack(el: Element | null) {
  if (!(el instanceof HTMLElement) || !el.isConnected || el === document.body) return;
  const pm = el.closest(".ProseMirror") as
    | (HTMLElement & { editor?: { commands: { focus: () => void } } })
    | null;
  if (pm?.editor) pm.editor.commands.focus();
  else el.focus({ preventScroll: true });
}

function fieldSelection(f: HTMLInputElement | HTMLTextAreaElement): string {
  try {
    return f.value.slice(f.selectionStart ?? 0, f.selectionEnd ?? 0);
  } catch {
    // number 等类型的输入框不支持选区。
    return "";
  }
}

/** 通用情境的菜单：选中文字、链接、图片、输入框。 */
export function genericSections(ctx: TargetContext): { kind: GenericKind; section: MenuSection }[] {
  const t = i18n.t.bind(i18n);
  const nb = activeNotebookId();
  const out: { kind: GenericKind; section: MenuSection }[] = [];

  if (ctx.selection) {
    const text = ctx.selection;
    out.push({
      kind: "selection",
      section: [
        {
          id: "sel.copy",
          label: t("common.copy"),
          icon: Copy,
          shortcut: "Mod+C",
          onSelect: () => copyText(text),
        },
        ...(nb
          ? [
              {
                id: "sel.ask",
                label: t("reader.ask"),
                icon: MessagesSquare,
                onSelect: () => askInChat({ text }),
              },
              {
                id: "sel.explain",
                label: t("reader.explain"),
                icon: Lightbulb,
                onSelect: () => explainInChat({ text }),
              },
              {
                id: "sel.card",
                label: t("reader.toCard"),
                icon: BookmarkPlus,
                onSelect: () => void saveQuoteAsCard(nb, { text }),
              },
              { id: "sel.search", label: t("menu.webSearch"), icon: Globe, onSelect: () => searchWeb(text) },
            ]
          : []),
      ],
    });
  }

  if (ctx.link) {
    const { href, external } = ctx.link;
    out.push({
      kind: "link",
      section: [
        {
          id: "link.open",
          label: t(external ? "menu.openLink" : "menu.openInNewTab"),
          icon: ExternalLink,
          onSelect: () => window.open(href, "_blank", "noopener"),
        },
        { id: "link.copy", label: t("menu.copyLink"), icon: Link2, onSelect: () => copyText(href, true) },
        ...(external && nb
          ? [
              {
                id: "link.source",
                label: t("menu.addAsSource"),
                icon: FilePlus2,
                onSelect: () => void addUrlAsSource(nb, href),
              },
            ]
          : []),
      ],
    });
  }

  if (ctx.image) {
    const { src } = ctx.image;
    out.push({
      kind: "image",
      section: [
        {
          id: "img.open",
          label: t("menu.openImage"),
          icon: Image,
          onSelect: () => window.open(src, "_blank", "noopener"),
        },
        { id: "img.copy", label: t("menu.copyImage"), icon: Copy, onSelect: () => void copyImage(src) },
        {
          id: "img.copyUrl",
          label: t("menu.copyImageUrl"),
          icon: Link2,
          onSelect: () => copyText(src, true),
        },
        { id: "img.download", label: t("menu.downloadImage"), icon: Download, onSelect: () => download(src) },
      ],
    });
  }

  if (ctx.field) {
    const f = ctx.field;
    const selected = fieldSelection(f);
    const locked = f.readOnly || f.disabled;
    const secret = f.type === "password";
    out.push({
      kind: "editable",
      section: [
        {
          id: "field.cut",
          label: t("menu.cut"),
          icon: Scissors,
          shortcut: "Mod+X",
          disabled: !selected || locked || secret,
          onSelect: async () => {
            if (await copyText(selected)) insertIntoField(f, "");
          },
        },
        {
          id: "field.copy",
          label: t("common.copy"),
          icon: Copy,
          shortcut: "Mod+C",
          disabled: !selected || secret,
          onSelect: () => copyText(selected),
        },
        {
          id: "field.paste",
          label: t("menu.paste"),
          icon: ClipboardPaste,
          shortcut: "Mod+V",
          disabled: locked,
          onSelect: async () => {
            const text = await readClipboardText();
            if (text) insertIntoField(f, text);
          },
        },
        {
          id: "field.selectAll",
          label: t("menu.selectAll"),
          icon: TextSelect,
          shortcut: "Mod+A",
          disabled: !f.value,
          onSelect: () => {
            f.focus();
            f.select();
          },
        },
      ],
    });
  }
  return out;
}
