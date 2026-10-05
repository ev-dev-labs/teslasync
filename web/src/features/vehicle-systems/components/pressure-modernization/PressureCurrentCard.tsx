import { useTranslation } from 'react-i18next';
import { Gauge } from 'lucide-react';
import { LayoutCard } from '@/components/layout/layout-reference';
import { ThresholdBar, type ThresholdBand } from '@/components/charts';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { Text } from '@/components/ui';
import type { DataState } from '@/api/dataState';
import type { TirePosition, TirePressureReading } from '../../pages/TirePressurePage';
import type { PressureUnitPref } from '@/lib/unitConversion';
import { readPressurePa, type PressureValueConverter } from './pressureData';
import { PressureRefreshNotice } from './PressureRefreshNotice';

const positions = ['fl', 'fr', 'rl', 'rr'] as const;
export interface PressureCurrentCardProps {
  source: DataState<TirePressureReading | null>;
  loading: boolean;
  label: (pos: TirePosition) => string;
  status: (pa: number) => string;
  unit: PressureUnitPref;
  precision: number;
  format: (value: number) => string;
  domain: { min: number; max: number };
  bands: ThresholdBand[];
  convert: PressureValueConverter;
}

export function PressureCurrentCard({
  source, loading, label, status, unit, precision, format, domain, bands, convert,
}: PressureCurrentCardProps) {
  const { t } = useTranslation();
  const latest = source.data;
  return (
    <LayoutCard title={t('tirePressure.currentReadings', 'Current readings')} size="third">
      <PressureRefreshNotice source={source} label={t('dataSources.labels.liveTirePressure', 'Latest tire pressure')} />
      {loading && !latest ? (
        <div className="grid grid-cols-2 gap-3">
          {positions.map(pos => <Skeleton key={pos} height={148} className="w-full" />)}
        </div>
      ) : source.fatalError ? (
        <QueryError error={source.fatalError} onRetry={source.retry ?? undefined}
          resourceName={t('tirePressure.resource', 'Tire pressure')} />
      ) : !latest ? (
        <EmptyState icon={<Gauge className="h-8 w-8" aria-hidden="true" />}
          message={t('tirePressure.noReadings', 'No current readings available')} />
      ) : (
        <div className="flex flex-col gap-5">
          {positions.map(pos => {
            const pa = readPressurePa(latest, pos);
            const value = pa == null ? null : convert(pa);
            if (pa == null || value == null) return (
              <div key={pos} className="space-y-1">
                <Text as="p" variant="bodySm">{label(pos)}</Text>
                <Text as="p" variant="bodySm">{t('tirePressure.noReadings', 'No current readings available')}</Text>
              </div>
            );
            return (
              <div key={pos} className="space-y-1">
                <ThresholdBar value={value} min={domain.min} max={domain.max} bands={bands}
                  statusLabel={status(pa)} label={label(pos)} unit={unit} decimals={precision} />
                {/* ThresholdBar clamps its geometry AND caption. Keep extreme
                    source values reachable instead of relabeling them as edges. */}
                {(value < domain.min || value > domain.max) && (
                  <Text as="p" variant="bodySm">
                    {t('tirePressure.reportedPressure', 'Reported pressure: {{value}} {{unit}}', { value: format(value), unit })}
                  </Text>
                )}
              </div>
            );
          })}
        </div>
      )}
    </LayoutCard>
  );
}
