/**
 * SignalLogKpiBand — headline counters for a Signal Log query result.
 *
 * Presentation-only: consumes the `SignalLogSummary` computed by
 * `summarizeSignalLog` and renders a compact OperationalBrief with the
 * submitted window kept independent of the observed sample span.
 */

import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import type { StatMetric } from '@/components/data-display';
import { TelemetrySummaryBrief } from './operationalbrief-all/TelemetrySummaryBrief';
import { FadeIn } from '@/components/motion';

import type { SignalLogSummary } from './signalLogSummary';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export interface SignalLogKpiBandProps {
  summary: SignalLogSummary;
  loading?: boolean;
  /** A submitted query failed before any rows were retained; not an empty result. */
  unavailable?: boolean;
  hasQueried?: boolean;
  retained?: boolean;
  scope?: ReactNode;
}

/**
 * Render-safe fallback for an absent summary. Raw metrics still remain
 * missing rather than treating these internal placeholders as measurements.
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

export function SignalLogKpiBand({
  summary, loading = false, unavailable = false, hasQueried = true, retained = false, scope,
}: SignalLogKpiBandProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const s = summary ?? ZERO_SUMMARY;

  const valueAvailable = summary != null && hasQueried && !unavailable && (!loading || s.totalRecords > 0);
  const rawSpan = s.earliest == null || s.latest == null ? null
    : (Date.parse(s.latest) - Date.parse(s.earliest)) / 1000;
  const span = rawSpan != null && rawSpan < 0 ? NaN : rawSpan;
  const metrics: readonly StatMetric[] = [
    { metricId: 'count', occurrenceId: 'records', rawValue: valueAvailable ? s.totalRecords : null,
      label: t('signalLog.kpi.totalRecords', 'Total records'),
      display: { formatter: (raw) => ({ value: fmtInt(raw), unit: '' }) },
      description: t('telemetry.brief.loadedRows', 'Returned rows only; not a server-wide total or proof of complete time-window coverage.') },
    { metricId: 'count', occurrenceId: 'signals', rawValue: summary == null ? null : s.signalsSelected,
      label: t('signalLog.kpi.signals', 'Signals'),
      display: { formatter: (raw) => ({ value: fmtInt(raw), unit: '' }) },
      description: valueAvailable ? t('signalLog.kpi.signalsWithData', '{{count}} with data', { count: s.distinctSignals }) : '—' },
    ...([
      ['numeric', 'signalLog.kpi.numeric', 'Numeric points', s.numericPoints],
      ['text', 'signalLog.kpi.text', 'Text points', s.textPoints],
      ['boolean', 'signalLog.kpi.boolean', 'Boolean points', s.boolPoints],
    ] as const).map(([key, labelKey, label, raw]): StatMetric => ({
      metricId: 'count', occurrenceId: key, rawValue: valueAvailable ? raw : null,
      label: t(labelKey, label), display: { formatter: (value) => ({ value: fmtInt(value), unit: '' }) },
      description: t('telemetry.brief.loadedRows', 'Returned rows only; not a server-wide total or proof of complete time-window coverage.'),
    })),
    { metricId: 'duration', occurrenceId: 'span', rawValue: valueAvailable ? span : null,
      label: t('signalLog.kpi.timeSpan', 'Time span'),
      display: { formatter: () => ({ value: formatSpan(s.earliest, s.latest), unit: '' }) },
      description: t('telemetry.brief.observedSpan', 'Elapsed span between the earliest and latest returned samples; not the requested range.'),
      context: s.earliest && s.latest ? `${s.earliest} → ${s.latest}` : undefined },
  ];

  return (
    <FadeIn>
      <div>
        <TelemetrySummaryBrief title={t('signalLog.kpis', 'Query summary')}
          metrics={metrics} testId="signal-log-summary" loading={loading && s.totalRecords === 0}
          unavailable={unavailable} unknown={!hasQueried} retained={retained}
          scope={scope ?? t('telemetry.brief.unspecifiedQuery', 'Submitted query results · exact bounds not supplied')}
          provenance={t('signalLog.subtitle', 'Query signal history from Postgres')}
          description={t('telemetry.brief.loadedRows', 'Returned rows only; not a server-wide total or proof of complete time-window coverage.')} />
      </div>
    </FadeIn>
  );
}
