import { useTranslation } from 'react-i18next';
import { knownNumber } from '@/api/dataState';
import { LayoutCard } from '@/components/layout/layout-reference';
import { LinearGauge, CHART_COLORS } from '@/components/charts';
import { HelperText } from '@/components/ui';
import { RangeSourceSlot, type RangeSectionProps } from './RangeSourceSlot';

export function RangeEfficiency({ source, loading }: RangeSectionProps) {
  const { t } = useTranslation();
  const efficiency = knownNumber(source.data?.efficiency_factor);
  const color = efficiency != null && efficiency >= 0.9 ? CHART_COLORS[1]
    : efficiency != null && efficiency >= 0.7 ? CHART_COLORS[3] : CHART_COLORS[5];
  return (
    <LayoutCard title={t('range.efficiency', 'Efficiency')}>
      <RangeSourceSlot source={source} loading={loading} empty={efficiency == null}
        message={t('range.noEfficiency', 'Efficiency data unavailable yet.')}>
        <div className="flex flex-1 flex-col items-center justify-center">
          {efficiency != null && <LinearGauge value={Math.round(efficiency * 100)}
            max={100} label={t('range.efficiency', 'Efficiency')} unit="%" color={color} size={160} />}
          {source.data?.accuracy_note && <HelperText className="mt-2 text-center">{source.data.accuracy_note}</HelperText>}
        </div>
      </RangeSourceSlot>
    </LayoutCard>
  );
}
