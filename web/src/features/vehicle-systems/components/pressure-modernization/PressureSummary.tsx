import { useTranslation } from 'react-i18next';
import { type StatMetric } from '@/components/data-display';
import { VehicleOperationalBrief } from '../operationalbrief-all/VehicleOperationalBrief';
import { useCardPlacement } from '@/components/layout/layout-reference';
import { formatDateTime } from '@/lib/dateFormat';
import { PASCALS_PER_KPA, type UnitPref } from '@/lib/unitConversion';
import type { PressureSummary as Summary } from './pressureData';

export interface PressureSummaryProps {
  summary: Summary | null;
  lastUpdatedAt: string | null;
  units: UnitPref;
  precision: number;
  locale: string;
  latestLoading: boolean;
  historyLoading: boolean;
  retained: boolean;
}

/** A latest-state aggregate and a range-bound history timestamp are different
 * sources. Keep that distinction visible rather than dating the live readings
 * with the newest row in an arbitrarily selected historical window.
 */
export function PressureSummary({
  summary, lastUpdatedAt, units, precision, locale, latestLoading, historyLoading, retained,
}: PressureSummaryProps) {
  const { t } = useTranslation();
  const placement = useCardPlacement();
  const metrics: StatMetric[] = [
    {
      metricId: 'pressure',
      occurrenceId: 'tire-pressure-average',
      label: t('tirePressure.avgPressure', 'Avg pressure'),
      description: t('tirePressure.methodology.average', 'Arithmetic mean of the corners with a pressure reading. Missing corners are excluded.'),
      rawValue: summary ? summary.avg / PASCALS_PER_KPA : null,
      display: { precision, units: { pressure: units.pressure, locale } },
      context: latestLoading ? t('common.loading', 'Loading...') : undefined,
    },
    {
      metricId: 'pressure',
      occurrenceId: 'tire-pressure-minimum',
      label: t('tirePressure.minPressure', 'Min pressure'),
      description: t('tirePressure.methodology.minimum', 'Lowest reported corner pressure. Missing corners are excluded.'),
      rawValue: summary ? summary.min / PASCALS_PER_KPA : null,
      display: { precision, units: { pressure: units.pressure, locale } },
      context: latestLoading ? t('common.loading', 'Loading...') : undefined,
    },
    {
      metricId: 'count',
      occurrenceId: 'tire-pressure-warning-count',
      label: t('tirePressure.warningCount', 'Warning count'),
      description: t('tirePressure.methodology.warningCount', 'Reported corners outside the inclusive 250–350 kPa normal band. This is not a count of vehicle TPMS flags.'),
      rawValue: summary?.warningCount ?? null,
      context: latestLoading ? t('common.loading', 'Loading...')
        : summary ? t('tirePressure.reportedCorners', '{{count}} of 4 corners reported', { count: summary.reportedCount }) : undefined,
    },
    {
      metricId: 'text',
      occurrenceId: 'tire-pressure-range-last-updated',
      label: t('tirePressure.lastUpdated', 'Last updated'),
      description: t('tirePressure.methodology.lastUpdated', 'Newest history row in the selected window; not the observation time of the latest readings.'),
      rawValue: lastUpdatedAt ? formatDateTime(lastUpdatedAt) : null,
      context: historyLoading ? t('common.loading', 'Loading...') : t('tirePressure.pressureHistory', 'Pressure history'),
    },
  ];
  return (
    <div className={placement?.className}>
      <VehicleOperationalBrief
        id="tire-pressure-summary"
        title={t('tirePressure.kpis', 'Tire pressure summary')}
        metrics={metrics}
        period={{
          kind: 'snapshot',
          label: t('tirePressure.currentReadings', 'Current readings'),
          observedAt: null,
          provenance: t('dataSources.labels.liveTirePressure', 'Latest tire pressure'),
        }}
        preferences={{ units: { ...units, precision, locale }, currency: { kind: 'symbol', value: '' } }}
        // A loading latest query must not blank the independent history date.
        // Source-local loading captions above keep each missing value honest.
        loading={false}
        retained={retained}
      />
    </div>
  );
}
