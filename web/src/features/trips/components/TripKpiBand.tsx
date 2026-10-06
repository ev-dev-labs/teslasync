import { useTranslation } from 'react-i18next';
import { deriveDataState, type DataState } from '@/api/dataState';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { TripOperationalBrief } from './operationalbrief-all/TripOperationalBrief';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { formatDurationSecondsAsMinutes } from '@/lib/dateFormat';

import type { TripDetail } from '@/api/types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface TripKpiBandProps {
  trip: TripDetail | undefined;
  isLoading: boolean;
  source?: DataState<TripDetail>;
}

/**
 * Clamp a KPI input to a safe, non-negative, finite number.
 *
 * The API types these totals as non-null `number`, but a malformed
 * upstream payload — a `NaN` from a bad division, a negative from clock
 * skew, an explicit `null` — must never leak "-5 km", "NaN", "-156 Wh/km"
 * (via the derived efficiency), or "-3 drives" into the summary band.
 * `?? 0` alone catches only null/undefined, so this guard is applied at
 * the display boundary. Every metric in this band has a non-negative
 * domain, so clamping is behaviour-preserving for all valid data.
 */
export function safeMetric(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

/**
 * Full-width KPI band for the Trip Detail page. Renders six null-safe
 * metrics that reflow from 2 columns on phones up to 6 on ultra-wide
 * displays. Efficiency is derived at the display boundary (Wh per the
 * user's distance unit) so no magic mile/km factor is needed.
 */
export function TripKpiBand({ trip, isLoading, source: suppliedSource }: TripKpiBandProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const { unitPrefs, formatEnergy } = useUnits();
  const { formatCurrency } = useFormatting();

  const source = suppliedSource ?? deriveDataState({ data: trip, isLoading }, { provenance: 'historical' });
  const distanceM = safeMetric(trip?.total_distance_m);
  const energyWh = safeMetric(trip?.total_energy_wh);
  const durationS = safeMetric(trip?.total_duration_s);
  const driveCount = safeMetric(trip?.drive_count);
  const chargeCount = safeMetric(trip?.charge_count);
  const cost = safeMetric(trip?.total_cost);

  const distanceDisplay = convertDistanceFromSI(distanceM, unitPrefs.distance);
  const efficiencyUnit = `Wh/${unitPrefs.distance}`;
  const efficiency = distanceDisplay > 0 ? energyWh / distanceDisplay : 0;
  const scope = trip
    ? t('trips.brief.detail.scope', 'Trip #{{id}} · {{start}} – {{end}}', {
      id: trip.id, start: trip.start_date, end: trip.end_date ?? t('trips.detail.inProgress', 'In progress'),
    })
    : t('trips.brief.detail.missingScope', 'Trip record unavailable; event bounds unknown.');
  const metrics: readonly StatMetric[] = [
    { metricId: 'distance', occurrenceId: 'distance', rawValue: trip?.total_distance_m != null ? distanceM : null,
      label: t('trips.detail.distance', 'Distance'), description: scope,
      display: { formatter: raw => ({ value: fmtInt(convertDistanceFromSI(raw, unitPrefs.distance)), unit: unitPrefs.distance }) },
      context: trip?.drive_count != null ? t('trips.detail.kpi.driveCount', '{{count}} drives', { count: driveCount }) : undefined },
    { metricId: 'energy', occurrenceId: 'energy', rawValue: trip?.total_energy_wh != null ? energyWh : null,
      label: t('trips.detail.energy', 'Energy Used'), description: scope,
      display: { formatter: raw => ({ value: formatEnergy(raw), unit: '' }) } },
    { metricId: 'efficiency', occurrenceId: 'efficiency', rawValue: trip?.total_energy_wh != null && distanceM > 0 ? energyWh / distanceM : null,
      label: t('trips.detail.efficiency', 'Efficiency'), description: scope,
      missingReason: t('trips.brief.detail.efficiencyReason', 'Efficiency requires a positive trip distance.'),
      display: { formatter: () => ({ value: fmtInt(efficiency), unit: efficiencyUnit }) } },
    { metricId: 'duration', occurrenceId: 'duration', rawValue: trip && durationS > 0 ? durationS : null,
      label: t('trips.detail.duration', 'Duration'), description: scope,
      display: { formatter: raw => ({ value: formatDurationSecondsAsMinutes(raw), unit: '' }) } },
    { metricId: 'count', occurrenceId: 'drives', rawValue: trip?.drive_count != null ? driveCount : null,
      label: t('trips.detail.drives', 'Drives'), description: scope,
      display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) },
      context: trip?.charge_count != null ? t('trips.detail.kpi.chargeCount', '{{count}} charges', { count: chargeCount }) : undefined },
    { metricId: 'currency', occurrenceId: 'cost', rawValue: trip?.total_cost != null ? cost : null,
      label: t('trips.detail.cost', 'Cost'), description: scope,
      display: { formatter: raw => ({ value: formatCurrency(raw), unit: '' }) } },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);
  return (
    <section aria-label={t('trips.detail.kpi.label', 'Trip summary metrics')}>
      <TripOperationalBrief source={source} loading={isLoading && !trip} metrics={operationalMetrics} scope={scope}
        eyebrow={t('trips.brief.detail.eyebrow', 'Trip record')}
        title={t('trips.brief.detail.title', 'Trip totals')}
        description={t('trips.brief.detail.description', 'Recorded trip totals, with distance-based efficiency and the original drive and charging counts.')}
        provenance={t('trips.brief.detail.provenance', 'Stored trip detail; malformed non-negative totals retain the existing zero-clamp display policy.')} />
    </section>
  );
}
