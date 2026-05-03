import { useTranslation } from 'react-i18next';
import { Zap, BatteryCharging } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useSettings } from '@/hooks/useSettings';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

export default function ChargeStatusWidget({ vehicleId }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { data: stateData, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = useVehicleState(id);
  const { convertDistance, distanceUnit } = useSettings();
  const state = stateData?.state;

  return (
    <WidgetShell
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      <div className="h-full flex flex-col justify-center">
        {state?.is_charging ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <BatteryCharging className="h-4 w-4 text-neon-green animate-pulse" />
              <span className="text-sm font-semibold text-emerald-300">
                {t('widget.charging', 'Charging')}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] text-[var(--text-muted)]">{t('widget.power', 'Power')}</p>
                <p className="text-sm font-bold text-emerald-300">{fmtNumber(state.charger_power)} kW</p>
              </div>
              <div>
                <p className="text-[10px] text-[var(--text-muted)]">{t('widget.rate', 'Rate')}</p>
                <p className="text-sm font-bold text-[var(--text-primary)]">
                  {fmtInt(convertDistance(state.charge_rate ?? 0))} {distanceUnit}/h
                </p>
              </div>
              <div>
                <p className="text-[10px] text-[var(--text-muted)]">{t('widget.battery', 'Battery')}</p>
                <p className="text-sm font-bold text-[var(--text-primary)]">{state.battery_level}%</p>
              </div>
              <div>
                <p className="text-[10px] text-[var(--text-muted)]">
                  {t('widget.timeToFull', 'Time to Full')}
                </p>
                <p className="text-sm font-bold text-[var(--text-primary)]">
                  {state.time_to_full_charge > 0
                    ? `${fmtNumber(state.time_to_full_charge, 1)}h`
                    : '—'}
                </p>
              </div>
            </div>
          </div>
        ) : state ? (
          <div className="flex flex-col items-center justify-center text-center">
            <Zap className="h-6 w-6 text-[var(--text-muted)] mb-2" />
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {t('widget.notCharging', 'Not Charging')}
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              {state.battery_level}% · {fmtNumber(convertDistance(state.rated_range), 0)} {distanceUnit}
            </p>
          </div>
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<Zap className="h-5 w-5" />}
            message={t('widget.noChargeData', 'No charge data')}
            className="py-4"
          />
        )}
      </div>
    </WidgetShell>
  );
}
