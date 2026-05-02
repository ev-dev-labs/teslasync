import { forwardRef, useEffect, useId, useImperativeHandle, useRef, type HTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

const FOCUSABLE_SELECTOR =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

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
  /**
   * Accessible label for the dialog when no `title` is rendered. Required by
   * ARIA when the dialog has no visible heading.
   */
  ariaLabel?: string;
}

/**
 * Surface modal with a backdrop. Mobile + accessibility behaviour:
 * - Below `sm` (< 640px), the modal is full-screen edge-to-edge regardless of
 *   `size`. This is enforced via Tailwind responsive classes so SSR / no-JS
 *   environments behave identically.
 * - Close button is at least 44 × 44 px to satisfy WCAG 2.5.5 (touch target).
 * - Surfaces use `--surface-1` and `--glass-border` tokens, not hard-coded
 *   `bg-white dark:bg-gray-800`, so light + dark themes both render correctly.
 *
 * Accessibility (Phase-40 / Prompt 20):
 * - `role="dialog"` + `aria-modal="true"` so assistive tech announces it as a
 *   modal context.
 * - When `title` is present, the dialog is labelled by the heading via
 *   `aria-labelledby`. Otherwise the caller may pass `ariaLabel`.
 * - Focus is moved into the dialog when it opens (first focusable element, or
 *   the dialog container itself if none exist).
 * - Tab + Shift+Tab are trapped inside the dialog.
 * - Esc closes the dialog (in addition to the existing backdrop click).
 * - Focus returns to the element that triggered the open when the dialog
 *   closes.
 */
export const Modal = forwardRef<HTMLDivElement, ModalProps>(
  ({ open, onClose, title, size = 'md', className, children, ariaLabel, ...props }, ref) => {
    const dialogRef = useRef<HTMLDivElement | null>(null);
    const titleId = useId();
    // Compose the forwarded ref with our internal ref so callers and the
    // focus-trap effect can both reach the dialog node.
    useImperativeHandle(ref, () => dialogRef.current as HTMLDivElement, []);

    useEffect(() => {
      if (!open) return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const previouslyFocused = document.activeElement as HTMLElement | null;

      // Focus the first interactive element, or the dialog container itself
      // if none are present. The container has `tabIndex={-1}` for this.
      const focusables = dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusables.length > 0) {
        focusables[0].focus();
      } else {
        dialog.focus();
      }

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
          return;
        }
        if (e.key !== 'Tab') return;
        const current = dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        if (current.length === 0) {
          e.preventDefault();
          dialog.focus();
          return;
        }
        const first = current[0];
        const last = current[current.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      };

      dialog.addEventListener('keydown', handleKeyDown);
      return () => {
        dialog.removeEventListener('keydown', handleKeyDown);
        // Restore focus to the trigger so keyboard users don't lose context.
        previouslyFocused?.focus?.();
      };
    }, [open, onClose]);

    if (!open) return null;

    const sizes: Record<NonNullable<ModalProps['size']>, string> = {
      sm:   'sm:max-w-sm',
      md:   'sm:max-w-lg',
      lg:   'sm:max-w-2xl',
      full: 'sm:max-w-[min(96vw,1100px)]',
    };

    // Portal to <body> so the modal escapes any ancestor that creates a
    // containing block for `position: fixed` (e.g. `backdrop-filter`,
    // `transform`, `filter`, `perspective` — the StatusBar and sidebar both
    // use `backdrop-blur-xl`). Without this, an inline modal rendered from a
    // status-bar segment is anchored to the bar's bbox, not the viewport, and
    // overflows the screen.
    if (typeof document === 'undefined') return null;

    const overlay = (
      <div className="fixed inset-0 z-50 flex items-stretch justify-stretch sm:items-center sm:justify-center sm:p-4">
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          aria-label={!title ? (ariaLabel ?? undefined) : undefined}
          tabIndex={-1}
          className={cn(
            'relative z-10 flex w-full flex-col bg-[var(--surface-1)] text-[var(--text-primary)] shadow-xl outline-none',
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
              <h2 id={titleId} className="min-w-0 truncate text-lg font-semibold text-[var(--text-primary)]">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className={cn(
                  'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg',
                  'text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent',
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

    return createPortal(overlay, document.body);
  },
);
Modal.displayName = 'Modal';
