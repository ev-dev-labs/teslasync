/**
 * SignalStatsPanel — per-signal min/max/avg/count summary table.
 *
 * Tiny presentation-only wrapper around DataTable. Extracted so the
 * Workspace page and Explorer page render the same stat grid without
 * duplicating the column definitions.
 *
 * When `selectedSignals` is provided, the panel renders one
 * row per selected signal — including signals with no numeric samples
 * in the queried range, which surface a `—` placeholder + "no data"
 * subtitle. This keeps the panel honest: it stops silently dropping
 * selected signals that the chart and history table also have to
 * display. A "Hide empty rows" toggle lets users collapse those
 * placeholder rows once they've confirmed the data gap.
 */

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { GlassPanel, DataTable, Toggle, SectionTitle, Caption, type Column } from '@/components/ui';
import { Skeleton } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { CHART_COLORS } from '@/lib/colors';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import type { SignalStat } from '../hooks/useLiveSignalStream';

export interface SignalStatsPanelProps {
  stats: SignalStat[];
  /**
   * If provided, the panel renders one row per selected signal
   * signals with no data show `—` placeholders and a "no data" hint.
   * When omitted (back-compat), only signals present in `stats` render.
   */
  selectedSignals?: string[];
  loading?: boolean;
  /** Override panel title. */
  title?: string;
  className?: string;
  /** Map signal -> color index. Defaults to position in `stats`. */
  signalIndex?: Record<string, number>;
}

/**
 * Placeholder row for a selected signal that produced no numeric samples in
 * the queried range. `count === 0` is what {@link isEmptyStat} keys off, and
 * the `NaN` aggregates render as `—` via the numeric cell renderer.
 */
export function emptyStatRow(signal: string): SignalStat {
  return { signal, min: NaN, max: NaN, avg: NaN, count: 0 };
}

/** A stat row is "empty" when it carries no samples (`count === 0`). */
export function isEmptyStat(s: SignalStat): boolean {
  return s.count === 0;
}

export function SignalStatsPanel({
  stats,
  selectedSignals,
  loading = false,
  title,
  className,
  signalIndex,
}: SignalStatsPanelProps) {
  const { t } = useTranslation();
  const [hideEmpty, setHideEmpty] = useState(false);

  // `stats` is typed as required, but callers thread `data?.stats` through
  // before their query resolves — guard so `.map`/`.reduce`/the colour lookup
  // never hit `undefined` and crash the whole rail.
  const safeStats = useMemo<SignalStat[]>(() => stats ?? [], [stats]);

  // Compute the display rows: when `selectedSignals` is provided, emit
  // one row per selected signal (filling gaps with placeholder rows);
  // otherwise pass `stats` through unchanged.
  const displayStats = useMemo<SignalStat[]>(() => {
    if (!selectedSignals?.length) return safeStats;
    const byName = new Map(safeStats.map((s) => [s.signal, s]));
    return selectedSignals.map((sig) => byName.get(sig) ?? emptyStatRow(sig));
  }, [safeStats, selectedSignals]);

  // Signal → position map for the default colour index, built once per row set
  // so the per-cell colour lookup stays O(1) instead of an O(n) indexOf scan.
  const positionIndex = useMemo(() => {
    const m = new Map<string, number>();
    displayStats.forEach((s, i) => {
      if (!m.has(s.signal)) m.set(s.signal, i);
    });
    return m;
  }, [displayStats]);

  const emptyCount = useMemo(
    () => displayStats.reduce((n, s) => (isEmptyStat(s) ? n + 1 : n), 0),
    [displayStats],
  );
  const visibleStats = useMemo(
    () => (hideEmpty ? displayStats.filter((s) => !isEmptyStat(s)) : displayStats),
    [displayStats, hideEmpty],
  );

  // One renderer for the min/max/avg columns: any non-finite value (incl. the
  // `NaN` placeholders) renders as `—`, labelled "No data" for screen readers
  // so the em-dash isn't announced as literal punctuation. Finite values go
  // through the shared locale formatter.
  const renderNumeric = useCallback(
    (n: number, valueClassName: string) =>
      Number.isFinite(n) ? (
        <span className={cn('font-mono', valueClassName)}>{fmtNumber(n)}</span>
      ) : (
        <span
          className="text-[var(--text-muted)]"
          aria-label={t('signalStats.noData', 'No data')}
        >
          —
        </span>
      ),
    [t],
  );

  const columns: Column<SignalStat>[] = useMemo(() => [
    {
      key: 'signal',
      header: t('Signal'),
      render: (s) => {
        const idx = signalIndex?.[s.signal] ?? positionIndex.get(s.signal) ?? 0;
        const color = CHART_COLORS[Math.max(0, idx) % CHART_COLORS.length];
        return (
          <div className="flex flex-col gap-0.5">
            <span className="font-mono font-semibold" style={{ color }}>
              {s.signal}
            </span>
            {isEmptyStat(s) && (
              <span className="text-2xs text-[var(--text-muted)]">
                {t('signalStats.noDataInRange', 'No data in range')}
              </span>
            )}
          </div>
        );
      },
    },
    { key: 'min', header: t('Min'), render: (s) => renderNumeric(s.min, 'text-[var(--text-secondary)]') },
    { key: 'max', header: t('Max'), render: (s) => renderNumeric(s.max, 'text-[var(--text-secondary)]') },
    { key: 'avg', header: t('Avg'), render: (s) => renderNumeric(s.avg, 'text-[var(--text-primary)]') },
    {
      key: 'count',
      header: t('Count'),
      render: (s) => (
        <span className="font-mono text-[var(--text-muted)]">{fmtInt(s.count)}</span>
      ),
    },
  ], [positionIndex, renderNumeric, signalIndex, t]);

  return (
    <FadeIn>
      <GlassPanel className={cn('p-4 sm:p-5', className)}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <SectionTitle>{title ?? t('Stats Summary')}</SectionTitle>
          {emptyCount > 0 && (
            <Toggle
              checked={hideEmpty}
              onChange={setHideEmpty}
              label={t('signalStats.hideEmpty', 'Hide empty ({{count}})', {
                count: emptyCount,
              })}
              size="sm"
            />
          )}
        </div>
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20" />)}
          </div>
        ) : visibleStats.length > 0 ? (
          <DataTable
            tableId="telemetry:signal-stats"
            columns={columns}
            data={visibleStats}
            keyExtractor={(s) => s.signal}
            compact
            pagination={{ defaultPageSize: 50 }}
          />
        ) : (
          <Caption>{t('No stats available')}</Caption>
        )}
      </GlassPanel>
    </FadeIn>
  );
}
