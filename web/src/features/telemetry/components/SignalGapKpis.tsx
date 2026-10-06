/**
 * SignalGapKpis — the full-width KPI band for the Signal Gap Detector.
 *
 * Six source-backed metrics summarise the vehicle's signal timestamps: the total
 * catalog size, the three staleness buckets, the never-received count, and an
 * overall freshness score. Values collapse to "—" until a vehicle is chosen.
 */

import { useTranslation } from 'react-i18next';
import type { StatMetric } from '@/components/data-display';
import { TelemetrySummaryBrief } from './operationalbrief-all/TelemetrySummaryBrief';
import { FadeIn } from '@/components/motion';

import type { GapBuckets } from '../signalGapUtils';

interface SignalGapKpisProps {
  buckets: GapBuckets;
  freshnessPct: number;
  hasVehicle: boolean;
  unavailable?: boolean;
  loading?: boolean;
  retained?: boolean;
}

/** All-zero buckets — the render-safe fallback before an analysis exists. */
const EMPTY_BUCKETS: GapBuckets = { total: 0, active: 0, aging: 0, stale: 0, never: 0 };

export function SignalGapKpis({
  buckets, freshnessPct, hasVehicle, unavailable = false, loading = false, retained = false,
}: SignalGapKpisProps) {
  const { t } = useTranslation();

  // Null-safe reads: the page always derives a real buckets object, but a
  // caller mid-load (or a stubbed test) can hand us `undefined`. Collapse to a
  // zeroed shape so the band renders '—'/0 instead of throwing on `.total`.
  const b = buckets ?? EMPTY_BUCKETS;
  const available = hasVehicle && !unavailable && buckets != null;
  const description = t('telemetryBrief.gapDescription', 'Timestamp age buckets from the current signal query; a sleeping vehicle can be stale without being unhealthy.');
  const metrics: readonly StatMetric[] = [
    ...([
      ['total', 'signalGap.totalSignals', 'Total signals', b.total],
      ['active', 'signalGap.active', 'Active (<30s)', b.active],
      ['aging', 'signalGap.aging', 'Aging (<5min)', b.aging],
      ['stale', 'signalGap.stale', 'Stale (>5min)', b.stale],
      ['never', 'signalGap.neverReceived', 'Never received', b.never],
    ] as const).map(([key, labelKey, label, raw]): StatMetric => ({
      metricId: 'count', occurrenceId: key, rawValue: available ? raw : null,
      label: t(labelKey, label), description,
    })),
    { metricId: 'percent', occurrenceId: 'freshness', rawValue: available ? freshnessPct : null,
      label: t('signalGap.freshness', 'Freshness'),
      display: { formatter: (raw) => ({ value: `${raw}%`, unit: '' }) },
      description: t('telemetryBrief.freshnessDenominator', 'Existing share of active plus aging signals across the whole queried catalog; never-received signals remain in the denominator.'),
      context: available ? t('signalGap.receivingSummary', '{{receiving}} of {{total}} signals arriving', {
        receiving: b.active + b.aging, total: b.total,
      }) : undefined },
  ];

  return (
    <FadeIn>
      <div>
        <TelemetrySummaryBrief title={t('signalGap.kpis', 'Signal health summary')}
          metrics={metrics} testId="signal-gap-summary" loading={loading}
          unavailable={unavailable && !loading} unknown={!hasVehicle} retained={retained}
          scope={t('telemetryBrief.gapScope', 'Selected vehicle · queried catalog timestamp ages')}
          provenance={t('telemetryBrief.gapProvenance', 'Current signal values and their reported timestamps')}
          description={description} />
      </div>
    </FadeIn>
  );
}
