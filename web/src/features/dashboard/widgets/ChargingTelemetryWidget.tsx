import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Battery, Car, Plug } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { Caption } from '@/components/ui';
import { deriveDataState, knownNumber } from '@/api/dataState';
import { useChargingTelemetryLatest, useVehicles } from '@/api/hooks/useVehicles';

import { convertPowerFromSI } from '@/lib/unitConversion';
import { useUnits } from '@/hooks/useUnits';
import { useDateFormat } from '@/hooks/useDateFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetFlowDiagram, WidgetStatGrid, type FlowNode } from './shared';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import { ChargeBatteryPack, ChargeReadings, useTelemetryChargeActivity } from './instruments/ChargeInstruments';
import { ChargeStatusSummary } from './instruments/ChargeStatusSummary';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export default function ChargingTelemetryWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { unitPrefs } = useUnits();
  const { formatDateTime } = useDateFormat();
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const query = useChargingTelemetryLatest(id, 5_000);
  const {
    data, isLoading, error,
    isFetching, isStale, isError, dataUpdatedAt, refetch,
  } = query;

  const isCompact = size.cols <= 1;
  const isShort = size.rows <= 2;

  const charging = data?.charging_state != null ? data.charging_state === 'Charging' : null;
  const isCharging = charging === true;
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
    { label: t('widget.chargingTelemetry.voltage', 'Voltage'),
      value: voltage == null ? null : fmtNumber(voltage, 0), unit: 'V' },
    { label: t('widget.chargingTelemetry.current', 'Current'),
      value: current == null ? null : fmtNumber(current, 0), unit: 'A' },
    { label: t('widget.chargingTelemetry.power', 'Power'),
      value: power == null ? null : fmtNumber(convertPowerFromSI(power, unitPrefs.power), unitPrefs.power === 'kW' ? 1 : 0), unit: unitPrefs.power },
    { label: t('widget.chargingTelemetry.phases', 'Phases'),
      value: phases == null ? null : fmtInt(phases) },
    { label: t('widget.chargingTelemetry.chargerLabel', 'Charger'), value: chargerType },
    { label: t('widget.chargingTelemetry.pilot', 'Pilot'),
      value: pilot == null ? null : fmtNumber(pilot, 0), unit: 'A' },
  ], [chargerType, current, fmtInt, fmtNumber, phases, pilot, power, t, unitPrefs.power, voltage]);

  const flowNodes: FlowNode[] = [
    { id: 'charger', label: t('widget.chargingTelemetry.chargerLabel', 'Charger'),
      value: voltage ?? Number.NaN, formattedValue: voltage == null ? '—' : `${stats[0].value} V`,
      icon: <Plug />, position: 'left' },
    { id: 'vehicle', label: t('dashboardWidgets.charging.chargingTelemetry.vehicle', 'Vehicle'),
      value: power ?? Number.NaN, formattedValue: power == null ? '—' : `${stats[2].value} ${unitPrefs.power}`,
      icon: <Car />, position: 'center' },
    { id: 'battery', label: t('widget.battery', 'Battery'),
      value: batteryLevel ?? Number.NaN,
      formattedValue: batteryLevel == null || batteryLevel < 0 || batteryLevel > 100 ? '—' : `${fmtNumber(batteryLevel, 0)}%`,
      icon: <Battery />, position: 'right' },
  ];
  const flowArrows = useMemo(() => [
    { from: 'charger', to: 'vehicle', value: power ?? Number.NaN, active: active && power != null && power > 0 },
    { from: 'vehicle', to: 'battery', value: power ?? Number.NaN, active: active && power != null && power > 0 },
  ], [active, power]);
  const supportingStats = useMemo(() => stats.filter((_stat, index) => index !== 2), [stats]);
  const empty = (
    <EmptyState /* no-action: transient telemetry state; the shell owns source refresh. */
      icon={isShort ? undefined : <Plug className="h-5 w-5" />}
      message={data?.charging_state == null ? t('widget.noChargeData', 'No charge data') : t('widget.chargingTelemetry.notCharging', 'Not currently charging')}
      className="py-4"
    />
  );
  const sampleTime = data?.ts && Number.isFinite(Date.parse(data.ts)) ? formatDateTime(data.ts) : '—';
  const presentation = {
    family: 'charge-flow' as const,
    compact: isCompact || isShort,
    icon: <Plug />,
    headline: <WidgetBigNumber value={stats[2].value} unit={unitPrefs.power}
      label={t('dashboardWidgets.charging.chargingTelemetry.chargingPower', 'Charging power')} animated={false} />,
    context: <ChargeStatusSummary charging={charging} active={active} limit={data?.charge_limit_soc_pct} />,
    instrument: (
      <div className="min-w-0 space-y-2">
        <div className={isCompact || isShort ? 'h-24 min-w-0' : 'h-36 min-w-0'}>
          <WidgetFlowDiagram nodes={flowNodes} arrows={flowArrows}
            ariaLabel={t('dashboardWidgets.charging.chargingTelemetry.flowLabel', 'Charging flow schematic')}
          />
        </div>
        <ChargeBatteryPack level={batteryLevel} active={active} className={isShort ? 'mx-auto w-16' : 'mx-auto w-24'} />
        {!isCharging && empty}
      </div>
    ),
    details: (
      <div className="min-w-0 space-y-2">
        <ChargeReadings short={isShort}>
          <WidgetStatGrid cols={isCompact ? 2 : 3} maxPerRow={isCompact ? 2 : 3}
            stats={supportingStats} />
        </ChargeReadings>
        <Caption>{t('dashboardWidgets.charging.chargingTelemetry.sampleTime', 'Telemetry sample')}: {sampleTime}</Caption>
        <Caption>{t('dashboardWidgets.charging.chargingTelemetry.signalFreshnessUnavailable', 'Individual signal freshness is unavailable.')}</Caption>
      </div>
    ),
  };
  const shellProps = {
    title: t('widget.chargingTelemetry.title', 'Charging telemetry'),
    loading: isLoading && !data,
    dataState: data != null || isLoading || isError || error ? dataState : undefined,
    error: dataState.fatalError ? String(dataState.fatalError) : null,
    updatedAt: dataUpdatedAt,
    isFetching, isStale, isError,
    onRefresh: handleRefresh,
  };

  // ── Compact layout ──
  if (isCompact) {
    return (
      <WidgetShell {...shellProps}>
        <InstrumentPresentation {...presentation}>
        {data && !isCharging && <ChargeStatusSummary charging={charging} active={active} limit={data.charge_limit_soc_pct} />}
        {isCharging ? (
          <div className={isShort ? 'flex min-w-0 items-center gap-2' : 'flex min-w-0 flex-col gap-2'}>
            <div className="min-w-0">
              <ChargeStatusSummary charging={charging} active={active} limit={data?.charge_limit_soc_pct} />
              <ChargeBatteryPack level={batteryLevel} active={active} className={isShort ? 'w-16' : 'mx-auto w-24'} />
            </div>
            <ChargeReadings short={isShort}>
            <WidgetStatGrid compact cols={2} stats={stats.slice(0, 4)} />
            </ChargeReadings>
          </div>
        ) : empty}
        </InstrumentPresentation>
      </WidgetShell>
    );
  }

  // ── Standard / Wide layout ──
  return (
    <WidgetShell {...shellProps}>
      <InstrumentPresentation {...presentation}>
      {data && !isCharging && <ChargeStatusSummary charging={charging} active={active} limit={data.charge_limit_soc_pct} />}
      {isCharging ? (
        <div className={isShort ? 'flex min-w-0 items-start gap-3' : 'flex h-full flex-col gap-3'}>
          <div className={isShort ? 'w-32 min-w-0 shrink-0' : 'min-w-0'}>
            <ChargeStatusSummary charging={charging} active={active} limit={data?.charge_limit_soc_pct} />
            <ChargeBatteryPack level={batteryLevel} active={active} className={isShort ? 'w-20' : 'mx-auto w-32'} />
          </div>
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
      ) : empty}
      </InstrumentPresentation>
    </WidgetShell>
  );
}
