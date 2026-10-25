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
import { COLOR, CHART_NEUTRAL } from '@/lib/colors';

type TireVariant = ReturnType<typeof tirePressureVariant>;

/**
 * Fill + value-text colour per tire-pressure severity variant. The variant is
 * derived from the backend SI value (Pascals) by the shared
 * `tirePressureVariant` helper, keeping this widget consistent with the
 * vehicle-detail tire panels instead of re-deriving thresholds locally. The
 * `neutral` band renders a muted grey for an unknown/missing reading rather
 * than an alarming critical-red.
 */
const VARIANT_STYLE: Record<TireVariant, { fill: string; text: string }> = {
  success: { fill: COLOR.GOOD, text: 'text-emerald-300' },
  warning: { fill: COLOR.WARN, text: 'text-amber-300' },
  danger: { fill: COLOR.BAD, text: 'text-rose-300' },
  neutral: { fill: CHART_NEUTRAL, text: 'text-[var(--text-muted)]' },
};

interface TireInfo {
  label: string;
  value: number | null;
  variant: TireVariant;
}

/**
 * Top-down car silhouette with four tire indicators.
 * Each tire is a rounded rect colored by pressure status.
 */
function CarDiagram({ tires }: { tires: [TireInfo, TireInfo, TireInfo, TireInfo] }) {
  const tirePositions = [
    { tire: tires[0], x: 78, y: 28 },
    { tire: tires[1], x: 172, y: 28 },
    { tire: tires[2], x: 78, y: 116 },
    { tire: tires[3], x: 172, y: 116 },
  ];

  return (
    <svg viewBox="-30 0 320 170" className="mx-auto block w-full max-w-[320px]" aria-hidden="true">
      {tirePositions.map(({ tire, x, y }) => (
        <rect
          key={tire.label}
          x={x} y={y} width="10" height="26" rx="3"
          fill={VARIANT_STYLE[tire.variant].fill}
        />
      ))}
      <rect x="86" y="10" width="88" height="150" rx="34"
        fill="none" className="stroke-[var(--border-default)]" strokeWidth="1.5" />
      <path d="M96 52 Q130 40 164 52 L160 70 Q130 62 100 70Z" className="fill-[var(--border-subtle)]" />
      <path d="M100 118 Q130 124 160 118 L163 132 Q130 142 97 132Z" className="fill-[var(--border-subtle)]" />
      <line x1="88" y1="92" x2="172" y2="92" className="stroke-[var(--border-subtle)]" />
    </svg>
  );
}

export default function TirePressureVisualWidget({ vehicleId }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles, isLoading: vehiclesLoading, error: vehiclesError } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { data: tireData, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch } = useLatestTirePressure(id, 10_000);
  const { pressureUnit, formatPressureValue } = usePressureFormat();

  const tires: [TireInfo, TireInfo, TireInfo, TireInfo] = [
    { label: 'FL', value: tireData?.front_left ?? null, variant: tirePressureVariant(tireData?.front_left) },
    { label: 'FR', value: tireData?.front_right ?? null, variant: tirePressureVariant(tireData?.front_right) },
    { label: 'RL', value: tireData?.rear_left ?? null, variant: tirePressureVariant(tireData?.rear_left) },
    { label: 'RR', value: tireData?.rear_right ?? null, variant: tirePressureVariant(tireData?.rear_right) },
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
      icon={<CircleDot className="h-3.5 w-3.5 text-neon-cyan" />}
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
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(112px,min(320px,calc(100%_-_6rem)))_minmax(0,1fr)] items-center gap-1">
            <div className="flex min-w-0 flex-col gap-10 text-end">
              <Text as="span" variant="body" className={VARIANT_STYLE[tires[0].variant].text}>{formatPressure(tires[0].value)}</Text>
              <Text as="span" variant="body" className={VARIANT_STYLE[tires[2].variant].text}>{formatPressure(tires[2].value)}</Text>
            </div>
            <div className="flex items-center justify-center">
              <CarDiagram tires={tires} />
            </div>
            <div className="flex min-w-0 flex-col gap-10 text-start">
              <Text as="span" variant="body" className={VARIANT_STYLE[tires[1].variant].text}>{formatPressure(tires[1].value)}</Text>
              <Text as="span" variant="body" className={VARIANT_STYLE[tires[3].variant].text}>{formatPressure(tires[3].value)}</Text>
            </div>
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
