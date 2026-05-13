/**
 * SignalStatsPanel — per-signal min/max/avg/count summary table.
 *
 * Tiny presentation-only wrapper around DataTable. Extracted so the
 * Workspace page and Explorer page render the same stat grid without
 * duplicating the column definitions.
 *
 * When `selectedSignals` is provided (Phase-51), the panel renders one
 * row per selected signal — including signals with no numeric samples
 * in the queried range, which surface a `—` placeholder + "no data"
 * subtitle. This keeps the panel honest: it stops silently dropping
 * selected signals that the chart and history table also have to
 * display. A "Hide empty rows" toggle lets users collapse those
 * placeholder rows once they've confirmed the data gap.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { GlassPanel, DataTable, Toggle, type Column } from '@/components/ui';
import { Skeleton } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { CHART_COLORS } from '@/lib/colors';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import type { SignalStat } from '../hooks/useLiveSignalStream';

export interface SignalStatsPanelProps {
  stats: SignalStat[];
  /**
   * If provided, the panel renders one row per selected signal —
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

function emptyStatRow(signal: string): SignalStat {
  return { signal, min: NaN, max: NaN, avg: NaN, count: 0 };
}

function isEmptyStat(s: SignalStat): boolean {
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

  // Compute the display rows: when `selectedSignals` is provided, emit
  // one row per selected signal (filling gaps with placeholder rows);
  // otherwise pass `stats` through unchanged.
  const displayStats = useMemo<SignalStat[]>(() => {
    if (!selectedSignals?.length) return stats;
    const byName = new Map(stats.map((s) => [s.signal, s]));
    return selectedSignals.map((sig) => byName.get(sig) ?? emptyStatRow(sig));
  }, [stats, selectedSignals]);

  const emptyCount = useMemo(
    () => displayStats.reduce((n, s) => (isEmptyStat(s) ? n + 1 : n), 0),
    [displayStats],
  );
  const visibleStats = useMemo(
    () => (hideEmpty ? displayStats.filter((s) => !isEmptyStat(s)) : displayStats),
    [displayStats, hideEmpty],
  );

  const renderNumeric = (n: number) =>
    Number.isNaN(n) || !Number.isFinite(n) ? (
      <span className="text-[var(--text-muted)]" aria-label="No data">
        —
      </span>
    ) : (
      <span className="font-mono text-[var(--text-secondary)]">{fmtNumber(n)}</span>
    );

  const columns: Column<SignalStat>[] = useMemo(() => [
    {
      key: 'signal',
      header: t('Signal'),
      render: (s) => {
        const idx = signalIndex?.[s.signal] ?? displayStats.indexOf(s);
        const color = CHART_COLORS[Math.max(0, idx) % CHART_COLORS.length];
        return (
          <div className="flex flex-col gap-0.5">
            <span className="font-mono font-semibold" style={{ color }}>
              {s.signal}
            </span>
            {isEmptyStat(s) && (
              <span className="text-[10px] text-[var(--text-muted)]">
                {t('signalStats.noDataInRange', 'No data in range')}
              </span>
            )}
          </div>
        );
      },
    },
    { key: 'min', header: t('Min'), render: (s) => renderNumeric(s.min) },
    { key: 'max', header: t('Max'), render: (s) => renderNumeric(s.max) },
    {
      key: 'avg',
      header: t('Avg'),
      render: (s) =>
        Number.isNaN(s.avg) || !Number.isFinite(s.avg) ? (
          <span className="text-[var(--text-muted)]">—</span>
        ) : (
          <span className="font-mono text-[var(--text-primary)]">{fmtNumber(s.avg)}</span>
        ),
    },
    {
      key: 'count',
      header: t('Count'),
      render: (s) => (
        <span className="font-mono text-[var(--text-muted)]">{fmtInt(s.count)}</span>
      ),
    },
  ], [displayStats, signalIndex, t]);

  return (
    <FadeIn>
      <GlassPanel className={cn('p-4 sm:p-5', className)}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="section-title">{title ?? t('Stats Summary')}</span>
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
          <span className="text-xs text-[var(--text-muted)]">{t('No stats available')}</span>
        )}
      </GlassPanel>
    </FadeIn>
  );
}
