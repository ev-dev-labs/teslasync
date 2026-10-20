import { PlugZap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge, MetricLabel, MetricValue, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { chartTokens } from '@/lib/tokens';
import {
  MIN_ENERGY_CLASSIFICATION_COVERAGE,
  type CareScore,
  type ChargerCategory,
} from '../../lib/batteryCare';
import { CareSection } from './CareSection';
import { EvidenceBar } from './EvidenceBar';
import type { CareSectionState } from './state';

/** Raw Wh enter the existing display boundary; model/cache remain canonical. */
export function CareEnergy({ care, state }: { care: CareScore; state: CareSectionState }) {
  const { t } = useTranslation();
  const { formatEnergy } = useUnits();
  const { fmtPercent } = useNumberFormatting();
  const coverage = care.energyMix.classificationCoverage;
  const labels: Record<ChargerCategory, string> = {
    ac: t('batteryCare.energy.ac', 'AC'),
    dc: t('batteryCare.energy.dc', 'DC fast'),
    unknown: t('batteryCare.energy.unknown', 'Unclassified'),
  };
  return (
    <CareSection
      title={t('batteryCare.energy.title', 'AC/DC energy evidence')}
      description={t('batteryCare.energy.description', 'Delivered energy is classified only when charger metadata or high-power evidence supports it')}
      icon={<PlugZap className="h-8 w-8" aria-hidden="true" />}
      emptyMessage={t('batteryCare.energy.empty', 'No charging sessions with positive measured energy are available in the returned window.')}
      hasData={care.energyMix.energySessions > 0}
      state={state}
      testId="battery-care-energy"
      badge={
        <Badge variant={coverage != null && coverage >= MIN_ENERGY_CLASSIFICATION_COVERAGE ? 'success' : 'warning'} dot>
          {coverage != null
            ? t('batteryCare.energy.coverageBadge', '{{pct}} classified', { pct: fmtPercent(coverage * 100) })
            : t('batteryCare.energy.noCoverage', 'No classification')}
        </Badge>
      }
    >
      <div className="grid min-w-0 gap-4 @lg:grid-cols-2">
        <div className="min-w-0 rounded-xl bg-[var(--surface-2)] p-4">
          <MetricValue>{formatEnergy(care.energyMix.totalEnergyWh)}</MetricValue>
          <MetricLabel>{t('batteryCare.energy.total', 'Measured energy returned')}</MetricLabel>
        </div>
        <div className="min-w-0 rounded-xl bg-[var(--surface-2)] p-4">
          <MetricValue>{formatEnergy(care.energyMix.classifiedEnergyWh)}</MetricValue>
          <MetricLabel>{t('batteryCare.energy.classified', 'Classified AC/DC energy')}</MetricLabel>
        </div>
      </div>
      <div className="min-w-0 space-y-4">
        {care.energyMix.buckets.map((bucket, index) => (
          <EvidenceBar
            key={bucket.category}
            label={labels[bucket.category]}
            value={bucket.share == null ? null : bucket.share * 100}
            max={100}
            color={chartTokens.series[index + 1]}
            sublabel={t('batteryCare.energy.bucketValue', '{{energy}} · {{count}} sessions', {
              energy: formatEnergy(bucket.energyWh),
              count: bucket.sessions,
            })}
          />
        ))}
      </div>
      <Text as="p" variant="caption">
        {t('batteryCare.energy.denominator', 'The DC KPI uses classified AC/DC energy only; unclassified energy stays visible here and can withhold the score.')}
      </Text>
    </CareSection>
  );
}
