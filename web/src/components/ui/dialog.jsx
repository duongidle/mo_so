import * as React from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

/* shadcn/ui Dialog (Radix): khoá focus trong hộp thoại, trả focus về nút mở, khoá cuộn nền, aria đầy đủ, Esc/bấm ra ngoài để đóng.
   Giao diện giữ nguyên ngôn ngữ phẳng của Mở Sổ: viền mảnh, không đổ bóng; điện thoại là tấm trượt từ đáy, từ 720px là hộp giữa màn hình. */

function Dialog(props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger(props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal(props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose(props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({ className, ...props }) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 z-[100] bg-[rgba(48,31,18,.5)]',
        'data-[state=open]:animate-[ms-fade-in_.2s_ease-out] data-[state=closed]:animate-[ms-fade-out_.12s_ease-in_forwards]',
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({ className, children, wide = false, ...props }) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-wide={wide || undefined}
        // Không tự nhảy vào ô đầu tiên (trên điện thoại sẽ bật bàn phím); focus vào khung hộp thoại để vẫn bị khoá trong đó
        onOpenAutoFocus={(e) => { e.preventDefault(); e.currentTarget.focus(); }}
        className={cn(
          'fixed inset-x-0 bottom-0 z-[101] mx-auto w-full max-w-[580px] max-h-[92vh] overflow-y-auto outline-none',
          'rounded-t-xl border border-border bg-popover text-popover-foreground',
          'p-[var(--modal-pad)] pb-[max(var(--modal-pad),env(safe-area-inset-bottom))]',
          'min-[720px]:inset-auto min-[720px]:top-1/2 min-[720px]:left-1/2 min-[720px]:-translate-x-1/2 min-[720px]:-translate-y-1/2 min-[720px]:rounded-xl',
          'data-[wide]:max-w-[980px]',
          'data-[state=open]:animate-[ms-sheet-in_.25s_var(--ease)] data-[state=closed]:animate-[ms-sheet-out_.12s_ease-in_forwards]',
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }) {
  return <div data-slot="dialog-header" className={cn('mb-3 flex items-center justify-between gap-3', className)} {...props} />;
}

function DialogFooter({ className, ...props }) {
  return <div data-slot="dialog-footer" className={cn('mt-4 flex flex-wrap items-center justify-end gap-[10px]', className)} {...props} />;
}

function DialogTitle({ className, ...props }) {
  // h2 của app đã có kiểu chữ riêng (font display); không thêm cỡ chữ ở đây
  return <DialogPrimitive.Title data-slot="dialog-title" className={cn('m-0', className)} {...props} />;
}

function DialogDescription({ className, ...props }) {
  return <DialogPrimitive.Description data-slot="dialog-description" className={cn('text-muted-foreground text-[13px]', className)} {...props} />;
}

export { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogOverlay, DialogPortal, DialogTitle, DialogTrigger };
