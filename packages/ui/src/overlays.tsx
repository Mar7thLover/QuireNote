import { Check, ChevronDown, ChevronRight, X } from "lucide-react";
import {
  Checkbox as CheckboxPrimitive,
  ContextMenu as ContextMenuPrimitive,
  Dialog as DialogPrimitive,
  DropdownMenu as DropdownPrimitive,
  HoverCard as HoverCardPrimitive,
  Popover as PopoverPrimitive,
  Select as SelectPrimitive,
  Slider as SliderPrimitive,
  Switch as SwitchPrimitive,
  Tabs as TabsPrimitive,
  Tooltip as TooltipPrimitive,
} from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";
import { Shortcut } from "./primitives";

const popoverSurface = cn(
  "z-50 rounded-lg border border-border bg-surface-raised text-fg shadow-lg",
  "data-[state=open]:animate-pop",
  "origin-[var(--radix-popper-transform-origin)]",
);

// ───────────── Tooltip ─────────────
export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({
  content,
  shortcut,
  side = "top",
  children,
  delay,
}: {
  content: ReactNode;
  shortcut?: string;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactNode;
  delay?: number;
}) {
  return (
    <TooltipPrimitive.Root delayDuration={delay}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className={cn(
            "z-[60] flex items-center gap-2 rounded-md bg-fg px-2 py-1 text-xs font-medium text-bg shadow-md",
            "data-[state=delayed-open]:animate-fade",
          )}
        >
          {content}
          {shortcut ? (
            <Shortcut
              keys={shortcut}
              className="opacity-80 [&_kbd]:border-transparent [&_kbd]:bg-bg/15 [&_kbd]:text-bg"
            />
          ) : null}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

// ───────────── Dialog ─────────────
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  title,
  description,
  hideClose,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  title?: ReactNode;
  description?: ReactNode;
  hideClose?: boolean;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[oklch(0.2_0.02_272/0.32)] backdrop-blur-[2px] data-[state=open]:animate-fade" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2",
          "rounded-xl border border-border bg-surface-raised shadow-lg data-[state=open]:animate-pop",
          "max-h-[80vh] overflow-auto focus:outline-none",
          className,
        )}
        aria-describedby={description ? undefined : undefined}
        {...props}
      >
        {title ? (
          <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-2">
            <div className="space-y-1">
              <DialogPrimitive.Title className="text-[15px] font-semibold">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="text-[13px] text-fg-muted">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            {hideClose ? null : (
              <DialogPrimitive.Close className="-mr-1 rounded-md p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg focus-ring">
                <X className="size-4" />
                <span className="sr-only">Close</span>
              </DialogPrimitive.Close>
            )}
          </div>
        ) : (
          <DialogPrimitive.Title className="sr-only">dialog</DialogPrimitive.Title>
        )}
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** 移动端底部抽屉 / 桌面侧边抽屉。 */
export function Sheet({
  open,
  onOpenChange,
  side = "bottom",
  title,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: "bottom" | "right" | "left";
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const pos = {
    bottom:
      "inset-x-0 bottom-0 max-h-[88vh] rounded-t-2xl border-t data-[state=open]:[animation:slide-up_var(--dur-slow)_var(--ease-out)]",
    right: "inset-y-0 right-0 w-[min(420px,92vw)] border-l data-[state=open]:animate-pop",
    left: "inset-y-0 left-0 w-[min(320px,86vw)] border-r data-[state=open]:animate-pop",
  }[side];
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[oklch(0.2_0.02_272/0.32)] data-[state=open]:animate-fade" />
        <DialogPrimitive.Content
          className={cn(
            "fixed z-50 flex flex-col border-border bg-surface-raised shadow-lg focus:outline-none",
            pos,
            className,
          )}
        >
          {side === "bottom" ? (
            <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-border-strong" />
          ) : null}
          <DialogPrimitive.Title className="px-4 pt-3 pb-2 text-[15px] font-semibold">
            {title}
          </DialogPrimitive.Title>
          <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ───────────── Popover / HoverCard ─────────────
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export function PopoverContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        sideOffset={sideOffset}
        className={cn(popoverSurface, "p-3", className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export const HoverCard = HoverCardPrimitive.Root;
export const HoverCardTrigger = HoverCardPrimitive.Trigger;
export function HoverCardContent({ className, ...props }: ComponentProps<typeof HoverCardPrimitive.Content>) {
  return (
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Content
        sideOffset={6}
        className={cn(popoverSurface, "w-80 p-3", className)}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  );
}

// ───────────── Menus ─────────────
const menuItem = cn(
  "relative flex h-8 cursor-default select-none items-center gap-2 rounded-md px-2 text-[13px] outline-none",
  "data-[highlighted]:bg-surface-hover data-[disabled]:opacity-45 [&_svg]:size-4 [&_svg]:text-fg-subtle",
  "data-[variant=danger]:text-danger data-[variant=danger]:[&_svg]:text-danger",
);

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;
export const DropdownMenuSub = DropdownPrimitive.Sub;
export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof DropdownPrimitive.Content>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        sideOffset={sideOffset}
        className={cn(popoverSurface, "min-w-44 p-1", className)}
        {...props}
      />
    </DropdownPrimitive.Portal>
  );
}
export function DropdownMenuItem({
  className,
  shortcut,
  danger,
  children,
  ...props
}: ComponentProps<typeof DropdownPrimitive.Item> & { shortcut?: string; danger?: boolean }) {
  return (
    <DropdownPrimitive.Item
      className={cn(menuItem, className)}
      data-variant={danger ? "danger" : undefined}
      {...props}
    >
      {children}
      {shortcut ? (
        <Shortcut keys={shortcut} className="ml-auto pl-4 [&_kbd]:border-0 [&_kbd]:bg-transparent" />
      ) : null}
    </DropdownPrimitive.Item>
  );
}
export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentProps<typeof DropdownPrimitive.CheckboxItem>) {
  return (
    <DropdownPrimitive.CheckboxItem className={cn(menuItem, "pl-7", className)} {...props}>
      <DropdownPrimitive.ItemIndicator className="absolute left-2 inline-flex">
        <Check className="!text-accent" />
      </DropdownPrimitive.ItemIndicator>
      {children}
    </DropdownPrimitive.CheckboxItem>
  );
}
export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof DropdownPrimitive.Label>) {
  return (
    <DropdownPrimitive.Label
      className={cn("px-2 pt-1.5 pb-1 text-[11px] font-medium text-fg-subtle", className)}
      {...props}
    />
  );
}
export function DropdownMenuSeparator() {
  return <DropdownPrimitive.Separator className="-mx-1 my-1 h-px bg-border" />;
}
export function DropdownMenuSubTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof DropdownPrimitive.SubTrigger>) {
  return (
    <DropdownPrimitive.SubTrigger
      className={cn(menuItem, "data-[state=open]:bg-surface-hover", className)}
      {...props}
    >
      {children}
      <ChevronRight className="ml-auto" />
    </DropdownPrimitive.SubTrigger>
  );
}
export function DropdownMenuSubContent({
  className,
  ...props
}: ComponentProps<typeof DropdownPrimitive.SubContent>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.SubContent
        sideOffset={4}
        className={cn(popoverSurface, "min-w-40 p-1", className)}
        {...props}
      />
    </DropdownPrimitive.Portal>
  );
}

export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;
export function ContextMenuContent({
  className,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content className={cn(popoverSurface, "min-w-44 p-1", className)} {...props} />
    </ContextMenuPrimitive.Portal>
  );
}
export function ContextMenuItem({
  className,
  shortcut,
  danger,
  children,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Item> & { shortcut?: string; danger?: boolean }) {
  return (
    <ContextMenuPrimitive.Item
      className={cn(menuItem, className)}
      data-variant={danger ? "danger" : undefined}
      {...props}
    >
      {children}
      {shortcut ? (
        <Shortcut keys={shortcut} className="ml-auto pl-4 [&_kbd]:border-0 [&_kbd]:bg-transparent" />
      ) : null}
    </ContextMenuPrimitive.Item>
  );
}
export function ContextMenuSeparator() {
  return <ContextMenuPrimitive.Separator className="-mx-1 my-1 h-px bg-border" />;
}

// ───────────── Tabs ─────────────
export const Tabs = TabsPrimitive.Root;
export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn("inline-flex h-8 items-center gap-0.5 rounded-lg bg-surface-sunken p-0.5", className)}
      {...props}
    />
  );
}
export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-fg-muted transition-colors",
        "hover:text-fg data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-sm focus-ring",
        "[&_svg]:size-3.5",
        className,
      )}
      {...props}
    />
  );
}
export const TabsContent = TabsPrimitive.Content;

// ───────────── Form controls ─────────────
export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-border-strong transition-colors",
        "data-[state=checked]:bg-accent focus-ring disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-[var(--ease-spring)] data-[state=checked]:translate-x-[18px]" />
    </SwitchPrimitive.Root>
  );
}

export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "grid size-4 shrink-0 place-items-center rounded-[4px] border border-border-strong bg-surface transition-colors",
        "data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-accent-fg",
        "data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent data-[state=indeterminate]:text-accent-fg",
        "focus-ring",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        {props.checked === "indeterminate" ? (
          <span className="block h-0.5 w-2 rounded bg-current" />
        ) : (
          <Check className="size-3" strokeWidth={3} />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  className,
  ariaLabel,
}: {
  value: string | undefined;
  onValueChange: (v: string) => void;
  options: { value: string; label: ReactNode }[];
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange}>
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={cn(
          "inline-flex h-8 w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-2.5 text-sm",
          "hover:border-border-strong focus-ring data-[placeholder]:text-fg-subtle",
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon>
          <ChevronDown className="size-4 text-fg-subtle" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className={cn(
            popoverSurface,
            "max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden p-1",
          )}
        >
          <SelectPrimitive.Viewport>
            {options.map((o) => (
              <SelectPrimitive.Item key={o.value} value={o.value} className={cn(menuItem, "pr-7")}>
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute right-2 inline-flex">
                  <Check className="!text-accent" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export function Slider({ className, ...props }: ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      className={cn("relative flex h-5 w-full touch-none select-none items-center", className)}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1 grow overflow-hidden rounded-full bg-border">
        <SliderPrimitive.Range className="absolute h-full bg-accent" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="block size-4 rounded-full border-2 border-accent bg-surface shadow-sm focus-ring" />
    </SliderPrimitive.Root>
  );
}
