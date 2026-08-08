/**
 * SignalDiffBreakdown — aggregate "change analysis" bento for the Signal Diff
 * page. Complements the row-level `SignalDiffTable` with three at-a-glance
 * panels derived purely from the already-fetched diff rows (no extra hooks):
 *
 *   1. Change by category — how the changed signals distribute across the
 *      shared `CATEGORY_PREFIXES` buckets (Battery / Drive / Climate / …).
 *   2. Source layers — where the *current* window's value came from
 *      (L1 in-process / L2 Redis / LOG history / STALE), so an incident
 *      responder can tell live values from replays at a glance.
 *   3. Pinned signals — the signals the user is tracking across snapshots.
 *
 * Each panel owns its loading / empty / error state so a slow or failed diff
 * never blanks the whole section.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Layers, Database, Pin } from 'lucide-react';

import { GlassPanel, PanelTitle, Badge, Text } from '@/components/ui';
import { MetricBar } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { chartTokens } from '@/lib/tokens';
import { cn } from '@/lib/cn';
import type { SignalDiffRow } from '@/api/hooks/useTelemetry';

import { CATEGORY_PREFIXES } from './SignalCompareControls';

/** Current-window source layers, in reporting order, with a display color. */
const SOURCE_META: Array<{ id: string; labelKey: string; defaultLabel: string; color: string }> = [
  { id: 'l1', labelKey: 'signalDiff.source.l1', defaultLabel: 'L1 · In-process', color: '#10b981' },
  { id: 'l2', labelKey: 'signalDiff.source.l2', defaultLabel: 'L2 · Redis', color: '#3b82f6' },
  { id: 'log', labelKey: 'signalDiff.source.log', defaultLabel: 'LOG · History', color: '#8b5cf6' },
  { id: 'stale', labelKey: 'signalDiff.source.stale', defaultLabel: 'STALE', color: '#f59e0b' },
  { id: 'unknown', labelKey: 'signalDiff.source.unknown', defaultLabel: 'Unknown', color: '#64748b' },
];

export interface SignalDiffBreakdownProps {
  /** The filtered diff rows currently shown in the table. */
  rows: SignalDiffRow[];
  /** True while the initial diff is loading (no data yet). */
  loading?: boolean;
  /** Diff query error, if any. */
  error?: unknown;
  /** Retry callback wired into each panel's `QueryError`. */
  onRetry?: () => void;
  /**
   * True when `rows` is scoped by an active signal-name or category filter
   * upstream. Paired with `onClearFilters` — when both are supplied and a
   * panel is empty, the empty state offers a "Clear filters" CTA instead of
   * a dead end (the filter, not a lack of changes, is what emptied it).
   */
  filterActive?: boolean;
  /** Clears the upstream signal-name/category filter. */
  onClearFilters?: () => void;
  /** Signals the user has pinned, for the third panel. */
  pinnedSignals: Set<string>;
  className?: string;
}

function pct(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

/** Stable empty-set fallback so a missing `pinnedSignals` prop never crashes
 *  `Array.from(...)` and doesn't churn the `pinned` memo across renders. */
const EMPTY_PINNED: ReadonlySet<string> = new Set();

export function SignalDiffBreakdown({
  rows,
  loading,
  error,
  onRetry,
  filterActive,
  onClearFilters,
  pinnedSignals,
  className,
}: SignalDiffBreakdownProps) {
  const { t } = useTranslation();

  // Null-safety: `rows`/`pinnedSignals` come straight from live query +
  // user state upstream; a slow, failed, or not-yet-initialised source can
  // hand us `undefined` instead of an empty array/set. Normalise once so the
  // derives below can iterate freely (`.length`/`.filter`/`Array.from`)
  // without a guard at every call site — and so a bad prop degrades to the
  // empty states rather than blanking the whole section with a crash.
  const safeRows = rows ?? [];
  const safePinned = pinnedSignals ?? EMPTY_PINNED;
  const total = safeRows.length;

  const categoryRows = useMemo(
    () =>
      CATEGORY_PREFIXES.map((c) => ({
        id: c.id,
        label: t(c.labelKey, c.defaultLabel),
        count: safeRows.filter((r) => c.matches(r.name ?? '')).length,
      }))
        .filter((c) => c.count > 0)
        .sort((a, b) => b.count - a.count),
    [safeRows, t],
  );

  const sourceRows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of safeRows) {
      const key = (r.source_b ?? 'unknown').toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return SOURCE_META.map((s) => ({ ...s, count: counts.get(s.id) ?? 0 })).filter((s) => s.count > 0);
  }, [safeRows]);

  const pinned = useMemo(() => Array.from(safePinned).sort(), [safePinned]);

  return (
    <section
      aria-label={t('signalDiff.breakdown.title', 'Change analysis')}
      className={cn('grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3', className)}
    >
      {/* 1 — Change by category */}
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-3 flex items-center gap-2">
          <Layers className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('signalDiff.breakdown.categoryTitle', 'Change by category')}
        </PanelTitle>
        {error ? (
          <QueryError error={error} onRetry={onRetry} />
        ) : loading ? (
          <Skeleton height={180} />
        ) : categoryRows.length === 0 ? (
          <EmptyState
            icon={<Layers className="h-8 w-8" aria-hidden="true" />}
            message={t('signalDiff.breakdown.categoryEmpty', 'No categorized changes to summarize')}
            action={
              filterActive && onClearFilters
                ? { label: t('signalDiff.breakdown.clearFilters', 'Clear filters'), onClick: onClearFilters }
                : undefined
            }
          />
        ) : (
          <div className="space-y-3">
            {categoryRows.map((c, i) => (
              <MetricBar
                key={c.id}
                label={c.label}
                value={c.count}
                max={total || c.count}
                color={chartTokens.series[i % chartTokens.series.length]}
                sublabel={`${c.count} (${pct(c.count, total)}%)`}
              />
            ))}
          </div>
        )}
      </GlassPanel>

      {/* 2 — Source layers (current window) */}
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-3 flex items-center gap-2">
          <Database className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('signalDiff.breakdown.sourceTitle', 'Source layers')}
        </PanelTitle>
        {error ? (
          <QueryError error={error} onRetry={onRetry} />
        ) : loading ? (
          <Skeleton height={180} />
        ) : sourceRows.length === 0 ? (
          <EmptyState
            icon={<Database className="h-8 w-8" aria-hidden="true" />}
            message={t('signalDiff.breakdown.sourceEmpty', 'No source-layer data yet')}
            action={
              filterActive && onClearFilters
                ? { label: t('signalDiff.breakdown.clearFilters', 'Clear filters'), onClick: onClearFilters }
                : undefined
            }
          />
        ) : (
          <div className="space-y-3">
            {sourceRows.map((s) => (
              <MetricBar
                key={s.id}
                label={t(s.labelKey, s.defaultLabel)}
                value={s.count}
                max={total || s.count}
                color={s.color}
                sublabel={`${s.count} (${pct(s.count, total)}%)`}
              />
            ))}
          </div>
        )}
      </GlassPanel>

      {/* 3 — Pinned signals */}
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-3 flex items-center gap-2">
          <Pin className="h-4 w-4 text-amber-300" aria-hidden="true" />
          {t('signalDiff.breakdown.pinnedTitle', 'Pinned signals')}
        </PanelTitle>
        {pinned.length === 0 ? (
          // no-action: pinning happens per-row in the diff table below; unrelated to the name/category filter this panel would otherwise clear.
          <EmptyState
            icon={<Pin className="h-8 w-8" aria-hidden="true" />}
            message={t('signalDiff.breakdown.pinnedEmpty', 'No pinned signals — pin a row to track it here')}
          />
        ) : (
          <div className="space-y-3">
            <Text as="p" variant="caption">
              {t('signalDiff.breakdown.pinnedCount', '{{count}} pinned', { count: pinned.length })}
            </Text>
            <div className="flex flex-wrap gap-1.5">
              {pinned.map((s) => (
                <Badge key={s} variant="neutral">
                  {s}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </GlassPanel>
    </section>
  );
}
