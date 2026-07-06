import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, BatteryCharging, Zap, Plug } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { fmtNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetFlowDiagram, type FlowNode, type FlowArrow } from './shared';
import type { WidgetProps } from './types';

const REFRESH_INTERVAL = 5_000;

export default function EnergyFlowWidget({ vehicleId }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles, isLoading: vehiclesLoading } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { data: stateData, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = useVehicleState(id, { refetchInterval: REFRESH_INTERVAL });
  const state = stateData?.state;

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const power = state?.power ?? 0;
  const isConsuming = power > 0;
  const isRegen = power < 0;
  const absPower = Math.abs(power);
  const isCharging = state?.is_charging ?? false;
  const chargerPower = state?.charger_power ?? 0;
  const batteryLevel = state?.battery_level ?? 0;

  const nodes = useMemo<FlowNode[]>(() => {
    const result: FlowNode[] = [
      {
        id: 'battery',
        label: t('widget.battery', 'Battery'),
        value: batteryLevel,
        formattedValue: `${batteryLevel}%`,
        icon: <BatteryCharging className="h-2.5 w-2.5 text-emerald-400" />,
        position: 'left',
      },
      {
        id: 'motor',
        label: isConsuming
          ? t('widget.consuming', 'Consuming')
          : isRegen
            ? t('widget.regenerating', 'Regenerating')
            : t('widget.standby', 'Standby'),
        value: absPower,
        formattedValue: absPower > 0 ? `${fmtNumber(absPower, 1)} kW` : '—',
        icon: <Zap className="h-2.5 w-2.5 text-purple-400" />,
        position: 'right',
      },
    ];

    if (isCharging) {
      result.push({
        id: 'charger',
        label: t('widget.charger', 'Charger'),
        value: chargerPower,
        formattedValue: `${fmtNumber(chargerPower, 1)} kW`,
        icon: <Plug className="h-2.5 w-2.5 text-amber-400" />,
        position: 'top',
      });
    }

    return result;
  }, [batteryLevel, absPower, isConsuming, isRegen, isCharging, chargerPower, t]);

  const arrows = useMemo<FlowArrow[]>(() => {
    const result: FlowArrow[] = [
      {
        from: 'battery',
        to: 'motor',
        value: isConsuming ? absPower : 0,
        active: isConsuming,
        color: 'text-cyan-400',
      },
      {
        from: 'motor',
        to: 'battery',
        value: isRegen ? absPower : 0,
        active: isRegen,
        color: 'text-emerald-400',
      },
    ];

    if (isCharging) {
      result.push({
        from: 'charger',
        to: 'battery',
        value: chargerPower,
        active: true,
        color: 'text-amber-400',
      });
    }

    return result;
  }, [absPower, isConsuming, isRegen, isCharging, chargerPower]);

  return (
    <WidgetShell
      title={t('widget.energyFlow', 'Energy Flow')}
      icon={<Activity className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading || vehiclesLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      {state ? (
        <WidgetFlowDiagram
          nodes={nodes}
          arrows={arrows}
          emptyMessage={t('widget.noEnergyData', 'No energy data available')}
        />
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
