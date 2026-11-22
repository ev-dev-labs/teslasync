import { cn } from '@/lib/cn';

export const modalMessageActions = cn(
  '[&>[data-app-part=dialog-header]>[data-heading-level=panel]]:border-s-[3px]',
  '[&>[data-app-part=dialog-header]>[data-heading-level=panel]]:border-[var(--theme-primary)]',
  '[&>[data-app-part=dialog-header]>[data-heading-level=panel]]:ps-2.5',
  '[&>:where([data-modal-footer])]:border-[var(--border-strong)] [&>:where([data-modal-footer])]:bg-[var(--surface-2)]',
  'forced-colors:[&>:where([data-modal-footer])]:border-[CanvasText]',
);
