import { Zap, BatteryCharging, Plug } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback';
import { deriveDataState, knownNumber } from '@/api/dataState';
import { useChargingTelemetryLatest, useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { useDateFormat } from '@/hooks/useDateFormat';

import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid } from './shared';
import { dashboardTokens } from '../lib/dashboardTokens';
import type { WidgetProps } from './types';
import { convertEnergyFromSI, convertPowerFromSI } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

/**
 * Format an "hours until full charge" value into a compact "Hh Mm" label.
 *
 * Exported for unit testing. Two edge cases are handled that the naive inline
 * version got wrong:
 *   - Non-finite input (a dropped / garbled `time_to_full_charge` reading)
 *     resolves to the em-dash placeholder rather than rendering "NaNh NaNm".
 *   - The minute-rounding rollover: `Math.round((hours - h) * 60)` can yield
 *     60 for values like 1.999, which must read "2h" — never "1h 60m".
 */
export function formatTimeRemaining(hours: number | null): string {
  if (hours == null || !Number.isFinite(hours) || hours < 0) return '—';
  let h = Math.floor(hours);
  let m = Math.round((hours - h) * 60);
  if (m === 60) {
    h += 1;
    m = 0;
  }
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export default function ChargeStatusLiveWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const stateQuery = useVehicleState(id, {
    refetchInterval: 5_000, });
  const { data: stateData, isLoading: stateLoading, isFetching, isStale, isError, error, dataUpdatedAt, refetch } = stateQuery;
  const telemetryQuery = useChargingTelemetryLatest(id, 5_000);
  const { data: telemetry, isLoading: telemetryLoading, isFetching: telemetryFetching, isStale: telemetryStale, isError: telemetryError } = telemetryQuery;

  const { unitPrefs } = useUnits();
  const { formatTime } = useDateFormat();
  const { fmtNumber } = useNumberFormatting();

  const state = stateData?.state;
  const idleLabel = state?.is_charging === false
    ? t('widget.notCharging', 'Not charging')
    : t('widget.chargingSchedule.modeUnknown', 'Unknown');
  const isLoading = (stateLoading || telemetryLoading) && !stateData && !telemetry;

  const isCompact = size.cols <= 1 && size.rows <= 1;
  const telemetryPower = knownNumber(telemetry?.charger_power_w);
  const statePowerKw = knownNumber(state?.charger_power);
  const powerWatts = telemetryPower ?? (statePowerKw == null ? null : statePowerKw * 1000);
  const metrics = {
    power: powerWatts,
    voltage: knownNumber(telemetry?.charger_voltage),
    amps: knownNumber(telemetry?.charger_actual_current),
    energyAdded: knownNumber(telemetry?.charge_energy_added_wh),
    timeToFull: knownNumber(state?.time_to_full_charge),
    batteryLevel: knownNumber(state?.battery_level),
    doneAt: (() => {
      const hours = knownNumber(state?.time_to_full_charge);
      return hours != null && Number.isFinite(hours) && hours >= 0
        ? formatTime(Date.now() + hours * 3_600_000)
        : null;
    })(),
  };
  const hasChargingData = telemetry != null || state != null;
  const statusIsCharging = state
    ? state.is_charging === true
    : telemetry?.charging_state === 'Charging';

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.chargeStatusLive', 'Charge status')}
      icon={
        isCompact ? undefined : (
          <Zap className="h-3.5 w-3.5 text-neon-green" />
        )
      }
      loading={isLoading}
      error={!stateData && isError ? String(error ?? 'Request failed') : null}
      dataState={stateData ? deriveDataState({
        ...stateQuery,
        isError: isError || telemetryError,
        error: error ?? telemetryQuery.error,
      }, { provenance: stateData.live ? 'live' : 'cached' }) : undefined}
      updatedAt={dataUpdatedAt}
      refreshIntervalMs={5_000}
      isFetching={isFetching || telemetryFetching}
      isStale={isStale || telemetryStale}
      isError={isError || telemetryError}
      onRefresh={() => { void refetch(); void telemetryQuery.refetch?.(); }}
    >
      {hasChargingData ? (
        statusIsCharging ? (
          isCompact ? (
            <CompactChargingView power={metrics.power} batteryLevel={metrics.batteryLevel} />
          ) : (
            <FullChargingView
              metrics={metrics}
              unitPrefs={unitPrefs}
              fmtNumber={fmtNumber}
              t={t}
            />
          )
        ) : isCompact ? (
          <CompactIdleView batteryLevel={metrics.batteryLevel} statusLabel={idleLabel} />
        ) : (
          <IdleView
            metrics={metrics}
            statusLabel={idleLabel}
          />
        )
      ) : (
        <EmptyState
          icon={<Zap className="h-5 w-5" />}
          message={t('widget.noChargeData', 'No charge data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}

/* ── Compact: charging ── */
function CompactChargingView({ power, batteryLevel }: { power: number | null; batteryLevel: number | null }) {
  const { fmtNumber } = useNumberFormatting();
  const { unitPrefs } = useUnits();
  return (
    <div className="h-full flex flex-col items-center justify-center gap-1">
      <BatteryCharging className="h-5 w-5 text-emerald-300 animate-pulse" />
      <WidgetBigNumber
        value={power == null ? null : fmtNumber(convertPowerFromSI(power, unitPrefs.power), 0)}
        unit={unitPrefs.power}
        animated={false}
        align="center"
        size="secondary"
      />
      <span className={dashboardTokens.metricLabel}>{batteryLevel == null ? '—' : `${fmtNumber(batteryLevel, 0)}%`}</span>
    </div>
  );
}

/* ── Compact: idle ── */
function CompactIdleView({ batteryLevel, statusLabel }: { batteryLevel: number | null; statusLabel: string }) {
  const { fmtNumber } = useNumberFormatting();
  return (
    <div className="h-full flex flex-col items-center justify-center gap-1">
      <Plug className="h-5 w-5 text-[var(--text-muted)]" />
      <WidgetBigNumber value={batteryLevel == null ? null : `${fmtNumber(batteryLevel, 0)}%`} label={statusLabel} animated={false} align="center" size="secondary" />
    </div>
  );
}

/* ── Full: actively charging ── */
interface FullChargingViewProps {
  metrics: {
    power: number | null;
    voltage: number | null;
    amps: number | null;
    energyAdded: number | null;
    timeToFull: number | null;
    batteryLevel: number | null;
    doneAt: string | null;
  };
  unitPrefs: ReturnType<typeof useUnits>['unitPrefs'];
  fmtNumber: (value: unknown, decimals?: number, locale?: string) => string;
  t: (k: string, f: string) => string;
}

function FullChargingView({ metrics, unitPrefs, fmtNumber, t }: FullChargingViewProps) {
  const { power, voltage, amps, energyAdded, timeToFull, doneAt } = metrics;

  return (
    <div className="h-full flex min-w-0 flex-col justify-center gap-3">
      <WidgetStatGrid
        cols={3}
        stats={[
          {
            label: t('widget.chargingTelemetry.power', 'Power'),
            value: power == null ? null : fmtNumber(convertPowerFromSI(power, unitPrefs.power), 0),
            unit: unitPrefs.power,
          },
          {
            label: t('widget.chargingTelemetry.current', 'Current'),
            value: amps == null ? null : fmtNumber(amps, 0),
            unit: 'A',
          },
          {
            label: t('widget.voltage', 'Voltage'),
            value: voltage == null ? null : fmtNumber(voltage, 0),
            unit: 'V',
          },
          {
            label: t('widget.energyAdded', 'Energy added'),
            value: energyAdded == null ? null : fmtNumber(convertEnergyFromSI(energyAdded, unitPrefs.energy), 0),
            unit: unitPrefs.energy,
          },
          {
            label: t('widget.timeRemaining', 'Time left'),
            value: formatTimeRemaining(timeToFull),
          },
          {
            label: t('widget.doneAt', 'Done'),
            value: doneAt ?? null,
          },
        ]}
      />
    </div>
  );
}

/* ── Full: not charging ── */
interface IdleViewProps {
  metrics: {
    power: number | null;
    energyAdded: number | null;
    batteryLevel: number | null;
  };
  statusLabel: string;
  t: (k: string, f: string) => string;
}

function IdleView({ metrics, statusLabel }: Omit<IdleViewProps, 't'>) {
  const { fmtNumber } = useNumberFormatting();
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3">
      <Plug className="h-6 w-6 text-[var(--text-muted)]" />
      <div className="text-center">
        <p className={dashboardTokens.metricLabel}>
          {statusLabel}
        </p>
        <p className={dashboardTokens.secondaryMetric}>
          {metrics.batteryLevel == null ? '—' : `${fmtNumber(metrics.batteryLevel, 0)}%`}
        </p>
      </div>
    </div>
  );
}
