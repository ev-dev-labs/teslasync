import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { deriveDataState, knownNumber } from '@/api/dataState';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { useDateFormat } from '@/hooks/useDateFormat';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { fmtNumber } from '@/lib/numberFormat';

import { WidgetShell } from './WidgetShell';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import { WidgetBigNumber, WidgetStatGrid } from './shared';
import { ChargeBatteryPack, ChargeMeter, ChargeReadings, useVerifiedChargeActivity } from './instruments/ChargeInstruments';
import { ChargeStatusSummary } from './instruments/ChargeStatusSummary';
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
  const chargeLimitRaw = state?.charge_limit_soc_pct;
  const chargeAmps = knownNumber(state?.charge_amps_a);
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
      showMarkerValue={false}
      markerLabel={chargeLimit != null ? `${t('widget.chargeLimit', 'Limit')} ${fmtNumber(chargeLimit, 0)}%` : undefined}
      markerTestId="charge-limit-marker"
      active={active}
    />
  );
  const summary = state && <ChargeStatusSummary charging={state.is_charging} active={active} limit={chargeLimit} />;
  const battery = <WidgetBigNumber value={state?.is_charging ? headline : batteryLevel}
    unit="%" decimals={state?.is_charging ? undefined : 0} animated={false} />;
  const pack = <ChargeBatteryPack level={batteryLevel} active={state?.is_charging ? active : undefined}
    className={isShort ? 'w-20' : state?.is_charging ? 'w-24' : undefined} />;
  const readings = (
    <ChargeReadings short={isShort}>
      <WidgetStatGrid cols={state?.is_charging ? 3 : undefined} stats={state?.is_charging ? [
        /* VehicleService exposes charger_power in kW, unlike canonical signal-store watts. */
        { label: t('widget.power', 'Power'), value: chargerPower != null ? fmtNumber(chargerPower, 1) : null, unit: 'kW' },
        { label: t('widget.chargingTelemetry.current', 'Current'), value: chargeAmps != null && chargeAmps >= 0 ? fmtNumber(chargeAmps, 1) : null, unit: 'A' },
        { label: t('widget.rate', 'Rate'), value: chargeRate != null ? fmtNumber(convertDistanceFromSI(chargeRate, distanceUnit), 0) : null, unit: `${distanceUnit}/h` },
        { label: t('widget.range', 'Range'), value: ratedRange != null ? fmtNumber(convertDistanceFromSI(ratedRange, distanceUnit), 0) : null, unit: distanceUnit },
        { label: t('widget.timeToFull', 'Time to full'), value: timeLeftText },
        { label: t('widget.doneAt', 'Done'), value: doneAtText },
      ] : [
        { label: t('widget.chargingTelemetry.current', 'Current'), value: chargeAmps != null && chargeAmps >= 0 ? fmtNumber(chargeAmps, 1) : null, unit: 'A' },
        { label: t('widget.range', 'Range'), value: ratedRange != null ? fmtNumber(convertDistanceFromSI(ratedRange, distanceUnit), 0) : null, unit: distanceUnit },
      ]} />
    </ChargeReadings>
  );
  const empty = (
    <EmptyState variant="informational" icon={<Zap className="h-5 w-5" />}
      message={t('widget.noChargeData', 'No charge data')} className="py-4" />
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
      <InstrumentPresentation family="ring" compact={isShort} headline={state ? battery : empty} context={summary}
        reading={{ value: batteryLevel, max: 100, label: t('widget.battery', 'Battery'), unit: '%' }}
        instrument={state ? <div className="min-w-0 space-y-3">{pack}{meter}</div> : undefined}
        details={state ? readings : undefined}>
      {state ? (
        <div className={isShort ? `grid min-w-0 grid-cols-1 ${state.is_charging ? 'items-start' : 'items-center'} gap-3 @sm:grid-cols-2` : 'flex min-w-0 flex-col gap-3'}>
          <div className={isShort ? 'flex min-w-0 flex-col gap-1' : 'flex min-w-0 flex-col gap-3'}>
          {summary}
          <div className={`flex min-w-0 items-center justify-between ${state.is_charging ? 'gap-2' : 'gap-3'}`}>
            {battery}
            {pack}
          </div>
          {meter}
          </div>
          {state.is_charging ? <div className={isShort ? 'flex min-w-0 flex-col gap-1' : 'flex min-w-0 flex-col gap-3'}>{readings}</div> : readings}
        </div>
      ) : empty}
      </InstrumentPresentation>
    </WidgetShell>
  );
}
