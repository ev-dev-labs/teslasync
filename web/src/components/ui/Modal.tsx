import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface ModalProps extends HTMLAttributes<HTMLDivElement> {
  open: boolean;
  onClose: () => void;
  title?: string;
  /**
   * Width preset for `≥ sm` viewports. Below `sm` (640px) the modal is always
   * full-screen regardless of this prop — see MOBILE_GUIDELINES.md.
   */
  size?: 'sm' | 'md' | 'lg' | 'full';
  children: ReactNode;
}

/**
 * Surface modal with a backdrop. Mobile behaviour:
 * - Below `sm` (< 640px), the modal is full-screen edge-to-edge regardless of
 *   `size`. This is enforced via Tailwind responsive classes so SSR / no-JS
 *   environments behave identically.
 * - Close button is at least 44 × 44 px to satisfy WCAG 2.5.5 (touch target).
 * - Surfaces use `--surface-1` and `--glass-border` tokens, not hard-coded
 *   `bg-white dark:bg-gray-800`, so light + dark themes both render correctly.
 */
export const Modal = forwardRef<HTMLDivElement, ModalProps>(
  ({ open, onClose, title, size = 'md', className, children, ...props }, ref) => {
    if (!open) return null;

    const sizes: Record<NonNullable<ModalProps['size']>, string> = {
      sm:   'sm:max-w-sm',
      md:   'sm:max-w-lg',
      lg:   'sm:max-w-2xl',
      full: 'sm:max-w-[min(96vw,1100px)]',
    };

    return (
      <div className="fixed inset-0 z-50 flex items-stretch justify-stretch sm:items-center sm:justify-center sm:p-4">
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className={cn(
            'relative z-10 flex w-full flex-col bg-[var(--surface-1)] text-[var(--text-primary)] shadow-xl',
            'border border-[var(--glass-border)]',
            // Below sm: full-screen. From sm and up: rounded card with cap height.
            'h-full max-h-screen rounded-none sm:h-auto sm:max-h-[90vh] sm:rounded-lg',
            sizes[size],
            className,
          )}
          {...props}
        >
          {title && (
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--glass-border)] px-4 pt-4 pb-3 sm:px-6 sm:pt-6 sm:pb-4">
              <h2 className="min-w-0 truncate text-lg font-semibold text-[var(--text-primary)]">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className={cn(
                  'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg',
                  'text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]',
                  'active:scale-95 [-webkit-tap-highlight-color:transparent] [touch-action:manipulation]',
                )}
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
          )}
          <div className="flex-1 overflow-y-auto px-4 pb-4 pt-3 sm:px-6 sm:pb-6 safe-bottom">
            {children}
          </div>
        </div>
      </div>
    );
  },
);
Modal.displayName = 'Modal';
