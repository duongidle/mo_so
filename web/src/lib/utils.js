import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Gộp class (chuẩn shadcn/ui): clsx để ghép điều kiện, tailwind-merge để class sau thắng class trước. */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
