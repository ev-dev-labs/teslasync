import { useSyncExternalStore } from 'react';

/**
 * Shared UI clock for age/relative-time labels. All subscribers — freshness
 * dots, anomaly ages, fleet posture, charge ETAs — share ONE 30s interval no
 * matter how many components subscribe, so a page with dozens of age labels
 * owns a single timer. The tick is only a re-render trigger: labels read the
 * real `Date.now()` during render, so ages stay exact.
 *
 * The interval starts on the first subscription and stops when the last
 * subscriber unmounts. Returns the tick count (handy for tests).
 */
let tick = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const subscribers = new Set<() => void>();

function ensureTimer(): void {
  if (timer != null) return;
  timer = setInterval(() => {
    tick += 1;
    subscribers.forEach((notify) => notify());
  }, 30_000);
}

export function subscribeToTicker(notify: () => void): () => void {
  subscribers.add(notify);
  ensureTimer();
  return () => {
    subscribers.delete(notify);
    if (subscribers.size === 0 && timer != null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export const getTickerTick = (): number => tick;

const noSubscription = (): (() => void) => () => {};

export function useTicker(enabled = true): number {
  return useSyncExternalStore(
    enabled ? subscribeToTicker : noSubscription,
    getTickerTick,
    getTickerTick,
  );
}
