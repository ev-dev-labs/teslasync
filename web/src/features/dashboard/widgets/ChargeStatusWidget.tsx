import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { Badge } from '@/components/ui';
import { deriveDataState, knownNumber } from '@/api/dataState';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI } from '@/lib/unitConversion';

import { WidgetShell } from './WidgetShell';
import { WidgetStatGrid } from './shared';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export default function ChargeStatusWidget({ vehicleId }: WidgetProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const vehiclesQuery = useVehicles();
  const { data: vehicles } = vehiclesQuery;
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const query = useVehicleState(id);
  const { data: stateData, isLoading, isFetching, isStale, isError, error, dataUpdatedAt, refetch } = query;
  /* SI-floor: state.rated_range and state.charge_rate arrive in METERS / m·h⁻¹.
   * convertDistanceFromSI handles the meters→user-unit conversion. */
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const state = stateData?.state;
  const vehiclesState = deriveDataState(vehiclesQuery);
  const sourceState = deriveDataState({
    ...query,
    data: stateData ?? (isLoading || isError || error ? undefined : null),
  }, { provenance: stateData?.live ? 'live' : 'cached', unavailable: state == null });
  const dataState = id > 0 ? sourceState : vehiclesState;
  const reading = (value: unknown, format: (value: number) => string) => {
    const number = knownNumber(value);
    return number == null ? '—' : format(number);
  };

  return (
    <WidgetShell
      title={t('widget.chargeStatusLive', 'Charge status')}
      loading={isLoading && !stateData}
      error={!stateData && isError ? String(error ?? 'Request failed') : null}
      dataState={dataState}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => { if (id > 0) void refetch(); else void vehiclesQuery.refetch(); }}
    >
      <div className="h-full flex flex-col justify-center">
        {state?.is_charging ? (
          <div className="min-w-0 space-y-3">
            <Badge variant="success" size="sm">{t('widget.charging', 'Charging')}</Badge>
            <WidgetStatGrid cols={2} stats={[
              { label: t('widget.power', 'Power'), value: reading(state.charger_power, value => `${fmtNumber(value)} kW`) },
              { label: t('widget.rate', 'Rate'), value: reading(state.charge_rate, value => `${fmtNumber(convertDistanceFromSI(value, distanceUnit))} ${distanceUnit}/h`) },
              { label: t('widget.battery', 'Battery'), value: reading(state.battery_level, value => `${fmtNumber(value)}%`) },
              { label: t('widget.timeToFull', 'Time to full'), value: reading(state.time_to_full_charge, value => value >= 0 ? `${fmtNumber(value)}h` : '—') },
            ]} />
          </div>
        ) : state ? (
          <div className="min-w-0 space-y-3">
            <Badge variant="neutral" size="sm">
              {state.is_charging === false ? t('widget.notCharging', 'Not charging') : t('widget.chargingSchedule.modeUnknown', 'Unknown')}
            </Badge>
            <WidgetStatGrid cols={2} stats={[
              { label: t('widget.battery', 'Battery'), value: reading(state.battery_level, value => `${fmtNumber(value)}%`) },
              { label: t('widget.range', 'Range'), value: reading(state.rated_range, value => `${fmtNumber(convertDistanceFromSI(value, distanceUnit))} ${distanceUnit}`) },
            ]} />
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
