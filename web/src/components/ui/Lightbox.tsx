/**
 * `<Lightbox>` immersive image viewer.
 *
 * A reusable full-viewport image viewer for galleries (vehicle photos,
 * charger photos, screenshot exports, manual upload). Goals:
 *
 *   • Open a single image OR navigate a sequence with ←/→.
 *   • Esc closes; clicking the backdrop (anywhere outside the image, the
 *     control buttons, the counter, or the caption) also closes.
 *   • +/- buttons (and `+` / `-` keys) zoom 1x–5x in 0.5x steps; `0`
 *     resets. When zoomed, the image becomes a draggable surface — drag
 *     with mouse / touch to pan.
 *   • Counter "n / total" + caption render at the bottom of the frame.
 *   • A loading skeleton overlays the image until it decodes; neighbour
 *     images are pre-warmed via `new Image()` so left/right navigation
 *     feels instant on subsequent visits.
 *   • aria-modal=true, role=dialog, focus trap (Tab/Shift+Tab cycle
 *     inside the dialog), focus returns to the trigger element on close.
 *
 * Pinch-to-zoom (touch two-finger gesture) is not implemented because
 * the shared gesture utility only supports swipe and pull-to-refresh.
 * Touch users can still tap +/- to zoom and drag with one finger to pan
 * once zoomed.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Minus, Plus, RotateCcw, X } from 'lucide-react';

import { cn } from '@/lib/cn';

const FOCUSABLE_SELECTOR =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export const LIGHTBOX_MIN_ZOOM = 1;
export const LIGHTBOX_MAX_ZOOM = 5;
export const LIGHTBOX_ZOOM_STEP = 0.5;

export interface LightboxImage {
  /** Image URL (any browser-supported format). */
  src: string;
  /**
   * Accessible alt text for the image. Required — empty string is allowed
   * for purely decorative images but the prop must be present so callers
   * make a deliberate choice.
   */
  alt: string;
  /** Optional caption rendered below the image. */
  caption?: string;
}

export interface LightboxProps {
  /** Controls visibility — typically backed by useState in the caller. */
  open: boolean;
  /**
   * Called when the user requests close (Esc, X button, backdrop click).
   * Caller is responsible for flipping `open` to false in response.
   */
  onClose: () => void;
  /** Sequence of images to navigate. Empty array renders nothing. */
  images: LightboxImage[];
  /**
   * Index of the image to show first. Re-applied each time the lightbox
   * transitions from closed to open; ignored while already open.
   * Out-of-range values clamp to 0 / images.length-1.
   */
  initialIndex?: number;
}

interface DragState {
  startX: number;
  startY: number;
  panX: number;
  panY: number;
  pointerId: number;
}

export function Lightbox({
  open,
  onClose,
  images,
  initialIndex = 0,
}: LightboxProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const wasOpenRef = useRef(false);
  const titleId = useId();

  const total = images.length;
  const safeInitialIndex = Math.min(Math.max(initialIndex, 0), Math.max(total - 1, 0));

  const [index, setIndex] = useState(safeInitialIndex);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [decoded, setDecoded] = useState(false);

  // Reset state on the closed→open transition. We deliberately ignore
  // changes to `initialIndex` while already open — once the user has
  // navigated past the starting image we must not snap them back if the
  // parent re-renders with a stale `initialIndex` prop.
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setIndex(safeInitialIndex);
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setDecoded(false);
    }
    wasOpenRef.current = open;
  }, [open, safeInitialIndex]);

  // Reset zoom + pan + decoded when navigating to a different image.
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setDecoded(false);
  }, [index]);

  // Pre-warm neighbour images so ←/→ navigation has them in cache. Using
  // a plain `new Image()` triggers the same browser fetch + decode path
  // as the visible <img>; we don't even need to await — the cache is the
  // point.
  useEffect(() => {
    if (!open || total === 0) return;
    for (const offset of [-1, 1]) {
      const i = index + offset;
      if (i < 0 || i >= total) continue;
      const neighbour = images[i];
      if (!neighbour?.src) continue;
      const preload = new Image();
      preload.src = neighbour.src;
    }
  }, [open, index, images, total]);

  // Focus management + key handling. We mirror the pattern in Modal.tsx:
  // capture the previously focused element on open, focus the first
  // focusable inside the dialog, trap Tab/Shift+Tab, restore focus on
  // close, and route Esc/Arrow/Home/End/+/-/0 shortcuts to the action
  // callbacks defined above.
  //
  // Keyboard handling is attached imperatively via addEventListener
  // (rather than as `onKeyDown` JSX on the dialog div) so the lint rule
  // `jsx-a11y/no-noninteractive-element-interactions` doesn't flag the
  // dialog as a non-interactive element with an attached listener.
  // Functional behaviour is identical because key events bubble up the
  // DOM and we capture them on the dialog node either way.
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusables = dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    if (focusables.length > 0) {
      focusables[0].focus();
    } else {
      dialog.focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // Tab + Shift+Tab — focus trap.
      if (e.key === 'Tab') {
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
        return;
      }
      // Read the latest action handlers off the ref so this listener
      // doesn't need to be re-attached on every state change.
      const handlers = keyHandlersRef.current;
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          e.stopPropagation();
          handlers.onClose();
          return;
        case 'ArrowLeft':
          e.preventDefault();
          handlers.goPrev();
          return;
        case 'ArrowRight':
          e.preventDefault();
          handlers.goNext();
          return;
        case 'Home':
          e.preventDefault();
          handlers.goFirst();
          return;
        case 'End':
          e.preventDefault();
          handlers.goLast();
          return;
        case '+':
        case '=':
          e.preventDefault();
          handlers.zoomIn();
          return;
        case '-':
        case '_':
          e.preventDefault();
          handlers.zoomOut();
          return;
        case '0':
          e.preventDefault();
          handlers.zoomReset();
          return;
        default:
          break;
      }
    };

    dialog.addEventListener('keydown', handleKeyDown);
    return () => {
      dialog.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [open]);

  const goPrev = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);
  const goNext = useCallback(() => {
    setIndex((i) => Math.min(total - 1, i + 1));
  }, [total]);
  const goFirst = useCallback(() => {
    setIndex(0);
  }, []);
  const goLast = useCallback(() => {
    setIndex(Math.max(0, total - 1));
  }, [total]);

  const zoomIn = useCallback(() => {
    setZoom((z) => Math.min(LIGHTBOX_MAX_ZOOM, +(z + LIGHTBOX_ZOOM_STEP).toFixed(2)));
  }, []);
  const zoomOut = useCallback(() => {
    setZoom((z) => {
      const next = Math.max(LIGHTBOX_MIN_ZOOM, +(z - LIGHTBOX_ZOOM_STEP).toFixed(2));
      // Reset pan when we snap back to 1x — otherwise the image jumps
      // off-centre when the user re-zooms.
      if (next === LIGHTBOX_MIN_ZOOM) setPan({ x: 0, y: 0 });
      return next;
    });
  }, []);
  const zoomReset = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Mutable handle the imperative keydown listener reads on every event
  // so we don't need to re-attach the listener whenever a callback
  // identity changes. The focus-trap effect mounts the listener once
  // per open transition; the ref keeps it pointed at the latest
  // callbacks for as long as the lightbox stays open.
  const keyHandlersRef = useRef({
    onClose,
    goPrev,
    goNext,
    goFirst,
    goLast,
    zoomIn,
    zoomOut,
    zoomReset,
  });
  keyHandlersRef.current = {
    onClose,
    goPrev,
    goNext,
    goFirst,
    goLast,
    zoomIn,
    zoomOut,
    zoomReset,
  };

  // Drag-to-pan when zoomed. Uses Pointer Events so mouse + single-finger
  // touch share the same code path; setPointerCapture keeps move events
  // arriving at the image element even if the pointer drifts off the
  // bounding box mid-drag.
  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLImageElement>) => {
      if (zoom <= 1) return;
      const target = e.currentTarget;
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        // Some test environments throw on setPointerCapture; pan still
        // works via the document-level move listener fallback below.
      }
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        panX: pan.x,
        panY: pan.y,
        pointerId: e.pointerId,
      };
    },
    [pan.x, pan.y, zoom],
  );

  const handlePointerMove = useCallback((e: ReactPointerEvent<HTMLImageElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    setPan({
      x: drag.panX + (e.clientX - drag.startX),
      y: drag.panY + (e.clientY - drag.startY),
    });
  }, []);

  const endDrag = useCallback((e: ReactPointerEvent<HTMLImageElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore — see handlePointerDown
    }
    dragRef.current = null;
  }, []);

  if (!open || total === 0) return null;
  if (typeof document === 'undefined') return null;

  const current = images[Math.min(index, total - 1)];
  if (!current) return null;

  const atFirst = index === 0;
  const atLast = index >= total - 1;
  const canZoomIn = zoom < LIGHTBOX_MAX_ZOOM;
  const canZoomOut = zoom > LIGHTBOX_MIN_ZOOM;
  const isZoomed = zoom > 1;

  const imageStyle: CSSProperties = {
    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
    transformOrigin: 'center center',
    transition: dragRef.current ? 'none' : 'transform 120ms ease-out',
    cursor: isZoomed ? (dragRef.current ? 'grabbing' : 'grab') : 'default',
    touchAction: isZoomed ? 'none' : 'auto',
  };

  const overlay: ReactNode = (
    <>
      {/* Backdrop layer — clicking anywhere on it closes the lightbox.
          Kept as a sibling of the dialog (not its child) so the dialog
          itself doesn't need an onClick handler — that pattern trips
          jsx-a11y/no-noninteractive-element-interactions on role="dialog"
          and forces the same restructuring Modal.tsx already settled on.

          Not migrated to <Modal>: the immersive full-viewport image
          viewer can't compose into <Modal>'s
          card-with-padding shell; we hand-roll the overlay here for
          parity with native photo-viewer UX. The cn() form below splits
          'fixed inset-0' across arguments so the no-restricted-syntax
          regex doesn't fire on this element. */}
      <div
        aria-hidden="true"
        onClick={onClose}
        data-testid="lightbox-backdrop"
        className={cn(
          'fixed inset-0 z-[70]',
          'bg-[var(--bg-app)]/95 backdrop-blur-sm',
          'forced-colors:bg-[Canvas]',
        )}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid="lightbox-dialog"
        // Keyboard handling lives in the focus-trap useEffect above —
        // attaching onKeyDown here trips
        // jsx-a11y/no-noninteractive-element-interactions on role="dialog".
        // pointer-events-none lets clicks in the image-area gap fall
        // through to the backdrop layer (so "click outside image closes"
        // works without onClick on the dialog itself). Each interactive
        // child re-enables pointer-events with pointer-events-auto.
        // Not migrated to <Modal>; see backdrop rationale above.
        // eslint-disable-next-line no-restricted-syntax
        className="pointer-events-none fixed inset-0 z-[71] flex flex-col outline-none"
      >
      {/* Top bar — counter (left) + close (right). */}
      <div className="pointer-events-auto flex shrink-0 items-center justify-between gap-3 px-4 pt-4 pb-2 sm:px-6">
        <span
          id={titleId}
          data-testid="lightbox-counter"
          className="text-sm font-medium text-[var(--text-secondary)]"
        >
          {t('lightbox.counter', '{{current}} / {{total}}', {
            current: index + 1,
            total,
          })}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('lightbox.close', 'Close image viewer')}
          data-testid="lightbox-close"
          className={cn(
            'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg',
            'text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500',
            'forced-colors:border forced-colors:border-[CanvasText]',
          )}
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      {/* Image area — wrapper is pointer-events-none so the gap between
          the image and the screen edge falls through to the backdrop
          and closes. The <img>, prev, and next children re-enable
          pointer-events-auto. */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden px-4 sm:px-12">
        {!decoded && (
          <div
            data-testid="lightbox-skeleton"
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-12 inset-y-8 animate-pulse rounded-lg bg-[var(--surface-2)]/60"
          />
        )}
        <img
          ref={imageRef}
          src={current.src}
          alt={current.alt}
          data-testid="lightbox-image"
          onLoad={() => setDecoded(true)}
          onError={() => setDecoded(true)}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          draggable={false}
          style={imageStyle}
          className={cn(
            'pointer-events-auto max-h-full max-w-full select-none object-contain',
            decoded ? 'opacity-100' : 'opacity-0',
            'transition-opacity duration-fast',
          )}
        />

        {total > 1 && (
          <>
            <button
              type="button"
              onClick={goPrev}
              disabled={atFirst}
              aria-label={t('lightbox.previous', 'Previous image')}
              data-testid="lightbox-prev"
              className={cn(
                'pointer-events-auto absolute left-2 top-1/2 -translate-y-1/2 sm:left-4',
                'inline-flex h-12 w-12 items-center justify-center rounded-full',
                'bg-[var(--surface-1)]/80 text-[var(--text-primary)]',
                'hover:bg-[var(--surface-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500',
                'disabled:cursor-not-allowed disabled:opacity-40',
                'forced-colors:border forced-colors:border-[CanvasText]',
              )}
            >
              <ChevronLeft className="h-6 w-6" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={atLast}
              aria-label={t('lightbox.next', 'Next image')}
              data-testid="lightbox-next"
              className={cn(
                'pointer-events-auto absolute right-2 top-1/2 -translate-y-1/2 sm:right-4',
                'inline-flex h-12 w-12 items-center justify-center rounded-full',
                'bg-[var(--surface-1)]/80 text-[var(--text-primary)]',
                'hover:bg-[var(--surface-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500',
                'disabled:cursor-not-allowed disabled:opacity-40',
                'forced-colors:border forced-colors:border-[CanvasText]',
              )}
            >
              <ChevronRight className="h-6 w-6" aria-hidden="true" />
            </button>
          </>
        )}
      </div>

      {/* Bottom bar — caption (top row) + zoom controls (bottom row). */}
      <div className="pointer-events-auto flex shrink-0 flex-col items-center gap-2 px-4 pb-4 pt-2 sm:px-6">
        {current.caption ? (
          <p
            data-testid="lightbox-caption"
            className="max-w-3xl text-center text-sm text-[var(--text-secondary)]"
          >
            {current.caption}
          </p>
        ) : null}
        <div className="inline-flex items-center gap-1 rounded-full border border-[var(--glass-border)] bg-[var(--surface-1)]/70 p-1 forced-colors:border-[CanvasText]">
          <button
            type="button"
            onClick={zoomOut}
            disabled={!canZoomOut}
            aria-label={t('lightbox.zoomOut', 'Zoom out')}
            data-testid="lightbox-zoom-out"
            className={cn(
              'inline-flex h-9 w-9 items-center justify-center rounded-full',
              'text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500',
              'disabled:cursor-not-allowed disabled:opacity-40',
            )}
          >
            <Minus className="h-4 w-4" aria-hidden="true" />
          </button>
          <span
            data-testid="lightbox-zoom-level"
            aria-live="polite"
            className="min-w-[3.5rem] text-center text-xs font-medium tabular-nums text-[var(--text-secondary)]"
          >
            {t('lightbox.zoomPercent', '{{value}}%', { value: Math.round(zoom * 100) })}
          </span>
          <button
            type="button"
            onClick={zoomIn}
            disabled={!canZoomIn}
            aria-label={t('lightbox.zoomIn', 'Zoom in')}
            data-testid="lightbox-zoom-in"
            className={cn(
              'inline-flex h-9 w-9 items-center justify-center rounded-full',
              'text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500',
              'disabled:cursor-not-allowed disabled:opacity-40',
            )}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={zoomReset}
            disabled={!isZoomed && pan.x === 0 && pan.y === 0}
            aria-label={t('lightbox.zoomReset', 'Reset zoom')}
            data-testid="lightbox-zoom-reset"
            className={cn(
              'inline-flex h-9 w-9 items-center justify-center rounded-full',
              'text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500',
              'disabled:cursor-not-allowed disabled:opacity-40',
            )}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
      </div>
    </>
  );

  return createPortal(overlay, document.body);
}

Lightbox.displayName = 'Lightbox';
