import { useTranslation } from 'react-i18next';
import { Activity, BatteryCharging, Zap, ArrowDown, ArrowUp } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { Skeleton, EmptyState } from '@/components/feedback';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { fmtNumber } from '@/lib/numberFormat';
import type { WidgetProps } from './types';

export default function EnergyFlowWidget({ vehicleId }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { data: stateData, isLoading } = useVehicleState(id, { refetchInterval: 5_000 });
  const state = stateData?.state;

  const power = state?.power ?? 0;
  const isConsuming = power > 0;
  const isRegen = power < 0;
  const absPower = Math.abs(power);

  return (
    <GlassPanel className="h-full flex flex-col p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5 mb-3">
        <Activity className="h-3.5 w-3.5 text-neon-cyan" />
        {t('widget.energyFlow', 'Energy Flow')}
      </h3>
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Skeleton className="h-32 w-32 rounded-full" />
        </div>
      ) : state ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          {/* Battery block */}
          <div className="flex flex-col items-center">
            <BatteryCharging className="h-8 w-8 text-neon-green mb-1" />
            <span className="text-2xl font-bold text-[var(--text-primary)]">
              {state.battery_level}%
            </span>
            <span className="text-[10px] text-[var(--text-muted)]">
              {t('widget.battery', 'Battery')}
            </span>
          </div>

          {/* Flow arrow */}
          <div className="flex items-center gap-2">
            {isConsuming ? (
              <>
                <ArrowUp className="h-5 w-5 text-neon-red animate-bounce" />
                <span className="text-sm font-bold text-neon-red">
                  {fmtNumber(absPower, 1)} kW
                </span>
              </>
            ) : isRegen ? (
              <>
                <ArrowDown className="h-5 w-5 text-neon-green animate-bounce" />
                <span className="text-sm font-bold text-neon-green">
                  {fmtNumber(absPower, 1)} kW
                </span>
              </>
            ) : (
              <span className="text-sm text-[var(--text-muted)]">
                {t('widget.idle', 'Idle')}
              </span>
            )}
          </div>

          {/* Motor block */}
          <div className="flex flex-col items-center">
            <Zap className="h-6 w-6 text-neon-purple mb-1" />
            <span className="text-xs text-[var(--text-muted)]">
              {isConsuming
                ? t('widget.consuming', 'Consuming')
                : isRegen
                  ? t('widget.regenerating', 'Regenerating')
                  : t('widget.standby', 'Standby')}
            </span>
          </div>

          {/* Charge info if charging */}
          {state.is_charging && (
            <div className="text-center mt-2 p-2 rounded-lg bg-neon-green/5 border border-neon-green/10 w-full">
              <span className="text-xs text-neon-green font-medium">
                ⚡ {fmtNumber(state.charger_power)} kW ·{' '}
                {state.time_to_full_charge > 0
                  ? `${fmtNumber(state.time_to_full_charge, 1)}h left`
                  : t('widget.almostDone', 'Almost done')}
              </span>
            </div>
          )}
        </div>
      ) : (
        <EmptyState
          icon={<Activity className="h-5 w-5" />}
          message={t('widget.noEnergyData', 'No energy data available')}
          className="py-4"
        />
      )}
    </GlassPanel>
  );
}
