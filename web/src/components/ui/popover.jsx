import * as React from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

/* shadcn/ui Popover (Radix): định vị bám nút mở, tự lật khi sát mép màn hình, Esc/bấm ra ngoài để đóng, trả focus về nút. */

function Popover(props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger(props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverAnchor(props) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

function PopoverClose(props) {
  return <PopoverPrimitive.Close data-slot="popover-close" {...props} />;
}

function PopoverContent({ className, align = 'start', sideOffset = 6, collisionPadding = 16, ...props }) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          'z-[60] flex flex-col gap-1.5 w-[440px] max-w-[calc(100vw-32px)] max-h-[min(70vh,var(--radix-popover-content-available-height))] overflow-y-auto outline-none',
          'rounded-md border border-[var(--champagne)] bg-popover text-popover-foreground',
          'px-[14px] py-3 text-left text-[13px] leading-normal',
          'origin-[var(--radix-popover-content-transform-origin)]',
          'data-[state=open]:animate-[ms-pop-in_.16s_var(--ease)] data-[state=closed]:animate-[ms-pop-out_.1s_ease-in_forwards]',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverAnchor, PopoverClose, PopoverContent, PopoverTrigger };
