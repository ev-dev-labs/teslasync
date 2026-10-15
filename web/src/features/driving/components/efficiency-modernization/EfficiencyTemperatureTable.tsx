import { useTranslation } from 'react-i18next';
import { DataTable, Text } from '@/components/ui';
import { LayoutCard } from '@/components/layout/layout-reference';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { EfficiencySource } from './EfficiencySource';
import { finite, type TemperatureBucket } from './model';
import type { DrivesPresentation } from './types';

export function EfficiencyTemperatureTable({ model, source, units }: DrivesPresentation) {
  const { t } = useTranslation();
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { tempBuckets, toDistanceDisplay, toSpeedDisplay, toEfficiencyDisplay } = model;
  const { distance: distanceUnit, speed: speedUnit } = units.unitPrefs;
  const efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';
  const title = t('efficiency.tempEfficiency', 'Efficiency by temperature range');
  const labels = {
    range: t('efficiency.tempRange', 'Temp range'),
    count: t('efficiency.drives', 'Drives'),
    avgEff: t('efficiency.temperatureTable.averageConsumption', 'Avg {{unit}}', { unit: efficiencyUnit }),
    kmPerKwh: t('efficiency.temperatureTable.economy', '{{unit}}/kWh', { unit: distanceUnit }),
    totalDist: t('efficiency.temperatureTable.totalDistance', 'Total {{unit}}', { unit: distanceUnit }),
    avgSpeed: t('efficiency.avgSpeedCol', 'Avg speed'),
  };
  const displayValue = (b: TemperatureBucket, key: string): string | number => {
    switch (key) {
      case 'range': return b.range;
      case 'count': return finite(b.count) ? fmtInt(b.count) : '—';
      case 'avgEff': return finite(b.avgEff) ? fmtInt(toEfficiencyDisplay(b.avgEff)) : '—';
      case 'kmPerKwh': return finite(b.avgEff) && b.avgEff > 0 ? fmtNumber(1000 / toEfficiencyDisplay(b.avgEff)) : '—';
      case 'totalDist': return finite(b.totalDist) ? fmtNumber(toDistanceDisplay(b.totalDist)) : '—';
      case 'avgSpeed': return finite(b.avgSpeed)
        ? t('efficiency.temperatureTable.measurement', '{{value}} {{unit}}', {
          value: fmtNumber(toSpeedDisplay(b.avgSpeed)), unit: speedUnit,
        }) : '—';
      default: return '—';
    }
  };
  return <LayoutCard title={title}>
    <EfficiencySource {...source} label={title} available={tempBuckets.length > 0}
      emptyMessage={t('efficiency.noTempData', 'Not enough data for temperature breakdown')}>
      <DataTable
        tableId="driving:efficiency-temp-buckets"
        variant="embedded" data={tempBuckets} keyExtractor={b => b.range}
        compact pagination
        columns={[
          { key: 'range', header: labels.range,
            render: b => <Text weight="medium" color="primary">{b.range}</Text> },
          { key: 'count', header: labels.count, align: 'right',
            render: b => <Text color="secondary">{displayValue(b, 'count')}</Text> },
          { key: 'avgEff', header: labels.avgEff, align: 'right',
            render: b => <Text className="tabular-nums">{displayValue(b, 'avgEff')}</Text> },
          { key: 'kmPerKwh', header: labels.kmPerKwh, align: 'right',
            render: b => <Text color="secondary">{displayValue(b, 'kmPerKwh')}</Text> },
          { key: 'totalDist', header: labels.totalDist, align: 'right',
            render: b => <Text color="secondary">{displayValue(b, 'totalDist')}</Text> },
          { key: 'avgSpeed', header: labels.avgSpeed, align: 'right',
            render: b => <Text color="secondary">{displayValue(b, 'avgSpeed')}</Text> },
        ]}
        mobileColumns={['range', 'count', 'avgEff']}
        mobilePresentation={{
          roles: { range: 'title', count: 'meta', avgEff: 'primary',
            kmPerKwh: 'hidden', totalDist: 'hidden', avgSpeed: 'hidden' },
          displayValue: (b, key) => key === 'avgEff' && finite(b.avgEff)
            ? t('efficiency.temperatureTable.measurement', '{{value}} {{unit}}', {
              value: displayValue(b, key), unit: efficiencyUnit,
            }) : displayValue(b, key),
          // The adapter's real allColumns detail modal retains all six columns.
          // Do not duplicate them through allDetails or add another controller.
        }}
      />
    </EfficiencySource>
  </LayoutCard>;
}
