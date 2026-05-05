/**
 * Phase-46 / Prompt 10 — Pull-to-refresh primitive.
 *
 * Native-feel pull-to-refresh wrapper for mobile lists. Mirrors the iOS
 * Mail / Slack interaction:
 *   1. User starts a touch at the very top of the scroll container.
 *   2. User drags down — a small spinner / arc grows with the pull.
 *   3. Past the threshold (default 80 px) the bar locks into the
 *      "release to refresh" state.
 *   4. On release past threshold we fire `onRefresh()` and show the
 *      "Refreshing…" label until the returned promise resolves.
 *   5. On release below threshold we snap back without firing.
 *
 * Touch-only by default: `enabled` defaults to `useIsCoarsePointer()` so
 * desktop / mouse users never see the indicator and never have their
 * scroll hijacked by the touch handlers.
 *
 * Honours `prefers-reduced-motion: reduce` by collapsing the snap-back
 * transition to 0 ms (no spring animation).
 *
 * Touch listeners are attached imperatively with `{ passive: false }` so
 * we can `preventDefault()` the move event during a pull — without that
 * the browser would natively scroll the page or trigger its own
 * pull-to-refresh shell, fighting our gesture.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useIsCoarsePointer } from '@/hooks/useMediaQuery';
import { useMotionPreference } from '@/hooks/useMotionPreference';

export interface PullToRefreshProps {
  /**
   * Callback fired when the user releases past the pull threshold. The
   * "Refreshing…" indicator stays visible until the returned promise
   * settles (resolves OR rejects — we never leave the indicator stuck).
   */
  onRefresh: () => Promise<unknown>;
  /** Pixels the user must pull before a release fires `onRefresh`. */
  threshold?: number;
  children: ReactNode;
  /**
   * Override the touch-only default. When `undefined`, gestures opt in
   * automatically on coarse-pointer (touch / pen) devices.
   */
  enabled?: boolean;
  className?: string;
}

const DEFAULT_THRESHOLD = 80;
/** Visual ceiling — past this point we resist further pull (rubber band). */
const MAX_PULL = 140;

/** Walk up from the wrapper to find a scrolling ancestor; fall back to root. */
function isAtScrollTop(wrapper: HTMLElement | null): boolean {
  if (typeof window === 'undefined') return true;
  if (wrapper) {
    let node: HTMLElement | null = wrapper;
    while (node && node !== document.body) {
      const overflowY = window.getComputedStyle(node).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
        return node.scrollTop <= 0;
      }
      node = node.parentElement;
    }
  }
  const docEl = document.documentElement;
  const bodyTop = document.body?.scrollTop ?? 0;
  const docTop = docEl?.scrollTop ?? 0;
  const winTop = window.scrollY ?? 0;
  return Math.max(bodyTop, docTop, winTop) <= 0;
}

export function PullToRefresh({
  onRefresh,
  threshold = DEFAULT_THRESHOLD,
  children,
  enabled,
  className,
}: PullToRefreshProps) {
  const { t } = useTranslation();
  const isCoarse = useIsCoarsePointer();
  const { reduce } = useMotionPreference();
  const active = enabled ?? isCoarse;

  const wrapperRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef<number | null>(null);
  const armedRef = useRef(false);
  const pullRef = useRef(0);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const updatePull = useCallback((next: number) => {
    pullRef.current = next;
    setPull(next);
  }, []);

  const reset = useCallback(() => {
    startYRef.current = null;
    armedRef.current = false;
    updatePull(0);
  }, [updatePull]);

  useEffect(() => {
    if (!active) return;
    const node = wrapperRef.current;
    if (!node) return;

    let pendingRelease = false;

    const release = async () => {
      if (pendingRelease) return;
      pendingRelease = true;
      const distance = pullRef.current;
      const wasArmed = armedRef.current;
      reset();
      if (!wasArmed || distance < threshold) {
        pendingRelease = false;
        return;
      }
      setRefreshing(true);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
        pendingRelease = false;
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      if (refreshing) return;
      if (e.touches.length !== 1) return;
      if (!isAtScrollTop(node)) return;
      const touch = e.touches[0];
      if (!touch) return;
      startYRef.current = touch.clientY;
      armedRef.current = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!armedRef.current || refreshing) return;
      const touch = e.touches[0];
      if (!touch || startYRef.current == null) return;
      const delta = touch.clientY - startYRef.current;
      if (delta <= 0) {
        if (pullRef.current !== 0) updatePull(0);
        armedRef.current = false;
        return;
      }
      const resisted = delta < threshold
        ? delta
        : threshold + (delta - threshold) * 0.5;
      const clamped = Math.min(resisted, MAX_PULL);
      if (e.cancelable && delta > 8) {
        e.preventDefault();
      }
      updatePull(clamped);
    };

    const onTouchEnd = () => {
      if (!armedRef.current && pullRef.current === 0) return;
      void release();
    };

    const onTouchCancel = () => {
      reset();
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
  }, [active, refreshing, onRefresh, reset, threshold, updatePull]);

  // When the gesture is disabled we render children straight through —
  // no wrapper, no listeners — so the desktop DOM stays clean and the
  // audit can confirm there are zero pointer hooks attached.
  if (!active) {
    return <>{children}</>;
  }

  const progress = refreshing ? 1 : Math.min(pull / threshold, 1);
  const ready = pull >= threshold;
  const indicatorHeight = refreshing ? threshold * 0.6 : pull;

  return (
    <div
      ref={wrapperRef}
      className={cn('relative', className)}
      data-testid="pull-to-refresh"
      data-pull={Math.round(pull)}
      data-refreshing={refreshing ? 'true' : 'false'}
      data-ready={ready ? 'true' : 'false'}
    >
      {(pull > 0 || refreshing) && (
        <div
          aria-hidden={!refreshing}
          className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-end justify-center overflow-hidden"
          style={{ height: `${indicatorHeight}px` }}
        >
          <div
            role={refreshing ? 'status' : undefined}
            aria-live={refreshing ? 'polite' : undefined}
            className="mb-1 flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-white/[0.06] px-3 py-1 text-xs text-[var(--text-secondary)] backdrop-blur"
            style={{
              opacity: Math.max(0.4, progress),
              transform: `scale(${0.8 + progress * 0.2})`,
            }}
          >
            <Loader2
              className={cn(
                'h-3.5 w-3.5',
                refreshing && !reduce && 'animate-spin',
              )}
              style={{
                transform: refreshing
                  ? undefined
                  : `rotate(${progress * 270}deg)`,
              }}
            />
            <span>
              {refreshing
                ? t('mobile.refresh.refreshing', 'Refreshing…')
                : ready
                  ? t('mobile.refresh.release', 'Release to refresh')
                  : t('mobile.refresh.pull', 'Pull to refresh')}
            </span>
          </div>
        </div>
      )}
      <div
        className={cn(refreshing ? 'pointer-events-none' : undefined)}
        style={{
          transform: `translate3d(0, ${refreshing ? threshold * 0.6 : pull}px, 0)`,
          transition: reduce || pull > 0 || refreshing
            ? undefined
            : 'transform var(--motion-duration-fast, 150ms) ease-out',
        }}
      >
        {children}
      </div>
    </div>
  );
}
