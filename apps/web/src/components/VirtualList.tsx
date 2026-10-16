import { cn } from "@quirenote/ui";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type ReactNode, useRef } from "react";

/** 长列表虚拟化。短列表（< threshold）直接渲染，保留进入动画。 */
export function VirtualList<T>({
  items,
  estimate,
  render,
  getKey,
  className,
  threshold = 60,
  gap = 0,
}: {
  items: T[];
  estimate: number;
  render: (item: T, index: number) => ReactNode;
  getKey: (item: T) => string;
  className?: string;
  threshold?: number;
  gap?: number;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtual = items.length >= threshold;
  const v = useVirtualizer({
    count: virtual ? items.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimate,
    overscan: 8,
    gap,
  });

  if (!virtual) {
    return (
      <div ref={parentRef} className={cn("overflow-y-auto", className)}>
        <div className="flex flex-col" style={{ gap }}>
          {items.map((it, i) => (
            <div key={getKey(it)}>{render(it, i)}</div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div ref={parentRef} className={cn("overflow-y-auto", className)}>
      <div className="relative w-full" style={{ height: v.getTotalSize() }}>
        {v.getVirtualItems().map((row) => (
          <div
            key={getKey(items[row.index]!)}
            data-index={row.index}
            ref={v.measureElement}
            className="absolute top-0 left-0 w-full"
            style={{ transform: `translateY(${row.start}px)` }}
          >
            {render(items[row.index]!, row.index)}
          </div>
        ))}
      </div>
    </div>
  );
}
