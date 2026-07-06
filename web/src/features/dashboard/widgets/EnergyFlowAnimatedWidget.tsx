import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Battery, Zap, Plug } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { fmtNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetFlowDiagram, type FlowNode, type FlowArrow } from './shared';
import type { WidgetProps } from './types';

/* ── Compact fallback (1-column / small) ────────────────────── */

function CompactView({ power, chargerPower, isCharging, batteryLevel, t }: {
  power: number;
  chargerPower: number;
  isCharging: boolean;
  batteryLevel: number;
  t: (key: string, fallback: string) => string;
}) {
  const isConsuming = power > 0.5;
  const isRegen = power < -0.5;

  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 py-2">
      <div className="text-xl font-bold text-[var(--text-primary)]">{batteryLevel}%</div>
      {isCharging && (
        <div className="flex items-center gap-1 text-xs text-amber-400">
          <Plug className="h-3 w-3" />
          <span>{fmtNumber(chargerPower, 1)} kW</span>
        </div>
      )}
      {isConsuming && (
        <div className="flex items-center gap-1 text-xs text-cyan-400">
          <Zap className="h-3 w-3" />
          <span>{fmtNumber(power, 1)} kW</span>
        </div>
      )}
      {isRegen && (
        <div className="flex items-center gap-1 text-xs text-emerald-400">
          <Battery className="h-3 w-3" />
          <span>{fmtNumber(Math.abs(power), 1)} kW</span>
        </div>
      )}
      {!isConsuming && !isRegen && !isCharging && (
        <span className="text-xs text-[var(--text-muted)]">{t('widget.energyFlowAnimated.idle', 'Idle')}</span>
      )}
    </div>
  );
}

/* ── Constants ── */

const CYAN = 'text-cyan-400';
const GREEN = 'text-emerald-400';
const AMBER = 'text-amber-400';

/* ── Main widget ────────────────────────────────────────────── */

export default function EnergyFlowAnimatedWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles, isLoading: vehiclesLoading } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { data: stateData, isLoading, isFetching, isStale, isError, error, dataUpdatedAt, refetch } = useVehicleState(id, { refetchInterval: 5_000 });
  const state = stateData?.state;

  const power = state?.power ?? 0;
  const chargerPower = state?.charger_power ?? 0;
  const batteryLevel = state?.battery_level ?? 0;
  const isCharging = state?.is_charging ?? false;
  const isConsuming = power > 0.5;
  const isRegen = power < -0.5;
  const absPower = Math.abs(power);

  const isCompact = size.cols < 2;

  const nodes = useMemo<FlowNode[]>(() => [
    {
      id: 'battery',
      label: t('widget.energyFlowAnimated.battery', 'Battery'),
      value: batteryLevel,
      formattedValue: `${batteryLevel}%`,
      icon: <Battery className="h-2.5 w-2.5" />,
      position: 'left',
    },
    {
      id: 'drive',
      label: isConsuming
        ? t('widget.energyFlowAnimated.drive', 'Drive')
        : isRegen
          ? t('widget.energyFlowAnimated.regen', 'Regen')
          : t('widget.energyFlowAnimated.idle', 'Idle'),
      value: absPower,
      formattedValue: isConsuming || isRegen ? `${fmtNumber(absPower, 1)} kW` : '—',
      icon: <Zap className="h-2.5 w-2.5" />,
      position: 'right',
    },
    {
      id: 'charger',
      label: t('widget.energyFlowAnimated.charger', 'Charger'),
      value: chargerPower,
      formattedValue: isCharging ? `${fmtNumber(chargerPower, 0)} kW` : '—',
      icon: <Plug className="h-2.5 w-2.5" />,
      position: 'top',
    },
  ], [batteryLevel, absPower, chargerPower, isConsuming, isRegen, isCharging, t]);

  const arrows = useMemo<FlowArrow[]>(() => [
    {
      from: 'battery',
      to: 'drive',
      value: isConsuming ? absPower : 0,
      active: isConsuming,
      color: CYAN,
    },
    {
      from: 'drive',
      to: 'battery',
      value: isRegen ? absPower : 0,
      active: isRegen,
      color: GREEN,
    },
    {
      from: 'charger',
      to: 'battery',
      value: isCharging ? chargerPower : 0,
      active: isCharging,
      color: AMBER,
    },
  ], [absPower, chargerPower, isConsuming, isRegen, isCharging]);

  return (
    <WidgetShell
      title={t('widget.energyFlowAnimated.title', 'Energy Flow')}
      icon={<Zap className="h-3.5 w-3.5 text-cyan-400" />}
      // Fold the vehicle-list fetch into the loading state so the initial load
      // shows the shell skeleton instead of flashing the "No energy data"
      // empty state while the vehicle id is still resolving.
      loading={isLoading || vehiclesLoading}
      // Surface a genuine initial-load failure (no state yet) as a real error
      // panel instead of the misleading "No energy data available" empty state.
      // With cached state present, a background-refetch error stays a subtle
      // freshness signal so valid data is never blanked out.
      error={isError && !state ? String(error ?? t('widget.energyFlowAnimated.error', 'Unable to load energy data')) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
      noPadding
    >
      {state ? (
        isCompact ? (
          <CompactView
            power={power}
            chargerPower={chargerPower}
            isCharging={isCharging}
            batteryLevel={batteryLevel}
            t={t}
          />
        ) : (
          <div className="h-full w-full px-2 pb-2">
            <WidgetFlowDiagram
              nodes={nodes}
              arrows={arrows}
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
