import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useVehicles, useVehicleSpecs, useVehicleOptions, useVehicleConfigLatest } from '@/api/hooks/useVehicles';
import { WidgetShell } from './WidgetShell';
import { WidgetDetailCard, type DetailEntry } from './shared';
import type { WidgetProps } from './types';

export default function VehicleSpecsWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
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
    data: optionsEnvelope,
    isLoading: optionsLoading,
    isFetching: optionsFetching,
    isStale: optionsStale,
    isError: optionsError,
    error: optionsErrorObj,
    dataUpdatedAt: optionsUpdatedAt,
    refetch: refetchOptions,
  } = useVehicleOptions(stringId);

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

  const isLoading = specsLoading || optionsLoading || configLoading;
  const isFetching = specsFetching || optionsFetching || configFetching;
  const isStale = specsStale || optionsStale || configStale;
  const isError = specsError || optionsError || configError;
  const queryError = specsErrorObj ?? optionsErrorObj ?? configErrorObj ?? null;
  const updatedAt = Math.max(specsUpdatedAt ?? 0, optionsUpdatedAt ?? 0, configUpdatedAt ?? 0);

  const specs = specsEnvelope?.data ?? null;
  const options = optionsEnvelope?.data ?? null;

  const isCompact = size.cols <= 1;

  const entries: DetailEntry[] = useMemo(() => {
    const items: DetailEntry[] = [];

    // Model from specs
    const model = asString(specs?.car_type) ?? asString(specs?.model) ?? asString(configData?.car_type);
    items.push({
      label: t('widget.specs.model', 'Model'),
      value: model ?? '—',
    });

    // Trim from specs or config
    const trim = asString(specs?.trim_badging) ?? asString(specs?.trim) ?? asString(configData?.trim);
    items.push({
      label: t('widget.specs.trim', 'Trim'),
      value: trim ?? '—',
    });

    // Paint color
    const paint = asString(specs?.exterior_color) ?? asString(configData?.exterior_color);
    items.push({
      label: t('widget.specs.paint', 'Paint Color'),
      value: paint ?? '—',
    });

    // Wheels
    const wheels = asString(specs?.wheel_type) ?? asString(configData?.wheel_type);
    items.push({
      label: t('widget.specs.wheels', 'Wheels'),
      value: wheels ?? '—',
    });

    // Interior
    const interior = asString(specs?.interior) ?? asString(specs?.interior_color);
    items.push({
      label: t('widget.specs.interior', 'Interior'),
      value: interior ?? '—',
    });

    // Aux battery from specs (not on config snapshot type)
    const auxBattery = asString(specs?.aux_battery_type);
    items.push({
      label: t('widget.specs.auxBattery', 'Aux Battery'),
      value: auxBattery ?? '—',
    });

    // Car version from config
    const carVersion = asString(configData?.version) ?? asString(specs?.car_version);
    items.push({
      label: t('widget.specs.carVersion', 'Car Version'),
      value: carVersion ?? '—',
      mono: true,
    });

    // Options as badges (decoded option codes)
    if (options && typeof options === 'object') {
      const optionKeys = Object.keys(options);
      for (const key of optionKeys.slice(0, isCompact ? 0 : 8)) {
        const decoded = asString(options[key]) ?? key;
        items.push({
          label: key,
          value: decoded,
          badge: { text: t('widget.specs.option', 'Option'), variant: 'neutral' as const },
        });
      }
    }

    return items;
  }, [specs, options, configData, isCompact, t]);

  const hasOptions = options != null && Object.keys(options).length > 0;
  const hasAnyData = specs != null || hasOptions || configData != null;

  const handleRefresh = useCallback(() => {
    refetchSpecs();
    refetchOptions();
    refetchConfig();
  }, [refetchSpecs, refetchOptions, refetchConfig]);

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.vehicleSpecs', 'Vehicle Specs')}
      icon={isCompact ? undefined : <FileText className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
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

/* ── Compact: 1-col layout — Model + Trim centered ── */
function CompactView({
  specs,
  configData,
  t,
}: {
  specs: Record<string, unknown> | null;
  configData: Record<string, unknown> | null;
  t: (k: string, f: string) => string;
}) {
  const model = asString(specs?.car_type) ?? asString(specs?.model) ?? asString(configData?.car_type) ?? '—';
  const trim = asString(specs?.trim_badging) ?? asString(specs?.trim) ?? asString(configData?.trim) ?? '—';

  return (
    <div className="h-full flex flex-col items-center justify-center gap-1.5 px-2">
      <FileText className="h-5 w-5 text-neon-cyan" />
      <span className="text-sm font-bold text-[var(--text-primary)] truncate max-w-full text-center">
        {model}
      </span>
      <span className="text-xs text-[var(--text-secondary)] truncate max-w-full text-center">
        {t('widget.specs.trim', 'Trim')}: {trim}
      </span>
    </div>
  );
}

/** Safely extract a string from an unknown value */
function asString(val: unknown): string | null {
  if (val == null) return null;
  if (typeof val === 'string' && val.length > 0) return val;
  if (typeof val === 'number' && Number.isFinite(val)) return String(val);
  return null;
}
