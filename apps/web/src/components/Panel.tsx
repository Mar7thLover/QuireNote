import { cn } from "@quirenote/ui";
import type { ReactNode } from "react";

/** 面板内部的统一结构：工具栏 + 可滚动内容。 */
export function PanelShell({
  toolbar,
  children,
  className,
}: {
  toolbar?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex h-full min-h-0 flex-col bg-bg text-fg", className)}>
      {toolbar ? (
        <div className="@container flex h-11 min-w-0 shrink-0 items-center gap-1 border-b border-border px-3">
          {toolbar}
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">{children}</div>
    </div>
  );
}

/** 面板名已显示在标签页上；工具栏不再显示条目计数（数字会分散注意力）。 */
export function PanelTitle(_: { children?: ReactNode; count?: number }) {
  return null;
}
