/**
 * SignalLogKpiBand — headline counters for a Signal Log query result.
 *
 * Presentation-only: consumes the `SignalLogSummary` computed by
 * `summarizeSignalLog` and renders a full-width, responsive MetricCard
 * grid (2 cols on phone → 3 on tablet → 6 on wide desktop). Shows honest
 * zero/placeholder values before a query runs and Skeletons while the
 * first batch is loading.
 */

import { useTranslation } from 'react-i18next';
import { Database, Layers, Hash, Type, ToggleRight, Clock } from 'lucide-react';

import { MetricCard } from '@/components/data-display';
import { Skeleton } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { fmtInt } from '@/lib/numberFormat';
import type { SignalLogSummary } from './signalLogSummary';

export interface SignalLogKpiBandProps {
  summary: SignalLogSummary;
  loading?: boolean;
}

/**
 * All-zero fallback. Used when a caller renders the band before
 * `summarizeSignalLog` has produced a summary (or passes it as `undefined`
 * across an async boundary) so the band degrades to an honest zero grid
 * instead of throwing on `summary.totalRecords` / `formatSpan(...)`.
 */
const ZERO_SUMMARY: SignalLogSummary = {
  totalRecords: 0,
  signalsSelected: 0,
  distinctSignals: 0,
  numericPoints: 0,
  textPoints: 0,
  boolPoints: 0,
  earliest: null,
  latest: null,
};

/** Human-friendly duration between the oldest and newest sample. */
function formatSpan(earliest: string | null, latest: string | null): string {
  if (!earliest || !latest) return '—';
  const a = new Date(earliest).getTime();
  const b = new Date(latest).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return '—';
  const totalSec = Math.round((b - a) / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  if (hr < 24) return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`;
  const day = Math.floor(hr / 24);
  const remHr = hr % 24;
  return remHr > 0 ? `${day}d ${remHr}h` : `${day}d`;
}

export function SignalLogKpiBand({ summary, loading = false }: SignalLogKpiBandProps) {
  const { t } = useTranslation();
  const s = summary ?? ZERO_SUMMARY;

  const gridClass =
    'grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-6';

  if (loading && s.totalRecords === 0) {
    return (
      <FadeIn>
        <section aria-label={t('signalLog.kpis', 'Query summary')} className={gridClass}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-[74px] rounded-xl" />
          ))}
        </section>
      </FadeIn>
    );
  }

  return (
    <FadeIn>
      <section aria-label={t('signalLog.kpis', 'Query summary')} className={gridClass}>
        <MetricCard
          label={t('signalLog.kpi.totalRecords', 'Total Records')}
          value={fmtInt(s.totalRecords)}
          icon={<Database className="h-5 w-5" aria-hidden="true" />}
          color="cyan"
        />
        <MetricCard
          label={t('signalLog.kpi.signals', 'Signals')}
          value={fmtInt(s.signalsSelected)}
          subtitle={t('signalLog.kpi.signalsWithData', '{{count}} with data', {
            count: s.distinctSignals,
          })}
          icon={<Layers className="h-5 w-5" aria-hidden="true" />}
          color="blue"
        />
        <MetricCard
          label={t('signalLog.kpi.numeric', 'Numeric Points')}
          value={fmtInt(s.numericPoints)}
          icon={<Hash className="h-5 w-5" aria-hidden="true" />}
          color="green"
        />
        <MetricCard
          label={t('signalLog.kpi.text', 'Text Points')}
          value={fmtInt(s.textPoints)}
          icon={<Type className="h-5 w-5" aria-hidden="true" />}
          color="amber"
        />
        <MetricCard
          label={t('signalLog.kpi.boolean', 'Boolean Points')}
          value={fmtInt(s.boolPoints)}
          icon={<ToggleRight className="h-5 w-5" aria-hidden="true" />}
          color="purple"
        />
        <MetricCard
          label={t('signalLog.kpi.timeSpan', 'Time Span')}
          value={formatSpan(s.earliest, s.latest)}
          icon={<Clock className="h-5 w-5" aria-hidden="true" />}
          color="blue"
        />
      </section>
    </FadeIn>
  );
}
