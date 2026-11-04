import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Plug } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { deriveDataState, knownNumber } from '@/api/dataState';
import { useChargingTelemetryLatest, useVehicles } from '@/api/hooks/useVehicles';

import { convertPowerFromSI } from '@/lib/unitConversion';
import { useUnits } from '@/hooks/useUnits';
import { WidgetShell } from './WidgetShell';
import { WidgetStatGrid } from './shared';
import { ChargeBatteryPack, ChargeReadings, useTelemetryChargeActivity } from './instruments/ChargeInstruments';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export default function ChargingTelemetryWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { unitPrefs } = useUnits();
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const query = useChargingTelemetryLatest(id, 5_000);
  const {
    data, isLoading, error,
    isFetching, isStale, isError, dataUpdatedAt, refetch,
  } = query;

  const isCompact = size.cols <= 1;
  const isShort = size.rows <= 2;

  const isCharging = data?.charging_state === 'Charging';
  const active = useTelemetryChargeActivity(query);
  const batteryLevel = knownNumber(data?.battery_level);

  const voltage = knownNumber(data?.charger_voltage);
  const current = knownNumber(data?.charger_actual_current);
  const power = knownNumber(data?.charger_power_w);
  const dataState = deriveDataState(query, { provenance: 'live' });

  // `charger_power_w` is SI watts. Convert to the user's power unit (kW) at the
  // render boundary — rendering the raw watt magnitude with a "kW" suffix was a
  // 1000× overstatement (an 11 kW charger showed as "11,000.0 kW").
  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  // Derive charger type from voltage/phases heuristic
  const chargerType = useMemo(() => {
    if (!data || !isCharging || voltage == null) return null;
    if (voltage > 300) return 'DC';
    return 'AC';
  }, [data, isCharging, voltage]);

  const pilot = knownNumber(data?.charger_pilot_current);
  const phases = knownNumber(data?.charger_phases);
  const stats = useMemo(() => [
    {
      label: t('widget.chargingTelemetry.voltage', 'Voltage'),
      value: voltage == null ? null : fmtNumber(voltage, 0),
      unit: 'V',
    },
    {
      label: t('widget.chargingTelemetry.current', 'Current'),
      value: current == null ? null : fmtNumber(current, 0),
      unit: 'A',
    },
    {
      label: t('widget.chargingTelemetry.power', 'Power'),
      value: power == null ? null : fmtNumber(convertPowerFromSI(power, unitPrefs.power), unitPrefs.power === 'kW' ? 1 : 0),
      unit: unitPrefs.power,
    },
    {
      label: t('widget.chargingTelemetry.phases', 'Phases'),
      value: phases == null ? null : fmtInt(phases),
    },
    {
      label: t('widget.chargingTelemetry.chargerLabel', 'Charger'),
      value: chargerType,
    },
    {
      label: t('widget.chargingTelemetry.pilot', 'Pilot'),
      value: pilot == null ? null : fmtNumber(pilot, 0),
      unit: 'A',
    },
  ], [chargerType, current, fmtInt, fmtNumber, phases, pilot, power, t, unitPrefs.power, voltage]);

  // ── Compact layout ──
  if (isCompact) {
    return (
      <WidgetShell
        title={t('widget.chargingTelemetry.title', 'Charging telemetry')}
        loading={isLoading && !data}
        dataState={data != null || isLoading || isError || error ? dataState : undefined}
        error={dataState.fatalError ? String(dataState.fatalError) : null}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={handleRefresh}
      >
        {isCharging ? (
          <div className={isShort ? 'flex min-w-0 items-center gap-2' : 'flex min-w-0 flex-col gap-2'}>
            <ChargeBatteryPack level={batteryLevel} active={active} className={isShort ? 'w-16' : 'mx-auto w-24'} />
            <ChargeReadings short={isShort}>
            <WidgetStatGrid compact cols={2} stats={stats.slice(0, 4)} />
            </ChargeReadings>
          </div>
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<Plug className="h-5 w-5" />}
            message={data?.charging_state == null ? t('widget.noChargeData', 'No charge data') : t('widget.chargingTelemetry.notCharging', 'Not currently charging')}
            className="py-4"
          />
        )}
      </WidgetShell>
    );
  }

  // ── Standard / Wide layout ──
  return (
    <WidgetShell
      title={t('widget.chargingTelemetry.title', 'Charging telemetry')}
      loading={isLoading && !data}
      dataState={data != null || isLoading || isError || error ? dataState : undefined}
      error={dataState.fatalError ? String(dataState.fatalError) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      {isCharging ? (
        <div className={isShort ? 'flex min-w-0 items-start gap-3' : 'flex h-full flex-col gap-3'}>
          <ChargeBatteryPack level={batteryLevel} active={active} className={isShort ? 'w-20' : 'mx-auto w-32'} />
          <div className="min-w-0 flex-1">
          <ChargeReadings short={isShort}>
          <WidgetStatGrid
            cols={3}
            maxPerRow={3}
            stats={stats}
          />
          </ChargeReadings>
          </div>
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Plug className="h-5 w-5" />}
          message={data?.charging_state == null ? t('widget.noChargeData', 'No charge data') : t('widget.chargingTelemetry.notCharging', 'Not currently charging')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
