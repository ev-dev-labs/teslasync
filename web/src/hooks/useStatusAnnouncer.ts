/**
 * Governed status announcer (A11Y-05).
 *
 * One place for every "something meaningful just happened" live-region
 * message in the app. Call sites get semantic helpers
 * (`announceLoaded`, `announceSaved`, `announceStreamState`, …) instead
 * of hand-rolling `announce(t('...'))`, which means:
 *
 * - **Wording stays consistent.** "Loaded 42 drives" reads the same on
 *   every page instead of drifting into "42 drives", "Drives ready",
 *   "Done".
 * - **Chatter is impossible by construction.** Each helper routes
 *   through {@link decideAnnouncement} with a channel key, so a
 *   telemetry stream that ticks 40×/s speaks at most once every 10 s,
 *   and identical errors from sibling panels collapse into one.
 * - **Priority is decided by semantics, not by the caller's mood.**
 *   Failures interrupt (`assertive`); everything else waits
 *   (`polite`).
 *
 * The underlying live regions are the ones rendered by
 * `<AnnouncerRegion>` (mounted once in `Layout.tsx`). Nothing here
 * renders DOM.
 *
 * @see web/src/lib/announcePolicy.ts for the governance rules.
 * @see web/src/hooks/useAnnouncer.ts for the raw, ungoverned pipe.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { announce, type AnnouncerPriority } from './useAnnouncer';
import {
  commitDeferredAnnouncement,
  decideAnnouncement,
  STREAM_DEDUPE_WINDOW_MS,
  STREAM_MIN_INTERVAL_MS,
  type AnnounceGovernanceOptions,
} from '@/lib/announcePolicy';

/** Connection states a live data stream can report. */
export type StreamAnnounceState =
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'updated';

export interface BulkOutcome {
  /** Verb describing what ran, already translated (e.g. "Archived"). */
  action: string;
  succeeded: number;
  failed?: number;
}

/**
 * Pending trailing emits, keyed by channel. A deferred announcement
 * keeps only the LATEST text for its channel, so a burst collapses to
 * a single spoken sentence carrying the final value.
 */
const pending = new Map<string, { text: string; priority: AnnouncerPriority; timer: number }>();

function emitGoverned(
  text: string,
  priority: AnnouncerPriority,
  options: AnnounceGovernanceOptions,
): void {
  const decision = decideAnnouncement(text, options, Date.now());
  if (decision.kind === 'drop') return;
  if (decision.kind === 'speak') {
    announce(text, priority);
    return;
  }

  // Deferred: replace whatever text is queued for this channel so the
  // user hears the newest value, not a stale one from the burst.
  const existing = pending.get(options.key);
  if (existing) {
    window.clearTimeout(existing.timer);
  }
  const timer = window.setTimeout(() => {
    const queued = pending.get(options.key);
    pending.delete(options.key);
    if (!queued) return;
    commitDeferredAnnouncement(options.key, queued.text, Date.now());
    announce(queued.text, queued.priority);
  }, decision.delayMs);
  pending.set(options.key, { text, priority, timer });
}

/**
 * Semantic, governed announcement helpers.
 *
 * The returned object is referentially stable, so it is safe to list
 * in `useEffect` / `useCallback` dependency arrays.
 */
export function useStatusAnnouncer() {
  const { t } = useTranslation();

  const announceLoaded = useCallback(
    (label: string, count?: number) => {
      const text =
        count == null
          ? t('a11y.status.loaded', '{{label}} loaded', { label })
          : t('a11y.status.loadedCount', '{{label}} loaded, {{count}} items', {
              label,
              count,
            });
      emitGoverned(text, 'polite', { key: `loaded:${label}` });
    },
    [t],
  );

  const announceEmpty = useCallback(
    (label: string) => {
      emitGoverned(
        t('a11y.status.empty', 'No {{label}} to show', { label }),
        'polite',
        { key: `loaded:${label}` },
      );
    },
    [t],
  );

  const announceRefreshError = useCallback(
    (label: string) => {
      emitGoverned(
        t('a11y.status.refreshError', 'Could not refresh {{label}}', { label }),
        'assertive',
        { key: `refresh-error:${label}` },
      );
    },
    [t],
  );

  const announceSaved = useCallback(
    (label: string) => {
      emitGoverned(
        t('a11y.status.saved', '{{label}} saved', { label }),
        'polite',
        { key: `saved:${label}` },
      );
    },
    [t],
  );

  const announceSaveError = useCallback(
    (label: string) => {
      emitGoverned(
        t('a11y.status.saveError', 'Could not save {{label}}', { label }),
        'assertive',
        { key: `save-error:${label}` },
      );
    },
    [t],
  );

  const announceBulkOutcome = useCallback(
    ({ action, succeeded, failed = 0 }: BulkOutcome) => {
      const text =
        failed > 0
          ? t(
              'a11y.status.bulkPartial',
              '{{action}}: {{succeeded}} succeeded, {{failed}} failed',
              { action, succeeded, failed },
            )
          : t('a11y.status.bulkDone', '{{action}}: {{succeeded}} items', {
              action,
              succeeded,
            });
      emitGoverned(text, failed > 0 ? 'assertive' : 'polite', {
        key: `bulk:${action}`,
      });
    },
    [t],
  );

  const announceSelection = useCallback(
    (selectedCount: number, totalCount: number) => {
      const text =
        selectedCount === 0
          ? t('a11y.status.selectionCleared', 'Selection cleared')
          : t(
              'a11y.status.selectionCount',
              '{{selectedCount}} of {{totalCount}} rows selected',
              { selectedCount, totalCount },
            );
      emitGoverned(text, 'polite', { key: 'selection' });
    },
    [t],
  );

  const announceSort = useCallback(
    (columnLabel: string, direction: 'asc' | 'desc') => {
      const text =
        direction === 'asc'
          ? t('a11y.status.sortAsc', 'Sorted by {{column}}, ascending', {
              column: columnLabel,
            })
          : t('a11y.status.sortDesc', 'Sorted by {{column}}, descending', {
              column: columnLabel,
            });
      emitGoverned(text, 'polite', { key: 'sort' });
    },
    [t],
  );

  const announceStreamState = useCallback(
    (state: StreamAnnounceState, label?: string) => {
      const scope = label ?? t('a11y.status.streamScope', 'Live data');
      const text =
        state === 'connected'
          ? t('a11y.status.streamConnected', '{{scope}} connected', { scope })
          : state === 'reconnecting'
            ? t('a11y.status.streamReconnecting', '{{scope}} reconnecting', { scope })
            : state === 'disconnected'
              ? t('a11y.status.streamDisconnected', '{{scope}} disconnected', { scope })
              : t('a11y.status.streamUpdated', '{{scope}} updated', { scope });
      emitGoverned(text, state === 'disconnected' ? 'assertive' : 'polite', {
        key: `stream:${scope}`,
        minIntervalMs: STREAM_MIN_INTERVAL_MS,
        dedupeWindowMs: STREAM_DEDUPE_WINDOW_MS,
      });
    },
    [t],
  );

  return useMemo(
    () => ({
      announceLoaded,
      announceEmpty,
      announceRefreshError,
      announceSaved,
      announceSaveError,
      announceBulkOutcome,
      announceSelection,
      announceSort,
      announceStreamState,
    }),
    [
      announceLoaded,
      announceEmpty,
      announceRefreshError,
      announceSaved,
      announceSaveError,
      announceBulkOutcome,
      announceSelection,
      announceSort,
      announceStreamState,
    ],
  );
}

export interface LoadAnnouncementOptions {
  /** Human label for the dataset, already translated. */
  label: string;
  isLoading: boolean;
  isError?: boolean;
  /** Row count once loaded. Omit for non-collection resources. */
  count?: number;
  /**
   * Set false to silence the announcement (e.g. a panel that is not
   * currently visible). Defaults to true.
   */
  enabled?: boolean;
}

/**
 * Announce once when a query finishes loading, and once when a refresh
 * fails.
 *
 * Fires ONLY on the loading → settled edge. Background refetches that
 * never flip `isLoading` stay silent, which is what makes this safe to
 * mount on pages with `refetchInterval`.
 *
 * @example
 *   const { data, isLoading, isError } = useDrives(vehicleId);
 *   useLoadAnnouncement({
 *     label: t('drives.title', 'Drives'),
 *     isLoading,
 *     isError,
 *     count: data?.length,
 *   });
 */
export function useLoadAnnouncement({
  label,
  isLoading,
  isError = false,
  count,
  enabled = true,
}: LoadAnnouncementOptions): void {
  const { announceLoaded, announceEmpty, announceRefreshError } = useStatusAnnouncer();
  const wasLoading = useRef(isLoading);

  useEffect(() => {
    if (!enabled) {
      wasLoading.current = isLoading;
      return;
    }
    // Only the falling edge of `isLoading` is an event worth speaking.
    if (wasLoading.current && !isLoading) {
      if (isError) {
        announceRefreshError(label);
      } else if (count === 0) {
        announceEmpty(label);
      } else {
        announceLoaded(label, count);
      }
    }
    wasLoading.current = isLoading;
  }, [
    enabled,
    isLoading,
    isError,
    count,
    label,
    announceLoaded,
    announceEmpty,
    announceRefreshError,
  ]);
}

/**
 * Test-only. Cancels every pending trailing emit so a test that
 * triggered a deferred announcement cannot leak a timer into the next
 * test.
 */
export function __resetStatusAnnouncerForTests(): void {
  for (const entry of pending.values()) {
    window.clearTimeout(entry.timer);
  }
  pending.clear();
}
