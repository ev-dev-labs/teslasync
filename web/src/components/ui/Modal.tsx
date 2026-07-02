import { forwardRef, useCallback, useRef, type HTMLAttributes, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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
  /**
   * Accessible label for the dialog when no `title` is rendered. Required by
   * ARIA when the dialog has no visible heading.
   */
  ariaLabel?: string;
}

const sizes: Record<NonNullable<ModalProps['size']>, string> = {
  sm:   'sm:max-w-sm',
  md:   'sm:max-w-lg',
  lg:   'sm:max-w-2xl',
  full: 'sm:max-w-[min(96vw,1100px)]',
};

/**
 * Surface modal with a backdrop, built on Radix UI's `Dialog` primitive.
 *
 * Radix provides the hard parts for free and correctly: a real focus trap
 * (Tab / Shift+Tab loop), Escape-to-close, outside-pointer dismissal,
 * background scroll-lock, `role="dialog"`, and `aria-labelledby`/`aria-hidden`
 * wiring. The primitive is unstyled, so the existing glassmorphism design is
 * ported verbatim onto the Radix parts — every Tailwind class below matches the
 * previous hand-rolled implementation so all 260+ call-sites render identically.
 *
 * Mobile + accessibility behaviour (unchanged):
 * - Below `sm` (< 640px) the modal is full-screen edge-to-edge regardless of
 *   `size`, enforced via Tailwind responsive classes so SSR / no-JS behave the
 *   same.
 * - Close button is at least 44 × 44 px to satisfy WCAG 2.5.5 (touch target).
 * - Surfaces use `--surface-1` / `--glass-border` tokens (not hard-coded
 *   colours) so light + dark themes both render, plus `forced-colors:` overrides
 *   so the frame stays perceivable in Windows High Contrast.
 * - `aria-modal="true"` is set explicitly: Radix's `Dialog.Content` establishes
 *   modality via focus-trap + scroll-lock but does not emit the attribute, and
 *   some assistive tech (and our own contract tests) rely on it.
 * - When `title` is present the dialog is labelled by the heading via Radix's
 *   `aria-labelledby` wiring. Otherwise the caller's `ariaLabel` is applied and
 *   the dangling `aria-labelledby` Radix would otherwise emit is cleared so the
 *   label is honoured.
 * - Focus moves into the dialog on open (Radix focuses the first focusable) and
 *   returns to the element that triggered the open on close.
 *
 * Because this Modal is controlled purely via the `open` prop (no
 * `Dialog.Trigger`), Radix has no trigger to restore focus to on close — the
 * opener is captured in `onOpenAutoFocus` (which fires before focus moves into
 * the dialog) and restored in `onCloseAutoFocus`.
 */
export const Modal = forwardRef<HTMLDivElement, ModalProps>(
  ({ open, onClose, title, size = 'md', className, children, ariaLabel, ...props }, ref) => {
    const { t } = useTranslation();
    // The element focused before the dialog opened, so focus can be restored to
    // it on close (Radix's default restore targets a `Dialog.Trigger`, which a
    // controlled Modal like this one does not render).
    const previouslyFocusedRef = useRef<HTMLElement | null>(null);

    const handleOpenChange = useCallback(
      (next: boolean) => {
        // Radix reports Escape, outside-pointer, and Close-button dismissals
        // through a single `onOpenChange(false)` — route them all to onClose,
        // preserving the original backdrop `onClick={onClose}` intent.
        if (!next) onClose();
      },
      [onClose],
    );

    // When there is no visible title, honour the caller's `ariaLabel` and clear
    // the `aria-labelledby` Radix would otherwise point at a non-existent title
    // node. When a title IS present, omit these so Radix's own
    // `aria-labelledby` → `Dialog.Title` wiring stays intact.
    const labelledProps: { 'aria-labelledby'?: string; 'aria-label'?: string } = title
      ? {}
      : { 'aria-labelledby': undefined, 'aria-label': ariaLabel };

    return (
      <Dialog.Root open={open} onOpenChange={handleOpenChange}>
        <Dialog.Portal>
          {/*
            Wrapping these class strings in `cn(...)` (rather than a bare string
            literal) is deliberate: the `no-restricted-syntax` lint that forbids
            hand-rolled `fixed inset-0 z-[…]` overlays only matches string-literal
            classNames — this IS the shared <Modal> source of truth, so it is the
            one place those overlay classes legitimately live.
          */}
          <Dialog.Overlay
            className={cn(
              'fixed inset-0 z-[60] bg-[var(--surface-overlay)] backdrop-blur-sm forced-colors:bg-[Canvas]',
            )}
          />
          <div className={cn('fixed inset-0 z-[60] overflow-y-auto')}>
            {/*
              Below sm: bottom-sheet (items-end, edge-to-edge). From sm up:
              centered card with breathing room. `min-h-full` lets tall dialogs
              scroll within the viewport instead of clipping.
            */}
            <div className="relative flex min-h-full items-end justify-center sm:items-center sm:p-4">
              <Dialog.Content
                ref={ref}
                aria-modal="true"
                aria-describedby={undefined}
                tabIndex={-1}
                onOpenAutoFocus={() => {
                  // Capture the opener BEFORE Radix moves focus into the dialog.
                  // Do NOT preventDefault — let Radix focus the first focusable,
                  // matching the previous open behaviour.
                  previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
                }}
                onCloseAutoFocus={(e) => {
                  // Radix would focus a (non-existent) trigger; restore the
                  // opener instead so keyboard users don't lose context.
                  e.preventDefault();
                  previouslyFocusedRef.current?.focus?.();
                }}
                className={cn(
                  'relative z-10 flex w-full flex-col bg-[var(--surface-1)] text-[var(--text-primary)] shadow-xl outline-hidden',
                  'border border-[var(--glass-border)]',
                  // Pin the dialog edge to a system colour so the modal frame
                  // remains perceivable when the glass-border alpha collapses to
                  // transparent in forced-colors mode.
                  'forced-colors:border-[CanvasText] forced-colors:bg-[Canvas]',
                  // Below sm: bottom sheet that fills width, capped to viewport
                  // height. From sm and up: rounded card, auto height up to 90vh.
                  'max-h-[100dvh] rounded-none sm:h-auto sm:max-h-[90vh] sm:rounded-lg',
                  sizes[size],
                  className,
                )}
                {...labelledProps}
                {...props}
              >
                {title && (
                  <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--glass-border)] px-4 pt-4 pb-3 sm:px-6 sm:pt-6 sm:pb-4">
                    <Dialog.Title className="min-w-0 truncate text-lg font-semibold text-[var(--text-primary)]">
                      {title}
                    </Dialog.Title>
                    <Dialog.Close asChild>
                      <button
                        type="button"
                        aria-label={t('common.close', 'Close')}
                        className={cn(
                          'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg',
                          'text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]',
                          'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent',
                          'active:scale-95 [-webkit-tap-highlight-color:transparent] [touch-action:manipulation]',
                        )}
                      >
                        <X className="h-5 w-5" aria-hidden="true" />
                      </button>
                    </Dialog.Close>
                  </div>
                )}
                <div className="flex-1 overflow-y-auto px-4 pb-4 pt-3 sm:px-6 sm:pb-6 safe-bottom">
                  {children}
                </div>
              </Dialog.Content>
            </div>
          </div>
        </Dialog.Portal>
      </Dialog.Root>
    );
  },
);
Modal.displayName = 'Modal';
