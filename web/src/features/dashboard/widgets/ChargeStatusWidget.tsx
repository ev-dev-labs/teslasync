import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { Badge } from '@/components/ui';
import { deriveDataState, knownNumber } from '@/api/dataState';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { useDateFormat } from '@/hooks/useDateFormat';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { fmtNumber } from '@/lib/numberFormat';

import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid } from './shared';
import { ChargeBatteryPack, ChargeMeter, ChargeReadings, useVerifiedChargeActivity } from './instruments/ChargeInstruments';
import { dashboardTokens } from '../lib/dashboardTokens';
import type { WidgetProps } from './types';

/** Hours (float) → "2h 30m" / "45m"; negative or non-finite stays unknown. */
function formatTimeLeft(hours: number | null): string | null {
  if (hours == null || !Number.isFinite(hours) || hours < 0) return null;
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function ChargeStatusWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const vehiclesQuery = useVehicles();
  const { data: vehicles } = vehiclesQuery;
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const query = useVehicleState(id);
  const { data: stateData, isLoading, isFetching, isStale, isError, error, dataUpdatedAt, refetch } = query;
  /* SI-floor: state.rated_range and state.charge_rate arrive in METERS / m·h⁻¹.
   * convertDistanceFromSI handles the meters→user-unit conversion. */
  const { unitPrefs } = useUnits();
  const { formatTime } = useDateFormat();
  const distanceUnit = unitPrefs.distance;
  const state = stateData?.state;
  const vehiclesState = deriveDataState(vehiclesQuery);
  const sourceState = deriveDataState({
    ...query,
    data: stateData ?? (isLoading || isError || error ? undefined : null),
  }, { provenance: stateData?.live ? 'live' : 'cached', unavailable: state == null });
  const dataState = id > 0 ? sourceState : vehiclesState;

  const batteryLevel = knownNumber(state?.battery_level);
  const ratedRange = knownNumber(state?.rated_range);
  const chargerPower = knownNumber(state?.charger_power);
  const chargeRate = knownNumber(state?.charge_rate);
  const timeToFull = knownNumber(state?.time_to_full_charge);
  // charge_limit_soc may be present on extended state payloads (same source
  // BatteryGaugeWidget / BatteryLinearGaugeWidget read). Validate it is a
  // finite 0–100 number before use so a malformed field never leaks NaN.
  const chargeLimitRaw = (state as Record<string, unknown> | undefined)?.charge_limit_soc;
  const chargeLimit =
    typeof chargeLimitRaw === 'number' && Number.isFinite(chargeLimitRaw) && chargeLimitRaw >= 0 && chargeLimitRaw <= 100
      ? chargeLimitRaw
      : null;
  const active = useVerifiedChargeActivity(query);
  const isShort = size.rows <= 2;
  const headline =
    batteryLevel != null && chargeLimit != null
      ? `${fmtNumber(batteryLevel, 0)} → ${fmtNumber(chargeLimit, 0)}`
      : batteryLevel;
  const timeLeftText = formatTimeLeft(timeToFull);
  const doneAtText =
    timeToFull != null && Number.isFinite(timeToFull) && timeToFull >= 0
      ? formatTime(Date.now() + timeToFull * 3_600_000)
      : null;

  const meter = (
    <ChargeMeter
      value={batteryLevel}
      label={t('widget.battery', 'Battery')}
      marker={chargeLimit}
      markerLabel={chargeLimit != null ? `${t('widget.chargeLimit', 'Limit')} ${fmtNumber(chargeLimit, 0)}%` : undefined}
      markerTestId="charge-limit-marker"
      active={active}
    />
  );

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
      {state?.is_charging ? (
        <div className={isShort ? 'grid min-w-0 grid-cols-1 items-start gap-3 @sm:grid-cols-2' : 'flex min-w-0 flex-col gap-3'}>
          <div className={isShort ? 'flex min-w-0 flex-col gap-1' : 'flex min-w-0 flex-col gap-3'}>
          <div>
            <Badge variant="success" size="sm">{t('widget.charging', 'Charging')}</Badge>
          </div>
            <div className="flex min-w-0 items-center justify-between gap-2">
              <WidgetBigNumber value={headline} unit="%" animated={false} />
              <ChargeBatteryPack level={batteryLevel} active={active} className={isShort ? 'w-20' : 'w-24'} />
            </div>
            {meter}
          </div>
          <div className={isShort ? 'flex min-w-0 flex-col gap-1' : 'flex min-w-0 flex-col gap-3'}>
            <div className="text-right">
              {doneAtText && <div className="text-base font-semibold tabular-nums">{doneAtText}</div>}
              <div className={dashboardTokens.metricLabel}>
                {t('widget.timeToFull', 'Time to full')} {timeLeftText ?? '—'}
              </div>
            </div>
          <ChargeReadings short={isShort}>
          <WidgetStatGrid
            cols={3}
            stats={[
              /* VehicleService exposes charger_power in kW, unlike canonical signal-store watts. */
              { label: t('widget.power', 'Power'), value: chargerPower != null ? fmtNumber(chargerPower, 1) : null, unit: 'kW' },
              { label: t('widget.rate', 'Rate'), value: chargeRate != null ? fmtNumber(convertDistanceFromSI(chargeRate, distanceUnit), 0) : null, unit: `${distanceUnit}/h` },
              { label: t('widget.range', 'Range'), value: ratedRange != null ? fmtNumber(convertDistanceFromSI(ratedRange, distanceUnit), 0) : null, unit: distanceUnit },
            ]}
          />
          </ChargeReadings>
          </div>
        </div>
      ) : state ? (
        <div className={isShort ? 'grid min-w-0 grid-cols-1 items-center gap-3 @sm:grid-cols-2' : 'flex min-w-0 flex-col gap-3'}>
          <div className={isShort ? 'flex min-w-0 flex-col gap-1' : 'flex min-w-0 flex-col gap-3'}>
          <div>
            <Badge variant="neutral" size="sm">
              {state.is_charging === false ? t('widget.notCharging', 'Not charging') : t('widget.chargingSchedule.modeUnknown', 'Unknown')}
            </Badge>
          </div>
          <div className="flex min-w-0 items-center justify-between gap-3">
            <WidgetBigNumber value={batteryLevel} unit="%" decimals={0} animated={false} />
            <ChargeBatteryPack level={batteryLevel} className={isShort ? 'w-20' : undefined} />
          </div>
          {meter}
          </div>
          <ChargeReadings short={isShort}>
          <WidgetStatGrid
            stats={[
              { label: t('widget.range', 'Range'), value: ratedRange != null ? fmtNumber(convertDistanceFromSI(ratedRange, distanceUnit), 0) : null, unit: distanceUnit },
            ]}
          />
          </ChargeReadings>
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Zap className="h-5 w-5" />}
          message={t('widget.noChargeData', 'No charge data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
