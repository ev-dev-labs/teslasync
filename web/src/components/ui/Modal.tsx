import { forwardRef, useCallback, useId, useRef, type HTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { useDialogFocus } from '@/hooks/useDialogFocus';
import { PanelTitle } from './Typography';

export interface ModalProps extends HTMLAttributes<HTMLDivElement> {
  open: boolean;
  onClose: () => void;
  title?: string;
  /**
   * Width preset for `≥ sm` viewports. Below `sm` (640px) the modal is always
   * viewport-contained and full-width regardless of this prop.
   */
  size?: 'sm' | 'md' | 'lg' | 'full' | 'fullscreen';
  children: ReactNode;
  /** Persistent actions outside the scrolling dialog body. */
  footer?: ReactNode;
  /**
   * Accessible label for the dialog when no `title` is rendered. Required by
   * ARIA when the dialog has no visible heading.
   */
  ariaLabel?: string;
}

/**
 * Surface modal with a backdrop. Mobile + accessibility behaviour:
 * - Below `sm` (< 640px), the modal is full-width edge-to-edge regardless of
 *   `size`. This is enforced via Tailwind responsive classes so SSR / no-JS
 *   environments behave identically.
 * - Close button is at least 44 × 44 px to satisfy WCAG 2.5.5 (touch target).
 * - Surfaces use `--surface-1` and `--border-default` tokens, not hard-coded
 *   `bg-white dark:bg-gray-800`, so light + dark themes both render correctly.
 *
 * Accessibility:
 * - `role="dialog"` + `aria-modal="true"` so assistive tech announces it as a
 *   modal context.
 * - When `title` is present, the dialog is labelled by the heading via
 *   `aria-labelledby`. Otherwise the caller may pass `ariaLabel`.
 * - Focus is moved into the dialog when it opens (`[data-autofocus]` if the
 *   caller marks one, else the first focusable element, else the dialog
 *   container). Focus is set once on open and is NOT re-stolen when the
 *   parent re-renders.
 * - Tab + Shift+Tab are trapped inside the dialog.
 * - Esc closes the dialog (in addition to the existing backdrop click).
 * - Focus returns to the element that triggered the open when the dialog
 *   closes; if that element was removed while the dialog was open, focus
 *   falls back to the page heading / `<main>` instead of `<body>`.
 *
 * All four behaviours come from the shared `useDialogFocus` hook so Modal,
 * Drawer, and Lightbox cannot drift apart.
 */
export const Modal = forwardRef<HTMLDivElement, ModalProps>(
  ({ open, onClose, title, size = 'md', className, children, footer, ariaLabel, ...props }, ref) => {
    const { t } = useTranslation();
    const fullscreen = size === 'fullscreen';
    const dialogRef = useRef<HTMLDivElement | null>(null);
    const titleId = useId();
    // A callback tracks portal mount/unmount even when the modal starts closed.
    const setDialogRef = useCallback((node: HTMLDivElement | null) => {
      dialogRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    }, [ref]);

    // Shared focus contract (A11Y-04): initial focus, Tab trap, Escape,
    // and trigger restore with a resilient fallback when the trigger was
    // removed while the dialog was open.
    useDialogFocus({ open, containerRef: dialogRef, onClose });

    if (!open) return null;

    const sizes: Record<NonNullable<ModalProps['size']>, string> = {
      sm:   'sm:max-w-sm',
      md:   'sm:max-w-lg',
      lg:   'sm:max-w-2xl',
      full: 'sm:max-w-[min(96vw,1100px)]',
      fullscreen: 'max-w-none',
    };

    // Portal to <body> so the modal escapes any ancestor that creates a
    // containing block for `position: fixed` (e.g. `backdrop-filter`,
    // `transform`, `filter`, `perspective` — the StatusBar and sidebar both
    // use `backdrop-blur-xl`). Without this, an inline modal rendered from a
    // status-bar segment is anchored to the bar's bbox, not the viewport, and
    // overflows the screen.
    //
    // z-[60] is chosen to sit ABOVE the footer StatusBar (z-[55]) and the
    // mobile top bar so neither chrome ever clips the modal's edges.
    if (typeof document === 'undefined') return null;

    const overlay = (
      // This is the shared <Modal> source of truth. All other interactive
      // dialogs MUST use this component instead of hand-rolling overlays.
      // eslint-disable-next-line no-restricted-syntax
      <div className="fixed inset-0 z-[60] overflow-y-auto">
        <div
          // Forced-colors mode suppresses
          // box-shadow + background-image, so a glass backdrop with a
          // semi-transparent rgba turns invisible. Force an opaque
          // Canvas-colour scrim so the dialog reads as modal in
          // Windows High Contrast.
          className="fixed inset-0 bg-[var(--surface-overlay)] forced-colors:bg-[Canvas]"
          onClick={onClose}
          aria-hidden="true"
        />
        <div className={cn(
          'relative flex min-h-full justify-center',
          fullscreen ? 'items-stretch' : 'items-end pb-[var(--shell-chrome-bottom)] sm:items-center sm:p-4 sm:pb-4',
        )}>
          <div
            ref={setDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            aria-label={!title ? (ariaLabel ?? undefined) : undefined}
            tabIndex={-1}
            className={cn(
              'relative z-10 flex w-full min-w-0 flex-col bg-[var(--surface-1)] text-[var(--text-primary)] shadow-e3 outline-none',
              'border border-[var(--border-default)]',
              // Pin the dialog edge to a system
              // colour so the modal frame remains perceivable when the
              // glass-border alpha collapses to transparent.
              'forced-colors:border-[CanvasText] forced-colors:bg-[Canvas]',
              // Below sm: bottom sheet that fills width, capped to viewport height.
              // From sm and up: rounded card, auto height up to 90vh, centered.
              fullscreen ? 'h-[100dvh] max-h-[100dvh] rounded-none'
                : 'max-h-[calc(100dvh-var(--shell-chrome-bottom,0px))] rounded-none sm:h-auto sm:max-h-[90vh] sm:rounded-panel',
              sizes[size],
              className,
            )}
            {...props}
          >
            {title && (
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-default)] px-4 pt-4 pb-3 sm:px-6 sm:pt-6 sm:pb-4">
                <PanelTitle as="h2" id={titleId} className="min-w-0 break-words">{title}</PanelTitle>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={t('modal.close', 'Close')}
                  className={cn(
                    'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-shape-sm',
                    'text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]',
                    'transition-colors duration-fast motion-reduce:transition-none [-webkit-tap-highlight-color:transparent] [touch-action:manipulation]',
                  )}
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
            )}
            <div
              data-modal-scroll-body="true"
              className={fullscreen
                ? 'flex min-h-0 flex-1 flex-col overflow-hidden p-4 sm:p-6 safe-bottom'
                : 'min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3 sm:px-6 sm:pb-6 safe-bottom'}
            >
              {children}
            </div>
            {footer && (
              <div data-modal-footer="true" className="shrink-0 border-t border-[var(--border-default)] bg-[var(--surface-1)] px-4 py-3 sm:px-6 safe-bottom">
                {footer}
              </div>
            )}
          </div>
        </div>
      </div>
    );

    return createPortal(overlay, document.body);
  },
);
Modal.displayName = 'Modal';
