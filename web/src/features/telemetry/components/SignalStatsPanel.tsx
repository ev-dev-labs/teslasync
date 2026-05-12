/**
 * SignalStatsPanel — per-signal min/max/avg/count summary table.
 *
 * Tiny presentation-only wrapper around DataTable. Extracted so the
 * Workspace page and Explorer page render the same stat grid without
 * duplicating the column definitions.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { GlassPanel, DataTable, type Column } from '@/components/ui';
import { Skeleton } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { CHART_COLORS } from '@/lib/colors';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import type { SignalStat } from '../hooks/useLiveSignalStream';

export interface SignalStatsPanelProps {
  stats: SignalStat[];
  loading?: boolean;
  /** Override panel title. */
  title?: string;
  className?: string;
  /** Map signal -> color index. Defaults to position in `stats`. */
  signalIndex?: Record<string, number>;
}

export function SignalStatsPanel({
  stats,
  loading = false,
  title,
  className,
  signalIndex,
}: SignalStatsPanelProps) {
  const { t } = useTranslation();

  const columns: Column<SignalStat>[] = useMemo(() => [
    {
      key: 'signal',
      header: t('Signal'),
      render: (s) => {
        const idx = signalIndex?.[s.signal] ?? stats.indexOf(s);
        return (
          <span className="font-mono font-semibold" style={{ color: CHART_COLORS[idx % CHART_COLORS.length] }}>
            {s.signal}
          </span>
        );
      },
    },
    { key: 'min',   header: t('Min'),   render: (s) => <span className="font-mono text-[var(--text-secondary)]">{fmtNumber(s.min)}</span> },
    { key: 'max',   header: t('Max'),   render: (s) => <span className="font-mono text-[var(--text-secondary)]">{fmtNumber(s.max)}</span> },
    { key: 'avg',   header: t('Avg'),   render: (s) => <span className="font-mono text-[var(--text-primary)]">{fmtNumber(s.avg)}</span> },
    { key: 'count', header: t('Count'), render: (s) => <span className="font-mono text-[var(--text-muted)]">{fmtInt(s.count)}</span> },
  ], [stats, signalIndex, t]);

  return (
    <FadeIn>
      <GlassPanel className={cn('p-4 sm:p-5', className)}>
        <span className="section-title mb-3 block">{title ?? t('Stats Summary')}</span>
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20" />)}
          </div>
        ) : stats.length > 0 ? (
          <DataTable
            tableId="telemetry:signal-stats"
            columns={columns}
            data={stats}
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
