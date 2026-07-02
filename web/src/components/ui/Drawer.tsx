import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { AnimatePresence, motion, type MotionProps, type PanInfo } from 'framer-motion';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  side?: 'left' | 'right';
  className?: string;
}

// Swipe-to-dismiss thresholds. A gesture that either drags the panel past
// SWIPE_DISMISS_DISTANCE_PX toward its closing edge OR flicks it with at least
// SWIPE_DISMISS_VELOCITY (px/s) dismisses the drawer; anything short of that
// springs back to the open position. Tuned to match the feel of native iOS /
// Android sheet dismissal.
const SWIPE_DISMISS_DISTANCE_PX = 80;
const SWIPE_DISMISS_VELOCITY = 400;

// Original hand-rolled spring (framer `damping`/`stiffness`) preserved verbatim
// so the slide-in timing is visually identical to the pre-Radix implementation.
const PANEL_SPRING = { type: 'spring', damping: 30, stiffness: 300 } as const;

/**
 * Slide-in side panel, rebuilt on Radix UI's `Dialog` primitive (the same
 * primitive powering `<Modal>` / `<ConfirmDialog>`), so it inherits a correct
 * focus trap (Tab / Shift+Tab loop), Escape-to-close, outside-pointer dismissal,
 * background scroll-lock and `role="dialog"` / `aria-labelledby` wiring instead
 * of the previous hand-rolled `keydown` handler. The primitive is unstyled, so
 * the existing glassmorphism design is ported verbatim onto the Radix parts —
 * every Tailwind class below matches the previous implementation, so all
 * existing call-sites render identically with zero prop changes.
 *
 * Motion (unchanged intent): the overlay fades and the panel slides in/out from
 * its edge via Framer Motion. `AnimatePresence` + Radix `forceMount` keep the
 * exit animation that a bare Radix mount/unmount would drop — Radix owns the
 * open state while Framer owns enter/exit, the officially documented pairing.
 *
 * Mobile + accessibility improvements layered on top of the original:
 * - The close control is a ≥ 44 × 44 px target (WCAG 2.5.5) rather than the
 *   previous ~28 px hit area, with `touch-action: manipulation` and no
 *   tap-highlight flash.
 * - On coarse-pointer (touch) devices the panel is swipe-to-dismiss: drag it
 *   toward its own edge to close. Pointer/keyboard users keep the overlay tap,
 *   Escape and close button. Swipe is gated to touch so a desktop mouse can't
 *   accidentally drag the panel.
 * - `prefers-reduced-motion` collapses the slide to a plain fade with no
 *   transform (detected via a guarded `matchMedia`, SSR / jsdom safe).
 * - When no visible `title` is supplied the panel keeps its original chrome-less
 *   look but still exposes an accessible name through a visually-hidden title so
 *   Radix can label the dialog (no missing-title warning, no unnamed dialog).
 *
 * Because this Drawer is controlled purely via the `open` prop (no
 * `Dialog.Trigger`), Radix has no trigger to restore focus to on close — the
 * opener is captured in `onOpenAutoFocus` and restored in `onCloseAutoFocus`.
 */
export function Drawer({ open, onClose, title, children, footer, side = 'right', className }: DrawerProps) {
  const { t } = useTranslation();

  // The element focused before the drawer opened, so focus returns to it on
  // close (Radix's default restore targets a `Dialog.Trigger`, which this
  // controlled Drawer does not render).
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Enable swipe-to-dismiss only on touch pointers, and honour reduced motion.
  // Both are derived from media queries behind a `matchMedia` guard so the
  // component is safe under SSR and jsdom (where `matchMedia` is undefined) —
  // in those environments both stay `false`, i.e. no drag and full motion.
  const [canSwipe, setCanSwipe] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const coarse = window.matchMedia('(pointer: coarse)');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    setCanSwipe(coarse.matches);
    setReduceMotion(reduced.matches);
    const onCoarse = (e: MediaQueryListEvent) => setCanSwipe(e.matches);
    const onReduced = (e: MediaQueryListEvent) => setReduceMotion(e.matches);
    coarse.addEventListener('change', onCoarse);
    reduced.addEventListener('change', onReduced);
    return () => {
      coarse.removeEventListener('change', onCoarse);
      reduced.removeEventListener('change', onReduced);
    };
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      // Radix funnels Escape, outside-pointer, and Close-button dismissals
      // through a single `onOpenChange(false)` — route them all to onClose,
      // preserving the original backdrop-click + Escape behaviour.
      if (!next) onClose();
    },
    [onClose],
  );

  const handleDragEnd = useCallback(
    (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      // Dismiss when the panel is dragged past the distance threshold toward
      // its closing edge, or flicked with enough velocity in that direction.
      const dismissed =
        side === 'right'
          ? info.offset.x > SWIPE_DISMISS_DISTANCE_PX || info.velocity.x > SWIPE_DISMISS_VELOCITY
          : info.offset.x < -SWIPE_DISMISS_DISTANCE_PX || info.velocity.x < -SWIPE_DISMISS_VELOCITY;
      if (dismissed) onClose();
      // Otherwise Framer springs the panel back to its `animate` position.
    },
    [side, onClose],
  );

  // Only enable drag on touch devices, and clamp it to the closing direction so
  // the panel can't be dragged further onto the screen. The non-closing edge is
  // hard-bounded at the open position; the closing edge is free to follow the
  // finger 1:1 until release.
  const dragProps: MotionProps = canSwipe
    ? {
        drag: 'x',
        dragConstraints: side === 'right' ? { left: 0 } : { right: 0 },
        dragElastic: 0.15,
        dragMomentum: false,
        onDragEnd: handleDragEnd,
      }
    : {};

  const offscreen = side === 'right' ? '100%' : '-100%';
  const panelHidden = reduceMotion ? { opacity: 0 } : { x: offscreen };
  const panelShown = reduceMotion ? { opacity: 1 } : { x: 0 };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <AnimatePresence>
        {open ? (
          <Dialog.Portal key="drawer" forceMount>
            {/*
              `cn(...)` (rather than a bare string literal) is deliberate for the
              fixed-inset overlay: this shared Drawer is the one legitimate home
              for those overlay classes, matching the <Modal> source of truth.
            */}
            <Dialog.Overlay asChild forceMount>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.2 }}
                className={cn(
                  'fixed inset-0 z-50 bg-[var(--surface-overlay)] backdrop-blur-sm forced-colors:bg-[Canvas]',
                )}
              />
            </Dialog.Overlay>
            <Dialog.Content
              asChild
              forceMount
              aria-modal="true"
              aria-describedby={undefined}
              tabIndex={-1}
              onOpenAutoFocus={() => {
                // Capture the opener BEFORE Radix moves focus into the dialog;
                // let Radix focus the first focusable (matching prior behaviour).
                previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
              }}
              onCloseAutoFocus={(e) => {
                // Radix would focus a (non-existent) trigger; restore the opener
                // instead so keyboard users don't lose their place.
                e.preventDefault();
                previouslyFocusedRef.current?.focus?.();
              }}
            >
              <motion.div
                {...dragProps}
                initial={panelHidden}
                animate={panelShown}
                exit={panelHidden}
                transition={reduceMotion ? { duration: 0 } : PANEL_SPRING}
                className={cn(
                  'fixed top-0 bottom-0 z-50 flex h-full w-full max-w-md flex-col glass-panel rounded-none border-0 outline-hidden',
                  side === 'right'
                    ? 'right-0 border-l border-white/[0.06] forced-colors:border-l-[CanvasText]'
                    : 'left-0 border-r border-white/[0.06] forced-colors:border-r-[CanvasText]',
                  className,
                )}
              >
                {title ? (
                  <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.06] px-6 py-4">
                    <Dialog.Title className="min-w-0 truncate text-lg font-semibold text-[var(--text-primary)]">
                      {title}
                    </Dialog.Title>
                    <Dialog.Close asChild>
                      <button
                        type="button"
                        aria-label={t('common.close', 'Close')}
                        className={cn(
                          'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg',
                          'text-[var(--text-muted)] hover:bg-white/[0.06] hover:text-[var(--text-primary)]',
                          'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent',
                          'active:scale-95 [-webkit-tap-highlight-color:transparent] [touch-action:manipulation] transition-colors',
                        )}
                      >
                        <X className="h-5 w-5" aria-hidden="true" />
                      </button>
                    </Dialog.Close>
                  </div>
                ) : (
                  // No visible chrome (original behaviour), but still expose an
                  // accessible name so Radix can label the dialog.
                  <Dialog.Title className="sr-only">{t('common.panel', 'Panel')}</Dialog.Title>
                )}
                <div
                  className={cn(
                    'flex-1 overflow-y-auto overscroll-contain p-6',
                    !footer && 'safe-bottom',
                  )}
                >
                  {children}
                </div>
                {footer ? (
                  <div className="shrink-0 border-t border-white/[0.06] bg-[var(--surface-overlay)] px-6 py-4 backdrop-blur-xl safe-bottom">
                    {footer}
                  </div>
                ) : null}
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  );
}
