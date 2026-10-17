import {
  cn,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@quirenote/ui";
import { Check } from "lucide-react";
import { Fragment } from "react";
import type { MenuItem, MenuSection } from "@/lib/contextMenu";

/**
 * 把菜单描述渲染成下拉菜单项。右键菜单和「…」按钮共用，两处的条目始终一致。
 * run 决定菜单项何时执行：右键菜单等菜单关闭、焦点还回去之后再执行。
 */
export function MenuItems({
  sections,
  run = (fn) => fn(),
}: {
  sections: MenuSection[];
  run?: (fn: () => void) => void;
}) {
  return (
    <>
      {sections.map((section, i) => (
        <Fragment key={section[0]?.id ?? i}>
          {i > 0 ? <DropdownMenuSeparator /> : null}
          {section.map((item) => (
            <Item key={item.id} item={item} run={run} />
          ))}
        </Fragment>
      ))}
    </>
  );
}

function Lead({ item }: { item: MenuItem }) {
  if (item.swatch)
    return (
      <span
        aria-hidden
        className={cn(
          "grid size-4 shrink-0 place-items-center rounded-full ring-1 ring-black/10",
          item.swatch,
          item.checked && "ring-2 ring-fg/60",
        )}
      >
        {item.checked ? <Check className="!size-3 !text-fg" strokeWidth={3} /> : null}
      </span>
    );
  if (item.icon) {
    const Icon = item.icon;
    return <Icon />;
  }
  // 没有图标的条目留出同样的宽度，文字对齐。
  return <span aria-hidden className="size-4 shrink-0" />;
}

function Item({ item, run }: { item: MenuItem; run: (fn: () => void) => void }) {
  if (item.items) {
    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger disabled={item.disabled} data-menu-id={item.id}>
          <Lead item={item} />
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent data-context-menu className="w-max min-w-44 max-w-72">
          <MenuItems sections={[item.items]} run={run} />
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  }
  const onSelect = item.onSelect;
  return (
    <DropdownMenuItem
      data-menu-id={item.id}
      danger={item.danger}
      disabled={item.disabled}
      shortcut={item.shortcut}
      onSelect={() => onSelect && run(onSelect)}
    >
      <Lead item={item} />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.checked && !item.swatch ? <Check className="ml-2 !text-fg-muted" /> : null}
    </DropdownMenuItem>
  );
}
