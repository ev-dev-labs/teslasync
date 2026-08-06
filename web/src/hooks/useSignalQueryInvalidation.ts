/**
 * @module hooks/useSignalQueryInvalidation
 *
 * Bridges the typed `signal_change` SSE channel into TanStack Query cache
 * invalidation.
 *
 * Polling alone makes a "live" page only as fresh as its interval — a 5s
 * poller shows a stale gear, torque and pedal reading for up to 5 seconds
 * after the vehicle actually changed. The backend already pushes every
 * field-level change over SSE, so this hook maps the pushed field name onto
 * the query keys that project it and invalidates them, collapsing the
 * worst-case staleness to the coalescing window.
 *
 * Two properties matter for correctness:
 *
 *  1. **Coalescing.** Powertrain signals arrive at many hertz. Invalidating
 *     per event would issue a request storm far worse than the poll it
 *     replaces. Events are therefore accumulated and flushed at most once per
 *     `throttleMs` per group.
 *  2. **Background suppression.** `refetchIntervalInBackground` is `false`
 *     app-wide (see api/queryClient.ts) so polls pause on a hidden tab. SSE
 *     events keep arriving regardless, so the flush is skipped while the
 *     document is hidden — otherwise this hook would silently reintroduce the
 *     background traffic that default exists to prevent. A single catch-up
 *     flush runs when the tab becomes visible again.
 */

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSignalChangeStream } from './useSSE';

export interface SignalQueryBinding {
  /** Tesla signal field names (as emitted by the codec) that feed the query. */
  fields: readonly string[];
  /** Query key to invalidate when any of `fields` changes. */
  queryKey: readonly unknown[];
}

export interface UseSignalQueryInvalidationOptions {
  vehicleId?: number;
  bindings: readonly SignalQueryBinding[];
  enabled?: boolean;
  /** Minimum gap between two invalidations of the same binding. */
  throttleMs?: number;
}

const DEFAULT_THROTTLE_MS = 750;

export function useSignalQueryInvalidation({
  vehicleId,
  bindings,
  enabled = true,
  throttleMs = DEFAULT_THROTTLE_MS,
}: UseSignalQueryInvalidationOptions): void {
  const queryClient = useQueryClient();

  // Bindings are typically an inline array literal, so a fresh reference
  // arrives every render. Holding them in a ref keeps the effect below from
  // resubscribing on each render without forcing every caller to memoize.
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  const pendingRef = useRef<Set<number>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushRef = useRef<() => void>(() => {});
  flushRef.current = () => {
    timerRef.current = null;
    if (pendingRef.current.size === 0) return;
    // Hidden tabs keep receiving SSE but must not trigger network refetches;
    // the pending set is preserved so the visibility handler can catch up.
    if (typeof document !== 'undefined' && document.hidden) return;

    const indices = Array.from(pendingRef.current);
    pendingRef.current.clear();
    for (const i of indices) {
      const binding = bindingsRef.current[i];
      if (!binding) continue;
      void queryClient.invalidateQueries({ queryKey: binding.queryKey });
    }
  };

  useSignalChangeStream(
    (event) => {
      let matched = false;
      bindingsRef.current.forEach((binding, i) => {
        if (!binding.fields.includes(event.field)) return;
        pendingRef.current.add(i);
        matched = true;
      });
      if (!matched || timerRef.current != null) return;
      timerRef.current = setTimeout(() => flushRef.current(), throttleMs);
    },
    { enabled: enabled && vehicleId != null && vehicleId > 0, vehicleId },
  );

  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      flushRef.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [enabled]);

  useEffect(
    () => () => {
      if (timerRef.current != null) clearTimeout(timerRef.current);
      timerRef.current = null;
    },
    [],
  );
}
