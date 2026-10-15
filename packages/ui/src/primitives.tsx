import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { type ComponentProps, forwardRef, type ReactNode } from "react";
import { cn } from "./cn";

// ───────────── Button ─────────────
export const buttonVariants = cva(
  [
    "inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap font-medium",
    "transition-[background-color,color,box-shadow,transform,opacity] duration-150 ease-out",
    "focus-ring disabled:pointer-events-none disabled:opacity-45 active:scale-[0.97]",
    "[&_svg]:size-4 [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-fg shadow-sm hover:bg-accent-hover",
        secondary:
          "border border-border bg-surface text-fg shadow-sm hover:bg-surface-hover hover:border-border-strong",
        ghost: "text-fg-muted hover:bg-surface-hover hover:text-fg",
        soft: "bg-accent-soft text-accent-soft-fg hover:bg-accent-soft-hover",
        danger: "bg-danger text-white shadow-sm hover:opacity-90",
        link: "text-accent underline-offset-4 hover:underline",
      },
      size: {
        xs: "h-6 rounded-sm px-2 text-xs [&_svg]:size-3.5",
        sm: "h-7 rounded-md px-2.5 text-[13px]",
        md: "h-8 rounded-md px-3 text-sm",
        lg: "h-10 rounded-lg px-4 text-[15px]",
        icon: "size-8 rounded-md",
        "icon-sm": "size-7 rounded-md",
        "icon-xs": "size-6 rounded-sm [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps extends ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild, loading, children, disabled, type = "button", ...props },
  ref,
) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : type}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading ? <Spinner /> : null}
          {children}
        </>
      )}
    </Comp>
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("size-4 animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** 三点"正在思考"指示器。 */
export function TypingDots({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)} role="status" aria-label="loading">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 rounded-full bg-current"
          style={{ animation: `pulse-dot 1.2s ${i * 0.16}s ease-in-out infinite` }}
        />
      ))}
    </span>
  );
}

// ───────────── Inputs ─────────────
export const inputClass = cn(
  "w-full rounded-md border border-border bg-surface px-2.5 text-sm text-fg placeholder:text-fg-subtle",
  "transition-[border-color,box-shadow] duration-150 hover:border-border-strong",
  "focus:border-accent focus:outline-none focus:ring-3 focus:ring-ring/40 disabled:opacity-50",
);

export const Input = forwardRef<HTMLInputElement, ComponentProps<"input">>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(inputClass, "h-8", className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, ComponentProps<"textarea">>(function Textarea(
  { className, ...props },
  ref,
) {
  return (
    <textarea ref={ref} className={cn(inputClass, "min-h-20 py-2 leading-relaxed", className)} {...props} />
  );
});

export function Label({ className, ...props }: ComponentProps<"label">) {
  // biome-ignore lint/a11y/noLabelWithoutControl: 由调用方传入 htmlFor 或包裹控件
  return <label className={cn("text-[13px] font-medium text-fg-muted", className)} {...props} />;
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-[13px] font-medium text-fg-muted">{label}</span>
      {children}
      {hint ? <span className="text-xs text-fg-subtle">{hint}</span> : null}
    </div>
  );
}

// ───────────── Kbd / Badge ─────────────
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-border border-b-2 bg-surface px-1",
        "font-sans text-[11px] font-medium text-fg-subtle",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** 把 "Mod+K" 渲染成平台对应的按键组合。 */
export function Shortcut({ keys, className }: { keys: string; className?: string }) {
  const parts = keys.split("+").map((k) => {
    if (k === "Mod") return isMac ? "⌘" : "Ctrl";
    if (k === "Shift") return isMac ? "⇧" : "Shift";
    if (k === "Alt") return isMac ? "⌥" : "Alt";
    if (k === "Enter") return "↵";
    return k;
  });
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {parts.map((p, i) => (
        <Kbd key={i}>{p}</Kbd>
      ))}
    </span>
  );
}

export const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full font-medium [&_svg]:size-3",
  {
    variants: {
      tone: {
        neutral: "bg-surface-sunken text-fg-muted",
        accent: "bg-accent-soft text-accent-soft-fg",
        success: "bg-success-soft text-success",
        warning: "bg-warning-soft text-warning",
        danger: "bg-danger-soft text-danger",
        outline: "border border-border text-fg-muted",
      },
      size: { sm: "h-5 px-2 text-[11px]", md: "h-6 px-2.5 text-xs" },
    },
    defaultVariants: { tone: "neutral", size: "sm" },
  },
);

export function Badge({
  className,
  tone,
  size,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone, size }), className)} {...props} />;
}

/** 彩色标签（元素类型、自定义 select 选项）。 */
const TAG_COLORS: Record<string, string> = {
  indigo: "oklch(0.55 0.17 272)",
  violet: "oklch(0.55 0.19 300)",
  amber: "oklch(0.62 0.14 70)",
  rose: "oklch(0.58 0.18 10)",
  orange: "oklch(0.62 0.16 45)",
  emerald: "oklch(0.58 0.13 160)",
  sky: "oklch(0.6 0.13 230)",
  teal: "oklch(0.58 0.1 190)",
  fuchsia: "oklch(0.58 0.2 330)",
  gray: "oklch(0.55 0.01 272)",
};
export const TAG_COLOR_NAMES = Object.keys(TAG_COLORS);

export function Tag({
  color = "gray",
  children,
  className,
  ...props
}: ComponentProps<"span"> & { color?: string }) {
  const c = TAG_COLORS[color] ?? TAG_COLORS.gray!;
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-sm px-1.5 text-[11.5px] font-medium",
        className,
      )}
      style={{ color: c, background: `color-mix(in srgb, ${c} 13%, transparent)` }}
      {...props}
    >
      {children}
    </span>
  );
}

export function tagColor(color: string): string {
  return TAG_COLORS[color] ?? TAG_COLORS.gray!;
}

// ───────────── Layout helpers ─────────────
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-4", className)} aria-hidden />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-10 text-center", className)}>
      {icon ? (
        <div className="grid size-11 place-items-center rounded-xl bg-surface-sunken text-fg-subtle [&_svg]:size-5">
          {icon}
        </div>
      ) : null}
      <div className="space-y-1">
        <p className="text-sm font-medium text-fg">{title}</p>
        {description ? (
          <p className="max-w-72 text-[13px] leading-relaxed text-fg-subtle">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function Separator({ className, vertical }: { className?: string; vertical?: boolean }) {
  return (
    <hr
      aria-orientation={vertical ? "vertical" : "horizontal"}
      className={cn(vertical ? "h-4 w-px" : "h-px w-full", "m-0 shrink-0 border-0 bg-border", className)}
    />
  );
}

export function SectionLabel({
  children,
  className,
  action,
}: {
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <div className={cn("flex h-7 items-center justify-between px-1", className)}>
      <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-subtle">{children}</span>
      {action}
    </div>
  );
}
