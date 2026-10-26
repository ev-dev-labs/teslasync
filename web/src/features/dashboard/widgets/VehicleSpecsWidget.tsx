import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { deriveDataState } from '@/api/dataState';
import { useVehicles, useVehicleSpecs, useVehicleConfigLatest } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetDetailCard, type DetailEntry } from './shared';
import type { WidgetProps } from './types';

export default function VehicleSpecsWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles, isLoading: vehiclesLoading, error: vehiclesError } = useVehicles();
  const numericId = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const stringId = numericId > 0 ? String(numericId) : undefined;

  const {
    data: specsEnvelope,
    isLoading: specsLoading,
    isFetching: specsFetching,
    isStale: specsStale,
    isError: specsError,
    error: specsErrorObj,
    dataUpdatedAt: specsUpdatedAt,
    refetch: refetchSpecs,
  } = useVehicleSpecs(stringId);

  const {
    data: configData,
    isLoading: configLoading,
    isFetching: configFetching,
    isStale: configStale,
    isError: configError,
    error: configErrorObj,
    dataUpdatedAt: configUpdatedAt,
    refetch: refetchConfig,
  } = useVehicleConfigLatest(numericId, 60_000);
  const { formatEnergy } = useUnits();

  const isLoading = (vehiclesLoading && !numericId) || specsLoading || configLoading;
  const isFetching = specsFetching || configFetching;
  const isStale = specsStale || configStale;
  const isError = specsError || configError;
  const queryError = specsErrorObj ?? configErrorObj ?? (!numericId ? vehiclesError : null) ?? null;
  const updatedAt = Math.max(specsUpdatedAt ?? 0, configUpdatedAt ?? 0);

  const specs = specsEnvelope?.data ?? null;

  const isCompact = size.cols <= 1;

  const entries: DetailEntry[] = useMemo(() => {
    const items: DetailEntry[] = [];

    const baseModel = asString(specs?.car_type) ?? asString(specs?.model) ?? asString(configData?.car_type);
    const trim = asString(specs?.trim_badging) ?? asString(specs?.trim) ?? asString(configData?.trim);
    const model = baseModel && trim && !baseModel.toLowerCase().includes(trim.toLowerCase())
      ? `${baseModel} ${trim}`
      : baseModel ?? trim;
    items.push({
      label: t('widget.specs.model', 'Model'),
      value: model ?? '—',
    });

    items.push({
      label: t('widget.specs.year', 'Year'),
      value: asString(specs?.model_year) ?? asString(specs?.year),
    });

    const paint = asString(specs?.exterior_color) ?? asString(configData?.exterior_color);
    items.push({
      label: t('widget.specs.paint', 'Paint color'),
      value: paint ?? '—',
    });

    const wheels = asString(specs?.wheel_type) ?? asString(configData?.wheel_type);
    items.push({
      label: t('widget.specs.wheels', 'Wheels'),
      value: wheels ?? '—',
    });

    const capacityWh = asNumber(specs?.battery_capacity_wh);
    const capacity = capacityWh != null ? formatEnergy(capacityWh, { precision: 0 }) : null;
    const batteryType = asString(specs?.battery_type) ?? asString(specs?.battery_pack);
    const battery = capacity && batteryType ? `${capacity} · ${batteryType}` : capacity ?? batteryType;
    items.push({
      label: t('widget.specs.battery', 'Battery'),
      value: battery ?? '—',
    });

    const motors = asString(specs?.motor_type) ?? asString(specs?.drivetrain)
      ?? (typeof specs?.dual_motor === 'boolean'
        ? specs.dual_motor
          ? t('widget.specs.dualMotor', 'Dual')
          : t('widget.specs.singleMotor', 'Single')
        : null);
    items.push({
      label: t('widget.specs.motors', 'Motors'),
      value: motors ?? '—',
    });

    const interior = asString(specs?.interior) ?? asString(specs?.interior_color);
    items.push({
      label: t('widget.specs.interior', 'Interior'),
      value: interior ?? '—',
    });

    return items;
  }, [specs, configData, formatEnergy, t]);

  const hasAnyData = specs != null || configData != null;

  const handleRefresh = useCallback(() => {
    refetchSpecs();
    refetchConfig();
  }, [refetchSpecs, refetchConfig]);
  const dataState = deriveDataState({
    data: hasAnyData ? { specs, configData } : isLoading || queryError || isError ? undefined : null,
    error: queryError,
    isError,
    isFetching,
    dataUpdatedAt: updatedAt,
    refetch: handleRefresh,
  });

  return (
    <WidgetShell
      title={t('widget.vehicleSpecs', 'Vehicle specs')}
      icon={isCompact ? undefined : <FileText className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      dataState={dataState}
      error={queryError && !hasAnyData ? String(queryError) : null}
      updatedAt={updatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      {hasAnyData ? (
        <FadeIn>
          {isCompact ? (
            <CompactView specs={specs} configData={(configData ?? null) as Record<string, unknown> | null} t={t} />
          ) : (
            <WidgetDetailCard
              entries={entries}
              emptyMessage={t('widget.specs.noData', 'No specs available')}
              emptyIcon={<FileText className="h-5 w-5" />}
            />
          )}
        </FadeIn>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<FileText className="h-5 w-5" />}
          message={t('widget.specs.noData', 'No specs available')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}

/* ── Compact: 1-col layout — model/value centered ── */
function CompactView({
  specs,
  configData,
  t,
}: {
  specs: Record<string, unknown> | null;
  configData: Record<string, unknown> | null;
  t: (k: string, f: string) => string;
}) {
  const trim = asString(specs?.trim_badging) ?? asString(specs?.trim) ?? asString(configData?.trim) ?? '—';
  const base = asString(specs?.car_type) ?? asString(specs?.model) ?? asString(configData?.car_type) ?? '—';
  const model = base !== '—' && trim !== '—' && !base.toLowerCase().includes(trim.toLowerCase())
    ? `${base} ${trim}`
    : base;

  return (
    <WidgetBigNumber
      value={model}
      label={t('widget.specs.model', 'Model')}
      align="center"
      animated={false}
    />
  );
}

/** Safely extract a string from an unknown value */
function asString(val: unknown): string | null {
  if (val == null) return null;
  if (typeof val === 'string' && val.length > 0) return val;
  if (typeof val === 'number' && Number.isFinite(val)) return String(val);
  return null;
}

/** Read an energy value only when the payload identifies SI watt-hours. */
function asNumber(val: unknown): number | null {
  if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) return null;
  return val;
}
