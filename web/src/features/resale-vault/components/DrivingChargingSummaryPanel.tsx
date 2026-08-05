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
import { GlassPanel, Badge } from '@/components/ui';
import { PanelTitle, HelperText } from '@/components/ui';
import { KVList } from '@/components/data-display';
import { EmptyState, InlineCallout } from '@/components/feedback';
import { Info } from 'lucide-react';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceToSI } from '@/lib/unitConversion';
import type { ChargingHistoryEvidence, DrivingHistoryEvidence } from '../lib/types';

export interface DrivingChargingSummaryPanelProps {
  driving: DrivingHistoryEvidence | null;
  charging: ChargingHistoryEvidence | null;
}

export function DrivingChargingSummaryPanel({ driving, charging }: DrivingChargingSummaryPanelProps) {
  const { t } = useTranslation();
  const { unitPrefs, formatDistance, formatDuration, formatEnergy, formatPower } = useUnits();

  const formatEfficiency = (whPerKm: number | null): string => {
    if (whPerKm == null) return '—';
    const metersPerDisplayUnit = convertDistanceToSI(1, unitPrefs.distance);
    const whPerDisplayUnit = whPerKm * (metersPerDisplayUnit / 1000);
    return `${formatEnergy(whPerDisplayUnit)}/${unitPrefs.distance}`;
  };

  return (
    <GlassPanel padding="lg" className="space-y-4">
      <PanelTitle>{t('resaleVault.usage.title', 'Driving & Charging History')}</PanelTitle>

      {!driving && !charging ? (
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
              <HelperText className="mb-1">{t('resaleVault.usage.driving', 'Driving')}</HelperText>
              <KVList
                items={[
                  { label: t('resaleVault.usage.drives', 'Drives observed'), value: String(driving.observed_drive_count) },
                  { label: t('resaleVault.usage.distance', 'Total distance'), value: driving.total_distance_m != null ? formatDistance(driving.total_distance_m) : '—' },
                  { label: t('resaleVault.usage.duration', 'Total duration'), value: driving.total_duration_s != null ? formatDuration(driving.total_duration_s) : '—' },
                  { label: t('resaleVault.usage.efficiency', 'Avg. efficiency'), value: formatEfficiency(driving.avg_efficiency_wh_per_km) },
                  { label: t('resaleVault.usage.regen', 'Regen ratio'), value: driving.regen_ratio != null ? `${(driving.regen_ratio * 100).toFixed(0)}%` : '—' },
                  { label: t('resaleVault.usage.co2', 'CO2 saved'), value: driving.co2_saved_kg != null ? `${driving.co2_saved_kg.toFixed(1)} kg` : '—' },
                ]}
              />
              {driving.score_overall != null && (
                <div className="mt-2">
                  <Badge variant="success">
                    {t('resaleVault.usage.score', 'Driving score')}: {driving.score_overall} {driving.score_grade ? `(${driving.score_grade})` : ''}
                  </Badge>
                </div>
              )}
            </div>
          )}

          {charging && (
            <div>
              <HelperText className="mb-1">{t('resaleVault.usage.charging', 'Charging')}</HelperText>
              <KVList
                items={[
                  { label: t('resaleVault.usage.sessions', 'Sessions observed'), value: String(charging.observed_session_count) },
                  { label: t('resaleVault.usage.energyAdded', 'Total energy added'), value: charging.total_energy_added_wh != null ? formatEnergy(charging.total_energy_added_wh) : '—' },
                  { label: t('resaleVault.usage.fastCharge', 'Fast-charge sessions'), value: String(charging.fast_charge_session_count) },
                  { label: t('resaleVault.usage.peakPower', 'Avg. peak power'), value: charging.avg_peak_power_w != null ? formatPower(charging.avg_peak_power_w) : '—' },
                  { label: t('resaleVault.usage.cost', 'Total cost'), value: charging.total_cost != null ? charging.total_cost.toFixed(2) : '—' },
                ]}
              />
            </div>
          )}
        </>
      )}
    </GlassPanel>
  );
}
