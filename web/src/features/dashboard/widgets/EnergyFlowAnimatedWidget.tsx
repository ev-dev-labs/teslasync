import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Battery, Zap, Plug } from 'lucide-react';
import { EmptyState, Skeleton } from '@/components/feedback';
import { knownNumber } from '@/api/dataState';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid, WidgetFlowDiagram, type FlowNode, type FlowArrow } from './shared';
import type { WidgetProps } from './types';

/* ── Constants ── */

const CYAN = 'text-cyan-400';
const GREEN = 'text-emerald-400';
const AMBER = 'text-amber-400';

/* ── Main widget ────────────────────────────────────────────── */

export default function EnergyFlowAnimatedWidget({ vehicleId, size, config }: WidgetProps) {
  const { fmtNumber } = useNumberFormatting();
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
  const isConsuming = power != null && power > 0;
  const isRegen = power != null && power < 0;
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
    ? t('widget.consuming', 'Consuming')
    : isRegen
      ? t('widget.regenerating', 'Regenerating')
      : power == null
        ? t('hero.unknownStatus', 'Unknown')
        : t('widget.standby', 'Standby');
  const driveValue = formatPower(absPower);
  // charger_power still uses kW; pack power is already canonical W.
  const chargerValue = formatPower(chargerPower == null ? null : chargerPower * 1000);

  const handleRefresh = useCallback(() => { void refetch(); }, [refetch]);

  const nodes = useMemo<FlowNode[]>(() => {
    const result: FlowNode[] = [];
    if (isCharging) {
      result.push({
        id: 'charger',
        label: t('widget.wallConnector.title', 'Wall connector'),
        value: chargerPower ?? 0,
        formattedValue: '',
        icon: <Plug className="h-2.5 w-2.5" />,
        position: 'left',
      });
    }
    result.push(
      {
        id: 'battery',
        label: t('widget.energyFlowAnimated.battery', 'Battery'),
        value: batteryLevel ?? 0,
        formattedValue: batteryLevel == null ? '—' : `${fmtNumber(batteryLevel)}%`,
        icon: <Battery className="h-2.5 w-2.5" />,
        position: 'center',
      },
      {
        id: 'drive',
        label: driveLabel,
        value: absPower ?? 0,
        formattedValue: '',
        icon: <Zap className="h-2.5 w-2.5" />,
        position: 'right',
      },
    );
    return result;
  }, [batteryLevel, absPower, chargerPower, driveLabel, isCharging, t, fmtNumber]);

  const arrows = useMemo<FlowArrow[]>(() => {
    const result: FlowArrow[] = [
      {
        from: 'battery',
        to: 'drive',
        value: isConsuming ? absPower ?? 0 : 0,
        active: isConsuming,
        label: isConsuming ? driveValue : undefined,
        color: CYAN,
      },
      {
        from: 'drive',
        to: 'battery',
        value: isRegen ? absPower ?? 0 : 0,
        active: isRegen,
        label: isRegen ? driveValue : undefined,
        color: GREEN,
      },
    ];
    if (isCharging) {
      result.push({
        from: 'charger',
        to: 'battery',
        value: chargerPower ?? 0,
        active: chargerPower != null && chargerPower > 0,
        label: chargerPower != null && chargerPower > 0 ? chargerValue : undefined,
        color: AMBER,
      });
    }
    return result;
  }, [absPower, chargerPower, isConsuming, isRegen, isCharging, driveValue, chargerValue]);

  return (
    <WidgetShell
      title={t('widget.energyFlowAnimated.title', 'Energy flow')}
      icon={<Zap className="h-3.5 w-3.5 text-cyan-400" />}
      status={undefined}
      loading={loading}
      loadingContent={<Skeleton className="h-full min-h-16 rounded-shape-sm" />}
      dataState={dataState}
      updatedAt={dataUpdatedAt}
      refreshIntervalMs={5_000}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      {state ? (
        isCompact ? (
          <div className="flex h-full min-w-0 flex-col gap-2">
            <WidgetBigNumber value={batteryLevel == null ? null : `${fmtNumber(batteryLevel)}%`} align="center" />
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
