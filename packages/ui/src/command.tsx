import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";
import { Shortcut } from "./primitives";

/** 基于 cmdk 的命令列表样式（命令面板、斜杠菜单、提及菜单共用）。 */
export function Command({ className, ...props }: ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      className={cn("flex h-full w-full flex-col overflow-hidden text-fg", className)}
      {...props}
    />
  );
}

export function CommandInput({
  className,
  leading,
  trailing,
  ...props
}: ComponentProps<typeof CommandPrimitive.Input> & { leading?: ReactNode; trailing?: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-border px-4">
      {leading ?? <Search className="size-4 shrink-0 text-fg-subtle" />}
      <CommandPrimitive.Input
        className={cn(
          "h-12 w-full bg-transparent text-[15px] outline-none placeholder:text-fg-subtle disabled:opacity-50",
          className,
        )}
        {...props}
      />
      {trailing}
    </div>
  );
}

export function CommandList({ className, ...props }: ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      className={cn(
        "max-h-[min(420px,60vh)] scroll-py-2 overflow-y-auto overscroll-contain p-1.5",
        className,
      )}
      {...props}
    />
  );
}

export function CommandEmpty(props: ComponentProps<typeof CommandPrimitive.Empty>) {
  return <CommandPrimitive.Empty className="py-8 text-center text-sm text-fg-subtle" {...props} />;
}

export function CommandGroup({ className, ...props }: ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      className={cn(
        "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1",
        "[&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-subtle",
        className,
      )}
      {...props}
    />
  );
}

export function CommandItem({
  className,
  icon,
  shortcut,
  hint,
  children,
  ...props
}: ComponentProps<typeof CommandPrimitive.Item> & { icon?: ReactNode; shortcut?: string; hint?: ReactNode }) {
  return (
    <CommandPrimitive.Item
      className={cn(
        "flex h-9 cursor-default select-none items-center gap-2.5 rounded-lg px-2.5 text-sm text-fg-muted outline-none",
        // 选中态用中性灰底（与悬停一致），不用点缀色：命令列表里点缀色会盖过内容本身。
        "data-[selected=true]:bg-surface-hover data-[selected=true]:text-fg data-[disabled=true]:opacity-40",
        "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-subtle data-[selected=true]:[&_svg]:text-fg-muted",
        className,
      )}
      {...props}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint ? <span className="truncate text-xs text-fg-subtle">{hint}</span> : null}
      {shortcut ? <Shortcut keys={shortcut} /> : null}
    </CommandPrimitive.Item>
  );
}

export const CommandSeparator = CommandPrimitive.Separator;
