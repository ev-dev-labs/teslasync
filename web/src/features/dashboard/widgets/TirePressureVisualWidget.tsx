import { useTranslation } from 'react-i18next';
import { CircleDot } from 'lucide-react';
import { Badge, Text } from '@/components/ui';
import { deriveDataState } from '@/api/dataState';
import { EmptyState } from '@/components/feedback';
import { useVehicles, useLatestTirePressure } from '@/api/hooks/useVehicles';
import { usePressureFormat } from '@/hooks/usePressureFormat';

import { tirePressureVariant } from '@/features/vehicles/components/vehicle-detail/helpers';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import VehicleStudio from './vehicle-instruments/VehicleStudio';

type TireVariant = ReturnType<typeof tirePressureVariant>;

/**
 * Value-text colour per tire-pressure severity variant. The variant is
 * derived from the backend SI value (Pascals) by the shared
 * `tirePressureVariant` helper, keeping this widget consistent with the
 * vehicle-detail tire panels instead of re-deriving thresholds locally. The
 * `neutral` band renders a muted grey for an unknown/missing reading rather
 * than an alarming critical-red.
 */
const VARIANT_STYLE: Record<TireVariant, { text: string }> = {
  success: { text: 'text-emerald-300' },
  warning: { text: 'text-amber-300' },
  danger: { text: 'text-rose-300' },
  neutral: { text: 'text-[var(--text-muted)]' },
};

interface TireInfo {
  label: string;
  value: number | null;
  variant: TireVariant;
}

export default function TirePressureVisualWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles, isLoading: vehiclesLoading, error: vehiclesError } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const vehicle = vehicles?.find(item => item.id === id);
  const { data: tireData, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch } = useLatestTirePressure(id, 10_000);
  const { pressureUnit, formatPressureValue } = usePressureFormat();

  const tires: [TireInfo, TireInfo, TireInfo, TireInfo] = [
    { label: t('widget.tireFL', 'FL'), value: tireData?.front_left ?? null, variant: tirePressureVariant(tireData?.front_left) },
    { label: t('widget.tireFR', 'FR'), value: tireData?.front_right ?? null, variant: tirePressureVariant(tireData?.front_right) },
    { label: t('widget.tireRL', 'RL'), value: tireData?.rear_left ?? null, variant: tirePressureVariant(tireData?.rear_left) },
    { label: t('widget.tireRR', 'RR'), value: tireData?.rear_right ?? null, variant: tirePressureVariant(tireData?.rear_right) },
  ];

  const allNormal = tires.every((tire) => tire.variant === 'success');
  const hasWarning = tires.some((tire) => tire.variant === 'warning');
  const hasDanger = tires.some((tire) => tire.variant === 'danger');
  const loading = isLoading || (vehiclesLoading && !id);
  const queryError = error ?? (!id ? vehiclesError : null);
  const dataState = deriveDataState({
    data: tireData ?? (loading || queryError || isError ? undefined : null),
    error: queryError,
    isError,
    isFetching,
    dataUpdatedAt,
    refetch,
  });

  const formatPressure = (val: number | null): string => {
    if (val == null || !Number.isFinite(val)) return '—';
    const formatted = formatPressureValue(val, { precision: 2 });
    const suffix = ` ${pressureUnit}`;
    return formatted.endsWith(suffix) ? formatted.slice(0, -suffix.length) : formatted;
  };

  return (
    <WidgetShell
      title={t('widget.tirePressure', 'Tire pressure')}
      icon={<CircleDot className="h-3.5 w-3.5 text-[var(--semantic-info)]" />}
      loading={loading}
      dataState={dataState}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {tireData ? (
        <div className="flex h-full min-w-0 flex-col justify-center gap-2">
          {vehicle && <VehicleStudio vehicle={vehicle} size="lg" bounded={size.rows <= 4} />}
          <div className="grid grid-cols-2 gap-2">
            {[tires[0], tires[2], tires[1], tires[3]].map(tire => (
              <div key={tire.label} role="group" aria-label={tire.label} data-pressure-status={tire.variant}
                className="widget-status-tile flex min-w-0 items-center justify-between gap-2 py-2">
                <Text as="span" variant="caption">{tire.label}</Text>
                <Text as="span" variant="body" className={VARIANT_STYLE[tire.variant].text}>{formatPressure(tire.value)}</Text>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-2">
            <Badge variant={allNormal ? 'success' : hasDanger ? 'danger' : hasWarning ? 'warning' : 'neutral'}>
              {allNormal
                ? t('widget.tireAllNormal', 'All normal')
                : hasDanger || hasWarning ? t('widget.tireWarning', 'Check pressure') : t('hero.unknownStatus', 'Unknown')}
            </Badge>
            <Text variant="caption">{pressureUnit}</Text>
          </div>
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<CircleDot className="h-5 w-5" />}
          message={t('widget.noTireData', 'No tire pressure data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
