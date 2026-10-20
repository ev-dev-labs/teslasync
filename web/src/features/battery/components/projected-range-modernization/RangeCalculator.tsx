import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { knownNumber } from '@/api/dataState';
import { LayoutCard } from '@/components/layout/layout-reference';
import { Slider, Caption, HelperText, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { convertEfficiencyFromSI } from '@/lib/unitConversion';
import { safeArray } from '@/lib/safeArray';
import { interpolateRange } from './helpers';
import { RangeSourceSlot, type RangeSectionProps } from './RangeSourceSlot';

export function RangeCalculator({ source, loading, speed, temperature, onSpeedChange, onTemperatureChange }: RangeSectionProps & {
  speed: number;
  temperature: number;
  onSpeedChange: (value: number) => void;
  onTemperatureChange: (value: number) => void;
}) {
  const { t } = useTranslation();
  const { fmtNumber } = useNumberFormatting();
  const { formatSpeed, formatTemperature, formatDistance, unitPrefs } = useUnits();
  const battery = knownNumber(source.data?.current_battery_pct ?? source.data?.battery_level);
  const capacity = knownNumber(source.data?.usable_capacity_wh);
  const result = useMemo(() => {
    if (!source.data || battery == null || capacity == null || capacity < 0) return null;
    return interpolateRange(safeArray(source.data.efficiency_matrix), speed, temperature, battery, capacity);
  }, [source.data, speed, temperature, battery, capacity]);
  const unit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';
  return (
    <LayoutCard title={t('range.whatIf', 'What If Calculator')}>
      <RangeSourceSlot source={source} loading={loading} empty={!source.data}
        message={t('range.noWhatIf', 'Adjust sliders to calculate projected range.')} height={200}>
        <div className="grid grid-cols-1 gap-5 @2xl:grid-cols-2">
          <div className="space-y-4">
            <div>
              <Slider label={t('range.speed', 'Speed')} formatValue={value => formatSpeed(value / 3.6)}
                min={30} max={150} step={5} value={speed} onChange={onSpeedChange} />
              <div className="mt-0.5 flex flex-wrap justify-between gap-2">
                <Caption>{formatSpeed(30 / 3.6)}</Caption>
                <Caption>{formatSpeed(90 / 3.6)}</Caption>
                <Caption>{formatSpeed(150 / 3.6)}</Caption>
              </div>
            </div>
            <div>
              <Slider label={t('range.temperature', 'Temperature')} formatValue={formatTemperature}
                min={-20} max={40} step={1} value={temperature} onChange={onTemperatureChange} />
              <div className="mt-0.5 flex flex-wrap justify-between gap-2">
                <Caption>{formatTemperature(-20)}</Caption>
                <Caption>{formatTemperature(10)}</Caption>
                <Caption>{formatTemperature(40)}</Caption>
              </div>
            </div>
          </div>
          <div className="flex min-w-0 items-center justify-center rounded-lg bg-[var(--surface-2)] p-4">
            {result ? (
              <div className="min-w-0 text-center">
                <Text as="p" variant="metricValue" className="tabular-nums">{formatDistance(result.rangeKm * 1000)}</Text>
                <HelperText className="mt-1">{fmtNumber(convertEfficiencyFromSI(result.effWhKm, unitPrefs.distance))} {unit}</HelperText>
                <HelperText className="mt-1">{t('range.whatIfConditions', 'at {{speed}}, {{temp}}',
                  { speed: formatSpeed(speed / 3.6), temp: formatTemperature(temperature) })}</HelperText>
              </div>
            ) : <Text as="p" variant="bodySm">
              {t('range.modernization.missingCalculatorInputs', 'Measured battery level and usable capacity are required to calculate a range.')}
            </Text>}
          </div>
        </div>
      </RangeSourceSlot>
    </LayoutCard>
  );
}
