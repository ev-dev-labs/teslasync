import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { EfficiencyBucket } from '@/api/hooks/useAnalytics';
import { knownNumber } from '@/api/dataState';
import { LayoutCard } from '@/components/layout/layout-reference';
import { Caption, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { convertEfficiencyFromSI } from '@/lib/unitConversion';
import { safeArray } from '@/lib/safeArray';
import { cn } from '@/lib/cn';
import { matrixTone } from './helpers';
import { RangeSourceSlot, type RangeSectionProps } from './RangeSourceSlot';

const temperatures = ['freezing', 'cold', 'mild', 'hot'] as const;
const speeds = ['city', 'suburban', 'highway'] as const;
const temperatureLabels = { freezing: 'Freezing', cold: 'Cold', mild: 'Mild', hot: 'Hot' };
const speedLabels = { city: 'City', suburban: 'Suburban', highway: 'Highway' };

export function RangeMatrix({ source, loading }: RangeSectionProps) {
  const { t } = useTranslation();
  const { fmtNumber } = useNumberFormatting();
  const { unitPrefs } = useUnits();
  const matrix = safeArray(source.data?.efficiency_matrix);
  const lookup = useMemo(() => {
    const map: Record<string, EfficiencyBucket> = {};
    for (const bucket of matrix) map[`${bucket.temp_bucket}|${bucket.speed_bucket}`] = bucket;
    return map;
  }, [matrix]);
  const unit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';
  const title = `${t('range.efficiencyMatrix', 'Personal Efficiency Matrix')} (${unit})`;
  return (
    <LayoutCard title={title}>
      <section aria-label={title} className="min-w-0">
        <RangeSourceSlot source={source} loading={loading} empty={matrix.length === 0}
          message={t('range.noMatrix', 'Efficiency data requires drives in different conditions.')} height={200}>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 px-3">
              {speeds.map(speed => (
                <Caption key={speed} className="block min-w-0 break-words">
                  {t(`range.speedBucket.${speed}`, speedLabels[speed])}
                </Caption>
              ))}
            </div>
            {temperatures.map(temperature => (
              <div key={temperature} className="min-w-0 rounded-lg border border-[var(--border-subtle)] p-3">
                <Text as="p" variant="bodySm" className="mb-2">
                  {t(`range.tempBucket.${temperature}`, temperatureLabels[temperature])}
                </Text>
                <div className="grid grid-cols-3 gap-2">
                  {speeds.map(speed => {
                    const bucket = lookup[`${temperature}|${speed}`];
                    const efficiency = knownNumber(bucket?.wh_km);
                    return (
                      <div key={speed} aria-label={`${t(`range.tempBucket.${temperature}`, temperatureLabels[temperature])}, ${t(`range.speedBucket.${speed}`, speedLabels[speed])}`}
                        className={cn('min-w-0 rounded-lg p-2',
                        efficiency == null ? 'bg-[var(--surface-2)]' : matrixTone(efficiency))}>
                        <Text as="span" variant="bodySm" className="block break-words tabular-nums">
                          {efficiency == null ? '—' : fmtNumber(convertEfficiencyFromSI(efficiency, unitPrefs.distance))}
                        </Text>
                        {bucket && <Caption className="block">({knownNumber(bucket.samples) ?? '—'})</Caption>}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </RangeSourceSlot>
      </section>
    </LayoutCard>
  );
}
