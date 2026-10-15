/**
 * Driving & charging summary — aggregate usage evidence (distance,
 * duration, efficiency, regen, CO2 saved, driving score, session counts,
 * energy added, fast-charge ratio, peak power, cost). All physical
 * quantities are SI on the evidence object (meters, seconds, watt-hours,
 * watts); `useUnits()` is the only place unit conversion happens.
 *
 * `avg_efficiency_wh_per_km` is the one field that is a compound ratio
 * (Wh per kilometer) rather than a plain SI scalar — converting its
 * distance denominator to the user's preferred unit requires an explicit
 * `convertDistanceToSI` lookup (meters per 1 display-unit) rather than
 * reusing `formatDistance`/`formatEnergy` directly, since neither
 * formatter alone understands a per-distance compound unit.
 */
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui';
import { LayoutCard } from '@/components/layout';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { VaultSummaryBrief } from './operationalbrief-all/VaultSummaryBrief';
import type { VaultEvidenceSource } from '../hooks/useVaultEvidence';
import { EmptyState, InlineCallout } from '@/components/feedback';
import { Info } from 'lucide-react';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceToSI } from '@/lib/unitConversion';
import type { ChargingHistoryEvidence, DrivingHistoryEvidence } from '../lib/types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export interface DrivingChargingSummaryPanelProps {
  driving: DrivingHistoryEvidence | null;
  charging: ChargingHistoryEvidence | null;
  sources?: readonly VaultEvidenceSource[];
}

export function DrivingChargingSummaryPanel({ driving, charging, sources }: DrivingChargingSummaryPanelProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { unitPrefs, formatDistance, formatDuration, formatEnergy, formatPower } = useUnits();

  const formatEfficiency = (whPerKm: number | null): string => {
    if (whPerKm == null) return '—';
    const metersPerDisplayUnit = convertDistanceToSI(1, unitPrefs.distance);
    const whPerDisplayUnit = whPerKm * (metersPerDisplayUnit / 1000);
    return `${formatEnergy(whPerDisplayUnit)}/${unitPrefs.distance}`;
  };
  const description = t('resaleVault.brief.usage.description', 'Recent observed records; aggregates and returned record counts may cover different windows.');
  const drivingMetrics: readonly StatMetric[] = [
    { metricId: 'count', occurrenceId: 'drives', label: t('resaleVault.usage.drives', 'Drives observed'), rawValue: driving?.observed_drive_count, description, display: { notation: 'source' } },
    { metricId: 'distance', occurrenceId: 'distance', label: t('resaleVault.usage.distance', 'Total distance'), rawValue: driving?.total_distance_m, description, display: { formatter: (raw) => ({ value: formatDistance(raw), unit: '' }) } },
    { metricId: 'duration', occurrenceId: 'duration', label: t('resaleVault.usage.duration', 'Total duration'), rawValue: driving?.total_duration_s, description, display: { formatter: (raw) => ({ value: formatDuration(raw), unit: '' }) } },
    { metricId: 'efficiency', occurrenceId: 'efficiency', label: t('resaleVault.usage.efficiency', 'Avg. efficiency'), rawValue: driving?.avg_efficiency_wh_per_km != null ? driving.avg_efficiency_wh_per_km / 1000 : null, description, display: { formatter: (raw) => ({ value: formatEfficiency(raw * 1000), unit: '' }) } },
    { metricId: 'percent', occurrenceId: 'regen', label: t('resaleVault.usage.regen', 'Regen ratio'), rawValue: driving?.regen_ratio != null ? driving.regen_ratio * 100 : null, description },
    { metricId: 'mass', occurrenceId: 'co2', label: t('resaleVault.usage.co2', 'CO2 saved'), rawValue: driving?.co2_saved_kg, description },
  ];
  const chargingMetrics: readonly StatMetric[] = [
    { metricId: 'count', occurrenceId: 'sessions', label: t('resaleVault.usage.sessions', 'Sessions observed'), rawValue: charging?.observed_session_count, description, display: { notation: 'source' } },
    { metricId: 'energy', occurrenceId: 'energy-added', label: t('resaleVault.usage.energyAdded', 'Total energy added'), rawValue: charging?.total_energy_added_wh, description, display: { formatter: (raw) => ({ value: formatEnergy(raw), unit: '' }) } },
    { metricId: 'count', occurrenceId: 'fast-charge-sessions', label: t('resaleVault.usage.fastCharge', 'Fast-charge sessions'), rawValue: charging?.fast_charge_session_count, description, display: { notation: 'source' } },
    { metricId: 'power', occurrenceId: 'peak-power', label: t('resaleVault.usage.peakPower', 'Avg. peak power'), rawValue: charging?.avg_peak_power_w, description, display: { formatter: (raw) => ({ value: formatPower(raw), unit: '' }) } },
    { metricId: 'currency', occurrenceId: 'cost', label: t('resaleVault.usage.cost', 'Total cost'), rawValue: charging?.total_cost,
      description: t('resaleVault.brief.cost.description', 'Recorded cost; the source does not supply a currency denomination. No currency conversion is applied.'),
      display: { formatter: (raw) => ({ value: fmtNumber(raw), unit: '' }) } },
  ];

  return (
    <LayoutCard title={t('resaleVault.usage.title', 'Driving & charging history')}>
      <VaultSummaryBrief id="driving" title={t('resaleVault.usage.driving', 'Driving')}
        description={description} metrics={drivingMetrics} hasEvidence={driving != null}
        sources={sources?.filter((source) => source.section === 'driving_history')}
        scope={t('resaleVault.brief.window', 'Observed evidence: {{start}} → {{end}}', {
          start: driving?.earliest_drive_at ?? '—', end: driving?.latest_drive_at ?? '—',
        })} />
      <VaultSummaryBrief id="charging" title={t('resaleVault.usage.charging', 'Charging')}
        description={description} metrics={chargingMetrics} hasEvidence={charging != null}
        sources={sources?.filter((source) => source.section === 'charging_history')}
        scope={t('resaleVault.brief.window', 'Observed evidence: {{start}} → {{end}}', {
          start: charging?.earliest_session_at ?? '—', end: charging?.latest_session_at ?? '—',
        })} />
      {!driving && !charging ? (
        // no-action: mirrors this vehicle's drive/charge history query results as currently cached; the panel receives no refetch handler and the Evidence tab has no manual sync control.
        <EmptyState message={t('resaleVault.usage.empty', 'No driving or charging history evidence in this report.')} />
      ) : (
        <>
          <InlineCallout variant="info" icon={<Info />}>
            {t(
              'resaleVault.usage.scopeNote',
              'Reflects an observed window of recent records, not a guaranteed complete lifetime history.',
            )}
          </InlineCallout>

          {driving && (
            <div>
              {driving.score_overall != null && (
                <div className="mt-2">
                  <Badge variant="success">
                    {t('resaleVault.usage.score', 'Driving score')}: {driving.score_overall} {driving.score_grade ? `(${driving.score_grade})` : ''}
                  </Badge>
                </div>
              )}
            </div>
          )}

        </>
      )}
    </LayoutCard>
  );
}
