/**
 * Battery health summary — renders the Battery Passport-derived evidence
 * (state of health, capacity fade, cycles, thermal exposure, degradation
 * trend, recommendations). All physical quantities are stored as SI
 * (watt-hours) on the evidence object; this is the display boundary where
 * `useUnits()` converts them for the user's locale/preference.
 */
import { useTranslation } from 'react-i18next';
import { GlassPanel, Badge } from '@/components/ui';
import { PanelTitle, HelperText } from '@/components/ui';
import { KVList } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import type { BatteryEvidence } from '../lib/types';

export interface BatterySummaryPanelProps {
  battery: BatteryEvidence | null;
}

export function BatterySummaryPanel({ battery }: BatterySummaryPanelProps) {
  const { t } = useTranslation();
  const { formatEnergy } = useUnits();

  return (
    <GlassPanel padding="lg" className="space-y-4">
      <div className="flex items-center justify-between">
        <PanelTitle>{t('resaleVault.battery.title', 'Battery Health')}</PanelTitle>
        {battery?.health_grade && <Badge variant="info">{battery.health_grade}</Badge>}
      </div>

      {!battery ? (
        // no-action: mirrors the Battery Passport query result as a nullable prop; no refetch handler reaches this panel.
        <EmptyState message={t('resaleVault.battery.empty', 'No battery passport evidence in this report.')} />
      ) : (
        <>
          <KVList
            items={[
              {
                label: t('resaleVault.battery.soh', 'State of health'),
                value: battery.soh_pct != null ? `${battery.soh_pct.toFixed(1)}%` : '—',
              },
              {
                label: t('resaleVault.battery.capacity', 'Current capacity'),
                value: battery.capacity_wh != null ? formatEnergy(battery.capacity_wh) : '—',
              },
              {
                label: t('resaleVault.battery.originalCapacity', 'Original capacity'),
                value: battery.original_capacity_wh != null ? formatEnergy(battery.original_capacity_wh) : '—',
              },
              {
                label: t('resaleVault.battery.cycles', 'Equivalent full cycles'),
                value: battery.equivalent_full_cycles != null ? battery.equivalent_full_cycles.toFixed(1) : '—',
              },
              {
                label: t('resaleVault.battery.fastChargeRatio', 'Fast-charge ratio'),
                value: battery.fast_charge_ratio != null ? `${(battery.fast_charge_ratio * 100).toFixed(0)}%` : '—',
              },
              {
                label: t('resaleVault.battery.avgChargeLimit', 'Average charge limit'),
                value: battery.avg_charge_limit_pct != null ? `${battery.avg_charge_limit_pct.toFixed(0)}%` : '—',
              },
            ]}
          />

          {battery.thermal_exposure && (
            <div>
              <HelperText className="mb-1">{t('resaleVault.battery.thermal', 'Thermal exposure')}</HelperText>
              <div className="flex gap-2 text-xs">
                <Badge variant="info">{t('resaleVault.battery.cold', 'Cold')}: {battery.thermal_exposure.cold_pct.toFixed(0)}%</Badge>
                <Badge variant="success">{t('resaleVault.battery.nominal', 'Nominal')}: {battery.thermal_exposure.nominal_pct.toFixed(0)}%</Badge>
                <Badge variant="warning">{t('resaleVault.battery.hot', 'Hot')}: {battery.thermal_exposure.hot_pct.toFixed(0)}%</Badge>
              </div>
            </div>
          )}

          {battery.recommendations.length > 0 && (
            <div>
              <HelperText className="mb-1">{t('resaleVault.battery.recommendations', 'Recommendations')}</HelperText>
              <ul className="list-disc pl-5 text-xs text-[var(--text-secondary)] space-y-0.5">
                {battery.recommendations.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          {battery.source_provenance_hash && (
            <HelperText className="break-all">
              {t('resaleVault.battery.provenance', 'Passport provenance hash')}: {battery.source_provenance_hash}
            </HelperText>
          )}
        </>
      )}
    </GlassPanel>
  );
}
