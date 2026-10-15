import { cn } from "@folio/ui";
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
    <div className={cn("flex h-full min-h-0 flex-col bg-surface text-fg", className)}>
      {toolbar ? (
        <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border/70 px-2.5">
          {toolbar}
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">{children}</div>
    </div>
  );
}

/** 面板名已显示在标签页上，工具栏里只放计数等辅助信息。 */
export function PanelTitle({ count }: { children?: ReactNode; count?: number }) {
  if (count === undefined) return null;
  return <span className="px-1 text-xs tabular-nums text-fg-subtle">{count} 项</span>;
}
