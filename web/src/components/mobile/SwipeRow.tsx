/**
 * Phase-46 / Prompt 10 — Swipe-to-action row primitive.
 *
 * Native-feel swipe-to-archive / swipe-to-delete row for mobile lists.
 * Mirrors the iOS Mail / Apple Notes interaction:
 *   - Drag left to reveal the right-edge action (`rightAction`).
 *   - Drag right to reveal the left-edge action (`leftAction`).
 *   - A short release (past `revealThreshold`, default 64 px) leaves the
 *     row "peeked" with the action button visible — the user taps it to
 *     fire.
 *   - A long release (past 50 % of the row width) auto-fires the action
 *     immediately on release, mirroring the iOS "swipe-to-delete-fast"
 *     gesture.
 *   - A vertical drag aborts the gesture so the parent list can keep
 *     scrolling normally — we never fight the scroll axis.
 *   - When the action threshold is crossed for the first time we trigger
 *     a 10 ms haptic via `navigator.vibrate(10)` (no-op on unsupported
 *     browsers).
 *
 * Touch-only by default: `enabled` defaults to `useIsCoarsePointer()`.
 * On desktop / mouse the row renders its children straight through with
 * zero handlers attached — keyboard a11y for archive/delete actions is
 * handled by the existing per-row buttons in the wrapped row component.
 *
 * Honours `prefers-reduced-motion: reduce` by collapsing the snap-back
 * transition to 0 ms.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Archive, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useIsCoarsePointer } from '@/hooks/useMediaQuery';
import { useMotionPreference } from '@/hooks/useMotionPreference';

export interface SwipeAction {
  /** Localised label rendered inside the action button. */
  label: string;
  /** Fires when the user taps the action button or auto-completes. */
  onAction: () => void;
  /** Visual tone — `danger` paints rose, `default` paints cyan. */
  tone?: 'danger' | 'default';
  /** Optional override icon; defaults to Archive / Trash2 by tone. */
  icon?: ReactNode;
  /**
   * Optional `aria-label` for the action button when `label` itself is
   * not screen-reader friendly. Defaults to `label`.
   */
  ariaLabel?: string;
}

export interface SwipeRowProps {
  children: ReactNode;
  /** Action revealed by a left swipe (i.e. dragging towards the start). */
  rightAction?: SwipeAction;
  /** Action revealed by a right swipe (i.e. dragging towards the end). */
  leftAction?: SwipeAction;
  /** Touch-only opt-in; defaults to `useIsCoarsePointer()`. */
  enabled?: boolean;
  /** Distance the user must drag before the action is "revealed". */
  revealThreshold?: number;
  className?: string;
}

const DEFAULT_REVEAL = 64;
/** Vertical drift past which we cancel and let the parent scroll. */
const VERTICAL_TOLERANCE = 16;
/** Width of the underlay action panel in px. */
const ACTION_WIDTH = 96;

function defaultIcon(action: SwipeAction): ReactNode {
  if (action.icon) return action.icon;
  return action.tone === 'danger'
    ? <Trash2 className="h-4 w-4" aria-hidden="true" />
    : <Archive className="h-4 w-4" aria-hidden="true" />;
}

function actionPanelClasses(tone: SwipeAction['tone']): string {
  return tone === 'danger'
    ? 'bg-rose-500/20 text-rose-100 hover:bg-rose-500/30'
    : 'bg-cyan-500/20 text-cyan-100 hover:bg-cyan-500/30';
}

function safeVibrate(ms: number): void {
  if (typeof navigator === 'undefined') return;
  const nav = navigator as Navigator & {
    vibrate?: (pattern: number | number[]) => boolean;
  };
  if (typeof nav.vibrate === 'function') {
    try {
      nav.vibrate(ms);
    } catch {
      /* swallow — best-effort haptic */
    }
  }
}

export function SwipeRow({
  children,
  rightAction,
  leftAction,
  enabled,
  revealThreshold = DEFAULT_REVEAL,
  className,
}: SwipeRowProps) {
  const isCoarse = useIsCoarsePointer();
  const { reduce } = useMotionPreference();
  const active = (enabled ?? isCoarse) && (rightAction != null || leftAction != null);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef<number | null>(null);
  const startYRef = useRef<number | null>(null);
  const offsetRef = useRef(0);
  const draggingRef = useRef(false);
  const cancelledRef = useRef(false);
  const hapticFiredRef = useRef(false);
  const [offset, setOffset] = useState(0);
  const [snap, setSnap] = useState(true);

  const updateOffset = useCallback((next: number) => {
    offsetRef.current = next;
    setOffset(next);
  }, []);

  const close = useCallback(() => {
    setSnap(true);
    updateOffset(0);
  }, [updateOffset]);

  const fireRight = useCallback(() => {
    rightAction?.onAction();
    close();
  }, [rightAction, close]);

  const fireLeft = useCallback(() => {
    leftAction?.onAction();
    close();
  }, [leftAction, close]);

  useEffect(() => {
    if (!active) return;
    const node = wrapperRef.current;
    if (!node) return;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      if (!touch) return;
      startXRef.current = touch.clientX;
      startYRef.current = touch.clientY;
      draggingRef.current = false;
      cancelledRef.current = false;
      hapticFiredRef.current = false;
      setSnap(false);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (cancelledRef.current) return;
      if (startXRef.current == null || startYRef.current == null) return;
      const touch = e.touches[0];
      if (!touch) return;
      const dx = touch.clientX - startXRef.current;
      const dy = touch.clientY - startYRef.current;

      // Vertical drift — abandon this row's gesture so the list can
      // continue to scroll normally.
      if (!draggingRef.current && Math.abs(dy) > VERTICAL_TOLERANCE && Math.abs(dy) > Math.abs(dx)) {
        cancelledRef.current = true;
        updateOffset(0);
        return;
      }

      // Lock onto the horizontal axis once we've moved more than 8 px
      // horizontally — this is what tells us "the user wants to swipe".
      if (!draggingRef.current && Math.abs(dx) < 8) {
        return;
      }
      draggingRef.current = true;

      // Limit the drag to whichever side has an action wired up.
      let next = dx;
      if (next < 0 && !rightAction) next = 0;
      if (next > 0 && !leftAction) next = 0;

      // Resist past a generous overshoot so the row never disappears.
      const width = node.getBoundingClientRect().width || 320;
      const maxAbs = width;
      if (next < -maxAbs) next = -maxAbs;
      if (next > maxAbs) next = maxAbs;

      // Fire a single haptic blip the first time the user crosses the
      // reveal threshold — gives a tactile "click" matching iOS Mail.
      const crossed = Math.abs(next) >= revealThreshold;
      if (crossed && !hapticFiredRef.current) {
        hapticFiredRef.current = true;
        safeVibrate(10);
      }

      if (e.cancelable && draggingRef.current) {
        e.preventDefault();
      }
      updateOffset(next);
    };

    const onTouchEnd = () => {
      const finalOffset = offsetRef.current;
      const wasDragging = draggingRef.current;
      const wasCancelled = cancelledRef.current;
      startXRef.current = null;
      startYRef.current = null;
      draggingRef.current = false;
      hapticFiredRef.current = false;
      setSnap(true);

      if (wasCancelled || !wasDragging) {
        updateOffset(0);
        return;
      }

      const width = node.getBoundingClientRect().width || 320;
      const halfWidth = width / 2;

      if (finalOffset <= -halfWidth && rightAction) {
        // Far left swipe → auto-fire the right-edge action.
        fireRight();
        return;
      }
      if (finalOffset >= halfWidth && leftAction) {
        fireLeft();
        return;
      }
      if (finalOffset <= -revealThreshold && rightAction) {
        // Peek the action open so the user can tap the button.
        updateOffset(-ACTION_WIDTH);
        return;
      }
      if (finalOffset >= revealThreshold && leftAction) {
        updateOffset(ACTION_WIDTH);
        return;
      }
      updateOffset(0);
    };

    const onTouchCancel = () => {
      startXRef.current = null;
      startYRef.current = null;
      draggingRef.current = false;
      cancelledRef.current = true;
      hapticFiredRef.current = false;
      setSnap(true);
      updateOffset(0);
    };

    node.addEventListener('touchstart', onTouchStart, { passive: true });
    node.addEventListener('touchmove', onTouchMove, { passive: false });
    node.addEventListener('touchend', onTouchEnd, { passive: true });
    node.addEventListener('touchcancel', onTouchCancel, { passive: true });
    return () => {
      node.removeEventListener('touchstart', onTouchStart);
      node.removeEventListener('touchmove', onTouchMove);
      node.removeEventListener('touchend', onTouchEnd);
      node.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [active, rightAction, leftAction, revealThreshold, fireLeft, fireRight, updateOffset]);

  if (!active) {
    return <>{children}</>;
  }

  const transitionClass = snap && !reduce
    ? 'transition-transform duration-fast ease-out'
    : '';

  return (
    <div
      ref={wrapperRef}
      className={cn('relative overflow-hidden', className)}
      data-testid="swipe-row"
      data-offset={Math.round(offset)}
    >
      {rightAction && (
        <div
          aria-hidden={offset >= 0}
          className={cn(
            'absolute inset-y-0 right-0 flex items-stretch',
            offset >= 0 && 'pointer-events-none',
          )}
          style={{ width: `${ACTION_WIDTH}px` }}
        >
          <button
            type="button"
            onClick={fireRight}
            tabIndex={offset < 0 ? 0 : -1}
            aria-label={rightAction.ariaLabel ?? rightAction.label}
            className={cn(
              'flex w-full items-center justify-center gap-1.5 text-xs font-medium',
              actionPanelClasses(rightAction.tone),
            )}
          >
            {defaultIcon(rightAction)}
            <span>{rightAction.label}</span>
          </button>
        </div>
      )}
      {leftAction && (
        <div
          aria-hidden={offset <= 0}
          className={cn(
            'absolute inset-y-0 left-0 flex items-stretch',
            offset <= 0 && 'pointer-events-none',
          )}
          style={{ width: `${ACTION_WIDTH}px` }}
        >
          <button
            type="button"
            onClick={fireLeft}
            tabIndex={offset > 0 ? 0 : -1}
            aria-label={leftAction.ariaLabel ?? leftAction.label}
            className={cn(
              'flex w-full items-center justify-center gap-1.5 text-xs font-medium',
              actionPanelClasses(leftAction.tone),
            )}
          >
            {defaultIcon(leftAction)}
            <span>{leftAction.label}</span>
          </button>
        </div>
      )}
      <div
        className={cn('relative bg-[var(--bg-canvas,transparent)]', transitionClass)}
        style={{ transform: `translate3d(${offset}px, 0, 0)` }}
      >
        {children}
      </div>
    </div>
  );
}
