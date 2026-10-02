import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Battery, Zap, Plug } from 'lucide-react';
import { EmptyState, Skeleton } from '@/components/feedback';
import { DataProvenanceBadge } from '@/components/data-display';
import { knownNumber } from '@/api/dataState';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid, WidgetFlowDiagram, type FlowNode, type FlowArrow } from './shared';
import type { WidgetProps } from './types';

/* ── Constants ── */

const CYAN = 'text-cyan-400';
const GREEN = 'text-emerald-400';
const AMBER = 'text-amber-400';

/* ── Main widget ────────────────────────────────────────────── */

export default function EnergyFlowAnimatedWidget({ vehicleId, size, config }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { formatPower } = useUnits();
  const { data: vehicles, isLoading: vehiclesLoading, error: vehiclesError } = useVehicles();
  const id = vehicleId ?? config?.vehicleId ?? vehicles?.[0]?.id ?? 0;
  const query = useVehicleState(id, { refetchInterval: 5_000 });
  const { data: stateData, isLoading, isFetching, isStale, isError, error, dataUpdatedAt, refetch } = query;
  const state = stateData?.state;

  const verified = stateData?.verifiedFields;
  const power = verified && !verified.includes('power') ? null : knownNumber(state?.power);
  const chargerPower = verified && !verified.includes('charger_power') ? null : knownNumber(state?.charger_power);
  const batteryLevel = verified && !verified.includes('battery_level') ? null : knownNumber(state?.battery_level);
  const isCharging = (!verified || verified.includes('is_charging')) && (state?.is_charging ?? false);
  const isConsuming = power != null && power > 0.5;
  const isRegen = power != null && power < -0.5;
  const absPower = power == null ? null : Math.abs(power);
  const loading = isLoading || (!id && vehiclesLoading);
  const queryError = error ?? (!id ? vehiclesError : null);
  const dataState = useDataState({
    ...query,
    data: state ?? (loading || queryError || isError ? undefined : null),
    error: queryError,
  }, {
    provenance: stateData?.live ? 'live' : 'cached',
    partial: !!state && (power == null || batteryLevel == null || (isCharging && chargerPower == null)),
  });

  const isCompact = size.cols < 2;
  const driveLabel = isConsuming
    ? t('widget.energyFlowAnimated.drive', 'Drive')
    : isRegen
      ? t('widget.energyFlowAnimated.regen', 'Regen')
      : power == null
        ? t('hero.unknownStatus', 'Unknown')
        : t('widget.energyFlowAnimated.idle', 'Idle');
  // The established VehicleState wire contract uses kW, unlike site snapshots.
  const driveValue = formatPower(absPower == null ? null : absPower * 1000, { precision: 1 });
  const chargerValue = formatPower(chargerPower == null ? null : chargerPower * 1000, { precision: 1 });

  const nodes = useMemo<FlowNode[]>(() => [
    {
      id: 'battery',
      label: t('widget.energyFlowAnimated.battery', 'Battery'),
      value: batteryLevel ?? 0,
      formattedValue: batteryLevel == null ? '—' : `${batteryLevel}%`,
      icon: <Battery className="h-2.5 w-2.5" />,
      position: 'left',
    },
    {
      id: 'drive',
      label: driveLabel,
      value: absPower ?? 0,
      formattedValue: driveValue,
      icon: <Zap className="h-2.5 w-2.5" />,
      position: 'right',
    },
    {
      id: 'charger',
      label: t('widget.energyFlowAnimated.charger', 'Charger'),
      value: chargerPower ?? 0,
      formattedValue: isCharging ? chargerValue : '—',
      icon: <Plug className="h-2.5 w-2.5" />,
      position: 'top',
    },
  ], [batteryLevel, absPower, chargerPower, driveLabel, driveValue, chargerValue, isCharging, t]);

  const arrows = useMemo<FlowArrow[]>(() => [
    {
      from: 'battery',
      to: 'drive',
      value: isConsuming ? absPower ?? 0 : 0,
      active: isConsuming,
      color: CYAN,
    },
    {
      from: 'drive',
      to: 'battery',
      value: isRegen ? absPower ?? 0 : 0,
      active: isRegen,
      color: GREEN,
    },
    {
      from: 'charger',
      to: 'battery',
      value: isCharging ? chargerPower ?? 0 : 0,
      active: isCharging && chargerPower != null && chargerPower > 0,
      color: AMBER,
    },
  ], [absPower, chargerPower, isConsuming, isRegen, isCharging]);

  return (
    <WidgetShell
      title={t('widget.energyFlowAnimated.title', 'Energy flow')}
      icon={<Zap className="h-3.5 w-3.5 text-cyan-400" />}
      status={!isCompact && <DataProvenanceBadge provenance={dataState.provenance} status={dataState.status} />}
      loading={loading}
      loadingContent={<Skeleton className="h-full min-h-16 rounded-shape-sm" />}
      dataState={dataState}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {state ? (
        isCompact ? (
          <div className="flex h-full min-w-0 flex-col gap-2">
            <WidgetBigNumber value={batteryLevel == null ? null : `${batteryLevel}%`} align="center" />
            <WidgetStatGrid compact stats={[
              ...(isCharging ? [{ label: t('widget.energyFlowAnimated.charger', 'Charger'), value: chargerValue, icon: <Plug className="size-3.5" /> }] : []),
              ...(!isCharging || isConsuming || isRegen ? [{ label: driveLabel, value: driveValue, icon: <Zap className="size-3.5" /> }] : []),
            ]} />
          </div>
        ) : (
          <div className="mx-auto h-full min-h-0 w-full max-w-72 px-5 py-7 [&>svg]:overflow-visible [&_text]:fill-[var(--text-secondary)] [&_circle]:fill-[var(--surface-2)] [&_circle]:stroke-[var(--border-default)] motion-reduce:[&_.flow-active]:animate-none">
            <WidgetFlowDiagram
              nodes={nodes}
              arrows={arrows}
              ariaLabel={`${t('widget.energyFlowAnimated.title', 'Energy flow')}: ${nodes.map((node) => `${node.label} ${node.formattedValue}`).join(', ')}`}
              emptyMessage={t('widget.energyFlowAnimated.noData', 'No energy data available')}
            />
          </div>
        )
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Zap className="h-5 w-5" />}
          message={t('widget.energyFlowAnimated.noData', 'No energy data available')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
