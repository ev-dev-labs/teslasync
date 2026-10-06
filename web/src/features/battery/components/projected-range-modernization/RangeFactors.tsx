import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Thermometer, Car, Wind, Mountain, Gauge } from 'lucide-react';
import { knownNumber } from '@/api/dataState';
import { LayoutCard } from '@/components/layout/layout-reference';
import { Badge, HelperText, Text } from '@/components/ui';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { safeArray } from '@/lib/safeArray';
import { RangeSourceSlot, type RangeSectionProps } from './RangeSourceSlot';

const icons: Record<string, ReactNode> = {
  temperature: <Thermometer className="h-4 w-4" />, speed: <Car className="h-4 w-4" />,
  hvac: <Wind className="h-4 w-4" />, elevation: <Mountain className="h-4 w-4" />,
  driving_style: <Gauge className="h-4 w-4" />,
};

export function RangeFactors({ source, loading }: RangeSectionProps) {
  const { t } = useTranslation();
  const { fmtNumber } = useNumberFormatting();
  const factors = safeArray(source.data?.factors);
  return (
    <LayoutCard title={t('range.factors', 'Range Factors')}>
      <RangeSourceSlot source={source} loading={loading} empty={factors.length === 0}
        message={t('range.noFactors', 'Range factors will appear once enough driving data is collected.')} height={120}>
        <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @4xl:grid-cols-3">
          {factors.map(factor => {
            const impact = knownNumber(factor.impact_pct);
            return (
              <div key={factor.name} className="flex min-w-0 items-start gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4">
                <span className="mt-0.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true">
                  {icons[(factor.name ?? '').toLowerCase().replace(/\s+/g, '_')] ?? <Gauge className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Text as="span" size="sm" weight="medium" color="primary">{t(`range.factor.${factor.name}`, factor.name)}</Text>
                    <Badge variant={impact == null ? 'neutral' : impact >= 0 ? 'success' : 'danger'} size="sm">
                      {impact == null ? '—' : `${impact >= 0 ? '+' : ''}${fmtNumber(impact)}%`}
                    </Badge>
                  </div>
                  <HelperText className="mt-1 block">{t(`range.factorDesc.${factor.name}`, factor.description)}</HelperText>
                </div>
              </div>
            );
          })}
        </div>
      </RangeSourceSlot>
    </LayoutCard>
  );
}
