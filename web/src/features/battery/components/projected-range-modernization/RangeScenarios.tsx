import { useTranslation } from 'react-i18next';
import { knownNumber } from '@/api/dataState';
import { LayoutCard } from '@/components/layout/layout-reference';
import { Badge, Caption, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { convertEfficiencyFromSI } from '@/lib/unitConversion';
import { safeArray } from '@/lib/safeArray';
import { scenarioIcon } from './helpers';
import { RangeSourceSlot, type RangeSectionProps } from './RangeSourceSlot';

export function RangeScenarios({ source, loading }: RangeSectionProps) {
  const { t } = useTranslation();
  const { fmtNumber } = useNumberFormatting();
  const { formatDistance, formatSpeed, formatTemperature, unitPrefs } = useUnits();
  const scenarios = safeArray(source.data?.scenarios);
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';
  return (
    <LayoutCard title={t('range.scenarios', 'Range Scenarios')}>
      <RangeSourceSlot source={source} loading={loading} empty={scenarios.length === 0}
        message={t('range.noScenarios', 'Drive more to see personalized scenario projections.')} height={140}>
        <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @4xl:grid-cols-3">
          {scenarios.map(scenario => {
            const range = knownNumber(scenario.range_km);
            const speed = knownNumber(scenario.speed_kmh);
            const temperature = knownNumber(scenario.temp_c);
            const efficiency = knownNumber(scenario.efficiency_wh_km);
            const samples = knownNumber(scenario.sample_count);
            const extras = safeArray(scenario.extras);
            return (
              <div key={scenario.name} className="min-w-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2 text-[var(--text-secondary)]">
                    {scenarioIcon(scenario)}
                    <Text as="span" size="sm" weight="semibold" color="primary" className="break-words">{scenario.name}</Text>
                  </div>
                  {scenario.is_current && <Badge variant="success" size="sm">{t('range.current', 'Current')}</Badge>}
                </div>
                <Text as="p" variant="metricValue" className="tabular-nums">
                  {range == null ? '—' : formatDistance(range * 1000)}
                </Text>
                <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1">
                  <Caption>{speed == null ? '—' : formatSpeed(speed / 3.6)}</Caption>
                  <Caption>{formatTemperature(temperature)}</Caption>
                  <Caption>{efficiency == null ? '—' : `${fmtNumber(convertEfficiencyFromSI(efficiency, unitPrefs.distance))} ${efficiencyUnit}`}</Caption>
                  {samples != null && samples > 0 && <Caption>{t('range.drivesCount', '{{count}} drives', { count: samples })}</Caption>}
                </div>
                {extras.length > 0 && <div className="mt-2 flex flex-wrap gap-1">
                  {extras.map(extra => <Badge key={extra} variant="neutral" size="sm">{extra}</Badge>)}
                </div>}
              </div>
            );
          })}
        </div>
      </RangeSourceSlot>
    </LayoutCard>
  );
}
