import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, BatteryCharging, Zap, Plug } from 'lucide-react';
import { EmptyState, Skeleton } from '@/components/feedback';
import { DataProvenanceBadge } from '@/components/data-display';
import { knownNumber } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { WidgetShell } from './WidgetShell';
import { WidgetFlowDiagram, type FlowNode, type FlowArrow } from './shared';
import type { WidgetProps } from './types';

const REFRESH_INTERVAL = 5_000;

export default function EnergyFlowWidget({ vehicleId, config }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles, isLoading: vehiclesLoading, error: vehiclesError } = useVehicles();
  const id = vehicleId ?? config?.vehicleId ?? vehicles?.[0]?.id ?? 0;
  const query = useVehicleState(id, { refetchInterval: REFRESH_INTERVAL });
  const { data: stateData, error, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = query;
  const { formatPower } = useUnits();
  const state = stateData?.state;

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const verified = stateData?.verifiedFields;
  const power = verified && !verified.includes('power') ? null : knownNumber(state?.power);
  const isConsuming = power != null && power > 0;
  const isRegen = power != null && power < 0;
  const absPower = power == null ? null : Math.abs(power);
  const isCharging = (!verified || verified.includes('is_charging')) && (state?.is_charging ?? false);
  const chargerPower = verified && !verified.includes('charger_power') ? null : knownNumber(state?.charger_power);
  const batteryLevel = verified && !verified.includes('battery_level') ? null : knownNumber(state?.battery_level);
  const loading = isLoading || (vehiclesLoading && !id);
  const queryError = error ?? (!id ? vehiclesError : null);
  const dataState = useDataState({
    ...query,
    data: state ?? (loading || queryError || isError ? undefined : null),
    error: queryError,
    isError,
    isFetching,
    dataUpdatedAt,
    refetch,
  }, {
    provenance: stateData?.live ? 'live' : 'cached',
    partial: !!state && (power == null || batteryLevel == null || (isCharging && chargerPower == null)),
  });

  const nodes = useMemo<FlowNode[]>(() => {
    const result: FlowNode[] = [
      {
        id: 'battery',
        label: t('widget.battery', 'Battery'),
        value: batteryLevel ?? 0,
        formattedValue: batteryLevel == null ? '—' : `${batteryLevel}%`,
        icon: <BatteryCharging className="h-2.5 w-2.5 text-emerald-400" />,
        position: 'left',
      },
      {
        id: 'motor',
        label: isConsuming
          ? t('widget.consuming', 'Consuming')
          : isRegen
            ? t('widget.regenerating', 'Regenerating')
            : power == null ? t('hero.unknownStatus', 'Unknown') : t('widget.standby', 'Standby'),
        value: absPower ?? 0,
        // VehicleState still exposes kW; the SI-only formatter accepts W.
        formattedValue: formatPower(absPower == null ? null : absPower * 1000, { precision: 1 }),
        icon: <Zap className="h-2.5 w-2.5 text-purple-400" />,
        position: 'right',
      },
    ];

    if (isCharging) {
      result.push({
        id: 'charger',
        label: t('widget.charger', 'Charger'),
        value: chargerPower ?? 0,
        formattedValue: formatPower(chargerPower == null ? null : chargerPower * 1000, { precision: 1 }),
        icon: <Plug className="h-2.5 w-2.5 text-amber-400" />,
        position: 'top',
      });
    }

    return result;
  }, [batteryLevel, power, absPower, isConsuming, isRegen, isCharging, chargerPower, formatPower, t]);

  const arrows = useMemo<FlowArrow[]>(() => {
    const result: FlowArrow[] = [
      {
        from: 'battery',
        to: 'motor',
        value: isConsuming ? absPower ?? 0 : 0,
        active: isConsuming,
        color: 'text-cyan-400',
      },
      {
        from: 'motor',
        to: 'battery',
        value: isRegen ? absPower ?? 0 : 0,
        active: isRegen,
        color: 'text-emerald-400',
      },
    ];

    if (isCharging) {
      result.push({
        from: 'charger',
        to: 'battery',
        value: chargerPower ?? 0,
        active: chargerPower != null && chargerPower > 0,
        color: 'text-amber-400',
      });
    }

    return result;
  }, [absPower, isConsuming, isRegen, isCharging, chargerPower]);

  return (
    <WidgetShell
      title={t('widget.energyFlow', 'Energy flow')}
      icon={<Activity className="h-3.5 w-3.5" />}
      status={<DataProvenanceBadge provenance={dataState.provenance} status={dataState.status} />}
      loading={loading}
      loadingContent={<Skeleton className="h-full min-h-24 rounded-shape-sm" />}
      dataState={dataState}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      {state ? (
        <div className="mx-auto h-full min-h-0 w-full max-w-72 px-5 py-7 [&>svg]:overflow-visible [&_text]:fill-[var(--text-secondary)] [&_circle]:fill-[var(--surface-2)] [&_circle]:stroke-[var(--border-default)] motion-reduce:[&_.flow-active]:animate-none">
          <WidgetFlowDiagram
            nodes={nodes}
            arrows={arrows}
            ariaLabel={`${t('widget.energyFlow', 'Energy flow')}: ${nodes.map((node) => `${node.label} ${node.formattedValue}`).join(', ')}; ${arrows.filter((arrow) => arrow.active).map((arrow) => `${nodes.find((node) => node.id === arrow.from)?.label} → ${nodes.find((node) => node.id === arrow.to)?.label}`).join(', ')}`}
            emptyMessage={t('widget.noEnergyData', 'No energy data available')}
          />
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Activity className="h-5 w-5" />}
          message={t('widget.noEnergyData', 'No energy data available')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
