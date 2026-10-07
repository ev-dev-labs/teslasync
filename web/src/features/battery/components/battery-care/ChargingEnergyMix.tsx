import { PlugZap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { MetricBar } from '@/components/data-display';
import {
  Badge,
  MetricLabel,
  MetricValue,
  Text,
} from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { fmtPercent } from '@/lib/numberFormat';
import { chartTokens } from '@/lib/tokens';

import {
  MIN_ENERGY_CLASSIFICATION_COVERAGE,
  type CareScore,
  type ChargerCategory,
} from '../../lib/batteryCare';
import { BatteryCareSection } from './BatteryCareSection';
import type { BatteryCareSectionState } from './types';

interface ChargingEnergyMixProps {
  care: CareScore;
  state: BatteryCareSectionState;
  className?: string;
}

function categoryLabel(category: ChargerCategory, t: TFunction): string {
  switch (category) {
    case 'ac':
      return t('batteryCare.energy.ac', 'AC');
    case 'dc':
      return t('batteryCare.energy.dc', 'DC fast');
    case 'unknown':
      return t('batteryCare.energy.unknown', 'Unclassified');
  }
}

/** Delivered-energy mix with unknown charger metadata kept visible. */
export function ChargingEnergyMix({
  care,
  state,
  className,
}: ChargingEnergyMixProps) {
  const { t } = useTranslation();
  const { formatEnergy } = useUnits();
  const coverage = care.energyMix.classificationCoverage;

  return (
    <BatteryCareSection
      className={className}
      title={t('batteryCare.energy.title', 'AC/DC energy evidence')}
      description={t(
        'batteryCare.energy.description',
        'Delivered energy is classified only when charger metadata or high-power evidence supports it',
      )}
      icon={<PlugZap className="h-4 w-4 text-indigo-300" aria-hidden="true" />}
      emptyIcon={<PlugZap className="h-8 w-8" aria-hidden="true" />}
      emptyMessage={t(
        'batteryCare.energy.empty',
        'No charging sessions with positive measured energy are available in the returned window.',
      )}
      hasData={care.energyMix.energySessions > 0}
      state={state}
      testId="battery-care-energy"
      badge={
        <Badge
          variant={
            coverage != null &&
            coverage >= MIN_ENERGY_CLASSIFICATION_COVERAGE
              ? 'success'
              : 'warning'
          }
          dot
        >
          {coverage != null
            ? t('batteryCare.energy.coverageBadge', '{{pct}} classified', {
                pct: fmtPercent(coverage * 100, 0),
              })
            : t('batteryCare.energy.noCoverage', 'No classification')}
        </Badge>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl bg-[var(--surface-2)] p-4">
          <MetricValue>
            {formatEnergy(care.energyMix.totalEnergyWh, { precision: 1 })}
          </MetricValue>
          <MetricLabel>
            {t('batteryCare.energy.total', 'Measured energy returned')}
          </MetricLabel>
        </div>
        <div className="rounded-xl bg-[var(--surface-2)] p-4">
          <MetricValue>
            {formatEnergy(care.energyMix.classifiedEnergyWh, {
              precision: 1,
            })}
          </MetricValue>
          <MetricLabel>
            {t('batteryCare.energy.classified', 'Classified AC/DC energy')}
          </MetricLabel>
        </div>
      </div>

      <div className="mt-4 space-y-4">
        {care.energyMix.buckets.map((bucket, index) => (
          <MetricBar
            key={bucket.category}
            label={categoryLabel(bucket.category, t)}
            value={(bucket.share ?? 0) * 100}
            max={100}
            color={chartTokens.series[index + 1]}
            sublabel={t(
              'batteryCare.energy.bucketValue',
              '{{energy}} · {{count}} sessions',
              {
                energy: formatEnergy(bucket.energyWh, { precision: 1 }),
                count: bucket.sessions,
              },
            )}
          />
        ))}
      </div>

      <Text as="p" variant="caption" className="mt-4">
        {t(
          'batteryCare.energy.denominator',
          'The DC KPI uses classified AC/DC energy only; unclassified energy stays visible here and can withhold the score.',
        )}
      </Text>
    </BatteryCareSection>
  );
}
