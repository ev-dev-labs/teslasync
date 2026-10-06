/**
 * Battery health summary — renders the Battery Passport-derived evidence
 * (state of health, capacity fade, cycles, thermal exposure, degradation
 * trend, recommendations). All physical quantities are stored as SI
 * (watt-hours) on the evidence object; this is the display boundary where
 * `useUnits()` converts them for the user's locale/preference.
 */
import { useTranslation } from 'react-i18next';
import { Badge, HelperText } from '@/components/ui';
import { LayoutCard } from '@/components/layout';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { VaultSummaryBrief } from './operationalbrief-all/VaultSummaryBrief';
import type { VaultEvidenceSource } from '../hooks/useVaultEvidence';
import { EmptyState } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import type { BatteryEvidence } from '../lib/types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export interface BatterySummaryPanelProps {
  battery: BatteryEvidence | null;
  sources?: readonly VaultEvidenceSource[];
}

export function BatterySummaryPanel({ battery, sources }: BatterySummaryPanelProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { formatEnergy } = useUnits();
  const description = t('resaleVault.brief.battery.description', 'Battery Passport measurements; missing readings are not inferred.');
  const metrics: readonly StatMetric[] = [
    { metricId: 'percent', occurrenceId: 'soh', label: t('resaleVault.battery.soh', 'State of health'), rawValue: battery?.soh_pct, description },
    { metricId: 'energy', occurrenceId: 'capacity', label: t('resaleVault.battery.capacity', 'Current capacity'), rawValue: battery?.capacity_wh, description, display: { formatter: (raw) => ({ value: formatEnergy(raw), unit: '' }) } },
    { metricId: 'energy', occurrenceId: 'original-capacity', label: t('resaleVault.battery.originalCapacity', 'Original capacity'), rawValue: battery?.original_capacity_wh, description, display: { formatter: (raw) => ({ value: formatEnergy(raw), unit: '' }) } },
    { metricId: 'number', occurrenceId: 'cycles', label: t('resaleVault.battery.cycles', 'Equivalent full cycles'), rawValue: battery?.equivalent_full_cycles, description },
    { metricId: 'percent', occurrenceId: 'fast-charge-ratio', label: t('resaleVault.battery.fastChargeRatio', 'Fast-charge ratio'), rawValue: battery?.fast_charge_ratio != null ? battery.fast_charge_ratio * 100 : null, description },
    { metricId: 'percent', occurrenceId: 'charge-limit', label: t('resaleVault.battery.avgChargeLimit', 'Average charge limit'), rawValue: battery?.avg_charge_limit_pct, description },
  ];

  return (
    <LayoutCard title={t('resaleVault.battery.title', 'Battery health')}
      actions={battery?.health_grade ? <Badge variant="info">{battery.health_grade}</Badge> : undefined}>

      <VaultSummaryBrief
        id="battery" title={t('resaleVault.brief.battery.title', 'Battery measurements')}
        description={description} metrics={metrics} hasEvidence={battery != null} sources={sources}
        scope={t('resaleVault.brief.window', 'Observed evidence: {{start}} → {{end}}', {
          start: battery?.first_observed_at ?? '—', end: battery?.issued_at ?? '—',
        })}
        provenance={battery?.source_provenance_hash ?? undefined}
      />
      {!battery ? (
        // no-action: mirrors the Battery Passport query result as a nullable prop; no refetch handler reaches this panel.
        <EmptyState message={t('resaleVault.battery.empty', 'No battery passport evidence in this report.')} />
      ) : (
        <>
          {battery.thermal_exposure && (
            <div>
              <HelperText className="mb-1">{t('resaleVault.battery.thermal', 'Thermal exposure')}</HelperText>
              <div className="flex flex-wrap gap-2">
                <Badge variant="info">{t('resaleVault.battery.cold', 'Cold')}: {fmtNumber(battery.thermal_exposure.cold_pct)}%</Badge>
                <Badge variant="success">{t('resaleVault.battery.nominal', 'Nominal')}: {fmtNumber(battery.thermal_exposure.nominal_pct)}%</Badge>
                <Badge variant="warning">{t('resaleVault.battery.hot', 'Hot')}: {fmtNumber(battery.thermal_exposure.hot_pct)}%</Badge>
              </div>
            </div>
          )}

          {battery.recommendations.length > 0 && (
            <div>
              <HelperText className="mb-1">{t('resaleVault.battery.recommendations', 'Recommendations')}</HelperText>
              <ul className="list-disc ps-5 text-[var(--text-secondary)] space-y-0.5">
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
    </LayoutCard>
  );
}
