import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, BatteryCharging, Plug, Timer, Gauge } from 'lucide-react';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { deriveDataState, knownNumber } from '@/api/dataState';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useChargingSessionsPaginated } from '@/api/hooks/useCharging';
import { useUnits } from '@/hooks/useUnits';

import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid } from './shared';
import { dashboardTokens } from '../lib/dashboardTokens';
import type { WidgetProps } from './types';
import { convertDistanceFromSI, convertEnergyFromSI } from '@/lib/unitConversion';
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
  const sessionQuery = useChargingSessionsPaginated(
    id > 0 ? id : null, { limit: 1 }, );
  const { data: sessions, isLoading: sessionsLoading } = sessionQuery;

  const { unitPrefs } = useUnits();
  const toDistanceDisplay = (value: number) => convertDistanceFromSI(value, unitPrefs.distance);

  const distanceUnit = unitPrefs.distance;

  const state = stateData?.state;
  const idleLabel = state?.is_charging === false
    ? t('widget.notCharging', 'Not charging')
    : t('widget.chargingSchedule.modeUnknown', 'Unknown');
  const latestSession = (sessions ?? [])[0];
  const isLoading = (stateLoading || sessionsLoading) && !stateData;

  const isCompact = size.cols <= 1 && size.rows <= 1;
  const isTall = size.rows >= 2;

  // Derive charging metrics from live state + latest session
  const metrics = useMemo(() => {
    const power = knownNumber(state?.charger_power);
    const voltage = null;
    const amps = null;
    const energyAdded = knownNumber(latestSession?.total_energy_added_wh);
    const timeToFull = knownNumber(state?.time_to_full_charge);
    const chargeRate = knownNumber(state?.charge_rate);
    const batteryLevel = knownNumber(state?.battery_level);

    return { power, voltage, amps, energyAdded, timeToFull, chargeRate, batteryLevel };
  }, [state, latestSession]);

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
        isError: isError || sessionQuery.isError,
        error: error ?? sessionQuery.error,
      }, { provenance: stateData.live ? 'live' : 'cached' }) : undefined}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching || sessionQuery.isFetching}
      isStale={isStale}
      isError={isError || sessionQuery.isError}
      onRefresh={() => { void refetch(); void sessionQuery.refetch?.(); }}
    >
      {state ? (
        state.is_charging ? (
          isCompact ? (
            <CompactChargingView power={metrics.power} batteryLevel={metrics.batteryLevel} />
          ) : (
            <FullChargingView
              metrics={metrics}
              isTall={isTall}
              toDistanceDisplay={toDistanceDisplay}
              distanceUnit={distanceUnit}
              t={t}
            />
          )
        ) : isCompact ? (
          <CompactIdleView batteryLevel={metrics.batteryLevel} statusLabel={idleLabel} />
        ) : (
          <IdleView
            metrics={metrics}
            latestSession={latestSession}
            statusLabel={idleLabel}
            t={t}
          />
        )
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

/* ── Compact: charging ── */
function CompactChargingView({ power, batteryLevel }: { power: number | null; batteryLevel: number | null }) {
  const { fmtNumber } = useNumberFormatting();
  return (
    <div className="h-full flex flex-col items-center justify-center gap-1">
      <BatteryCharging className="h-5 w-5 text-neon-green animate-pulse" />
      <WidgetBigNumber value={power == null ? null : `${fmtNumber(power)} kW`} animated={false} align="center" size="secondary" />
      <span className={dashboardTokens.metricLabel}>{batteryLevel == null ? '—' : `${batteryLevel}%`}</span>
    </div>
  );
}

/* ── Compact: idle ── */
function CompactIdleView({ batteryLevel, statusLabel }: { batteryLevel: number | null; statusLabel: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-1">
      <Plug className="h-5 w-5 text-[var(--text-muted)]" />
      <WidgetBigNumber value={batteryLevel == null ? null : `${batteryLevel}%`} label={statusLabel} animated={false} align="center" size="secondary" />
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
    chargeRate: number | null;
    batteryLevel: number | null;
  };
  isTall: boolean;
  toDistanceDisplay: (km: number) => number;
  distanceUnit: string;
  t: (k: string, f: string) => string;
}

function FullChargingView({ metrics, isTall, toDistanceDisplay, distanceUnit, t }: FullChargingViewProps) {
  const { fmtNumber } = useNumberFormatting();
  const { power, voltage, amps, energyAdded, timeToFull, chargeRate, batteryLevel } = metrics;

  return (
    <div className="h-full flex flex-col justify-center gap-3">
      {/* Status header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BatteryCharging className="h-4 w-4 text-neon-green animate-pulse" />
          <Badge variant="success" size="sm">
            {t('widget.charging', 'Charging')}
          </Badge>
        </div>
        <span className={dashboardTokens.metricLabel}>{batteryLevel == null ? '—' : `${batteryLevel}%`}</span>
      </div>

      {/* Primary metric: power */}
      <div className="text-center">
        <WidgetBigNumber value={power == null ? null : `${fmtNumber(power)} kW`} animated={false} align="center" valueColor="text-emerald-300" />
      </div>

      {/* Secondary metrics grid */}
      <div className="grid min-w-0 grid-cols-1 gap-2 @xs:grid-cols-2">
        <MetricCell
          icon={<Gauge className="h-3 w-3 text-[var(--text-muted)]" />}
          label={t('widget.voltage', 'Voltage')}
          value={voltage != null ? `${fmtNumber(voltage)} V` : '—'}
        />
        <MetricCell
          icon={<Zap className="h-3 w-3 text-[var(--text-muted)]" />}
          label={t('widget.amps', 'Current')}
          value={amps != null ? `${fmtNumber(amps)} A` : '—'}
        />
        <MetricCell
          icon={<Timer className="h-3 w-3 text-[var(--text-muted)]" />}
          label={t('widget.timeRemaining', 'Time left')}
          value={formatTimeRemaining(timeToFull)}
        />
        <MetricCell
          icon={<Zap className="h-3 w-3 text-[var(--text-muted)]" />}
          label={t('widget.energyAdded', 'Added')}
          value={energyAdded == null ? '—' : `${fmtNumber(convertEnergyFromSI(energyAdded, 'kWh'))} kWh`}
        />
      </div>

      {/* Extra row when tall */}
      {isTall && (
        <div className="grid min-w-0 grid-cols-1 gap-2 pt-1 border-t border-[var(--border-subtle)] @xs:grid-cols-2">
          <MetricCell
            icon={<Gauge className="h-3 w-3 text-[var(--text-muted)]" />}
            label={t('widget.chargeRate', 'Rate')}
            value={chargeRate == null ? '—' : `${fmtNumber(toDistanceDisplay(chargeRate))} ${distanceUnit}/h`}
          />
          <MetricCell
            icon={<BatteryCharging className="h-3 w-3 text-[var(--text-muted)]" />}
            label={t('widget.batteryLevel', 'Battery')}
            value={batteryLevel == null ? '—' : `${batteryLevel}%`}
          />
        </div>
      )}
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
  latestSession: { total_energy_added_wh: number } | undefined;
  statusLabel: string;
  t: (k: string, f: string) => string;
}

function IdleView({ metrics, latestSession, statusLabel, t }: IdleViewProps) {
  const { fmtNumber } = useNumberFormatting();
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3">
      <Plug className="h-6 w-6 text-[var(--text-muted)]" />
      <div className="text-center">
        <p className={dashboardTokens.metricLabel}>
          {statusLabel}
        </p>
        <p className={dashboardTokens.secondaryMetric}>
          {metrics.batteryLevel == null ? '—' : `${metrics.batteryLevel}%`}
        </p>
      </div>
      <div className="w-full min-w-0 border-t border-[var(--border-subtle)] pt-2 text-center">
          <p className={dashboardTokens.metricLabel}>
            {t('widget.lastSession', 'Last session')}
          </p>
          <p className={dashboardTokens.secondaryMetric}>
            {latestSession && metrics.energyAdded != null ? `${metrics.energyAdded > 0 ? '+' : ''}${fmtNumber(convertEnergyFromSI(metrics.energyAdded, 'kWh'))} kWh` : '—'}
          </p>
        </div>
    </div>
  );
}

/* ── Tiny metric cell ── */
function MetricCell({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <WidgetStatGrid compact stats={[{ icon, label, value }]} />
  );
}
