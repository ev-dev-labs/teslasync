import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, BatteryCharging, Plug, Timer, Gauge } from 'lucide-react';
import { Badge } from '@/components/ui';
import { AnimatedNumber } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useChargingSessionsPaginated } from '@/api/hooks/useCharging';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { convertDistanceFromSI, convertEnergyFromSI } from '@/lib/unitConversion';

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
export function formatTimeRemaining(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return '—';
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

  const { data: stateData, isLoading: stateLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = useVehicleState(id, {
    refetchInterval: 5_000, });
  const { data: sessions, isLoading: sessionsLoading } = useChargingSessionsPaginated(
    id > 0 ? id : null, { limit: 1 }, );

  const { unitPrefs } = useUnits();
  const toDistanceDisplay = (value: number) => convertDistanceFromSI(value, unitPrefs.distance);

  const distanceUnit = unitPrefs.distance;

  const state = stateData?.state;
  const latestSession = (sessions ?? [])[0];
  const isLoading = stateLoading || sessionsLoading;

  const isCompact = size.cols <= 1 && size.rows <= 1;
  const isTall = size.rows >= 2;

  // Derive charging metrics from live state + latest session
  const metrics = useMemo(() => {
    const power = state?.charger_power ?? 0;
    const voltage = null;
    const amps = null;
    const energyAdded = latestSession?.total_energy_added_wh ?? 0;
    const timeToFull = state?.time_to_full_charge ?? 0;
    const chargeRate = state?.charge_rate ?? 0;
    const batteryLevel = state?.battery_level ?? 0;

    return { power, voltage, amps, energyAdded, timeToFull, chargeRate, batteryLevel };
  }, [state, latestSession]);

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.chargeStatusLive', 'Charge Status')}
      icon={
        isCompact ? undefined : (
          <Zap className="h-3.5 w-3.5 text-neon-green" />
        )
      }
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
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
          <CompactIdleView batteryLevel={metrics.batteryLevel} t={t} />
        ) : (
          <IdleView
            metrics={metrics}
            latestSession={latestSession}
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
function CompactChargingView({ power, batteryLevel }: { power: number; batteryLevel: number }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-1">
      <BatteryCharging className="h-5 w-5 text-neon-green animate-pulse" />
      <AnimatedNumber value={power} decimals={1} suffix=" kW" className="text-lg font-bold text-neon-green" />
      <span className="text-2xs text-[var(--text-muted)]">{batteryLevel}%</span>
    </div>
  );
}

/* ── Compact: idle ── */
function CompactIdleView({ batteryLevel, t }: { batteryLevel: number; t: (k: string, f: string) => string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-1">
      <Plug className="h-5 w-5 text-[var(--text-muted)]" />
      <span className="text-lg font-bold text-[var(--text-primary)]">{batteryLevel}%</span>
      <span className="text-2xs text-[var(--text-muted)]">{t('widget.notCharging', 'Not Charging')}</span>
    </div>
  );
}

/* ── Full: actively charging ── */
interface FullChargingViewProps {
  metrics: {
    power: number;
    voltage: number | null;
    amps: number | null;
    energyAdded: number;
    timeToFull: number;
    chargeRate: number;
    batteryLevel: number;
  };
  isTall: boolean;
  toDistanceDisplay: (km: number) => number;
  distanceUnit: string;
  t: (k: string, f: string) => string;
}

function FullChargingView({ metrics, isTall, toDistanceDisplay, distanceUnit, t }: FullChargingViewProps) {
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
        <span className="text-xs text-[var(--text-secondary)]">{batteryLevel}%</span>
      </div>

      {/* Primary metric: power */}
      <div className="text-center">
        <AnimatedNumber
          value={power}
          decimals={1}
          suffix=" kW"
          className="text-2xl font-bold text-emerald-300"
        />
      </div>

      {/* Secondary metrics grid */}
      <div className="grid grid-cols-2 gap-2">
        <MetricCell
          icon={<Gauge className="h-3 w-3 text-[var(--text-muted)]" />}
          label={t('widget.voltage', 'Voltage')}
          value={voltage != null ? `${fmtNumber(voltage, 0)} V` : '—'}
        />
        <MetricCell
          icon={<Zap className="h-3 w-3 text-[var(--text-muted)]" />}
          label={t('widget.amps', 'Current')}
          value={amps != null ? `${fmtNumber(amps, 0)} A` : '—'}
        />
        <MetricCell
          icon={<Timer className="h-3 w-3 text-[var(--text-muted)]" />}
          label={t('widget.timeRemaining', 'Time Left')}
          value={formatTimeRemaining(timeToFull)}
        />
        <MetricCell
          icon={<Zap className="h-3 w-3 text-[var(--text-muted)]" />}
          label={t('widget.energyAdded', 'Added')}
          value={`${fmtNumber(convertEnergyFromSI(energyAdded, 'kWh'), 1)} kWh`}
        />
      </div>

      {/* Extra row when tall */}
      {isTall && (
        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-white/[0.06]">
          <MetricCell
            icon={<Gauge className="h-3 w-3 text-[var(--text-muted)]" />}
            label={t('widget.chargeRate', 'Rate')}
            value={`${fmtNumber(toDistanceDisplay(chargeRate), 0)} ${distanceUnit}/h`}
          />
          <MetricCell
            icon={<BatteryCharging className="h-3 w-3 text-[var(--text-muted)]" />}
            label={t('widget.batteryLevel', 'Battery')}
            value={`${batteryLevel}%`}
          />
        </div>
      )}
    </div>
  );
}

/* ── Full: not charging ── */
interface IdleViewProps {
  metrics: {
    power: number;
    energyAdded: number;
    batteryLevel: number;
  };
  latestSession: { total_energy_added_wh: number } | undefined;
  t: (k: string, f: string) => string;
}

function IdleView({ metrics, latestSession, t }: IdleViewProps) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3">
      <Plug className="h-6 w-6 text-[var(--text-muted)]" />
      <div className="text-center">
        <p className="text-sm font-medium text-[var(--text-primary)]">
          {t('widget.notCharging', 'Not Charging')}
        </p>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">
          {metrics.batteryLevel}%
        </p>
      </div>
      {latestSession && (
        <div className="text-center p-2 rounded-lg bg-white/[0.03] border border-white/[0.06] w-full">
          <p className="text-2xs text-[var(--text-muted)] mb-0.5">
            {t('widget.lastSession', 'Last Session')}
          </p>
          <p className="text-xs font-medium text-[var(--text-secondary)]">
            +{fmtNumber(convertEnergyFromSI(latestSession.total_energy_added_wh, 'kWh'), 1)} kWh
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Tiny metric cell ── */
function MetricCell({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-1.5 min-w-0">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-2xs text-[var(--text-muted)] truncate">{label}</p>
        <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{value}</p>
      </div>
    </div>
  );
}
