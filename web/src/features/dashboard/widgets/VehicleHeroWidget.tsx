import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Car, HelpCircle, Lock, Unlock } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { Heading, Text } from '@/components/ui';
import { StatusBadge } from '@/components/data-display';
import { deriveDataState } from '@/api/dataState';
import { INTERVALS } from '@/lib/constants';
import {
  deriveTrustedVehicleStatus,
  resolveVehicleStateFreshness,
  useVehicles,
  useVehicleState,
} from '@/api/hooks/useVehicles';
import type { VerifiedVehicleStateField } from '@/api/hooks/useVehicles';
import { TELEMETRY_STALE_AFTER_MS } from '@/hooks/useTelemetryFreshness';
import { useUnits } from '@/hooks/useUnits';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useTicker } from '@/hooks/useTicker';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import {
  convertDistanceFromSI,
  convertTempFromSI,
} from '@/lib/unitConversion';
import { formatDurationSecondsAsMinutes } from '@/lib/dateConvert';
import { VEHICLE_STATE_LABELS, type VehicleState } from '@/types/fsm';
import { WidgetBigNumber } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

/** Stable identity so an unresolved read never re-renders the hero body. */
const EMPTY_VERIFIED_FIELDS: readonly VerifiedVehicleStateField[] = [];

/**
 * "Done ~3:45 PM" charge-ETA label. Subscribes to the shared ticker itself so
 * only this line re-renders as the clock advances. The time goes through the
 * shared date layer (`useDateFormat`); no zone name or offset is rendered.
 */
const ChargeDoneAt = memo(function ChargeDoneAt({ etaHours }: { etaHours: number }) {
  useTicker();
  const { t } = useTranslation('dashboard');
  const { formatTime } = useDateFormat();
  return (
    <>
      {t('hero.doneAt', 'Done')} ~{formatTime(new Date(Date.now() + etaHours * 3_600_000))}
    </>
  );
});

function Chip({ icon, label, description, children }: {
  icon?: ReactNode; label?: string; description?: string; children: ReactNode;
}) {
  return (
    <span
      role={label ? 'group' : undefined}
      aria-label={label}
      aria-description={description}
      className="inline-flex min-w-0 items-center gap-1.5 rounded-pill border border-[var(--border-subtle)] bg-[var(--surface-2)] px-2.5 py-1 text-xs text-[var(--text-secondary)]"
    >
      {icon}
      <span className="min-w-0 break-words">{label && <>{label}{' '}</>}{children}</span>
    </span>
  );
}

/** Whole-unit display text for a temperature chip, or the em-dash placeholder. */
function tempChipText(
  celsius: number | null | undefined,
  convert: (celsius: number) => number,
  tempUnit: string,
  fmt: (value: number, decimals: number) => string,
): string {
  return celsius != null && Number.isFinite(celsius)
    ? `${fmt(convert(celsius), 0)}${tempUnit}`
    : '—';
}

export default function VehicleHeroWidget({ vehicleId }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const unknownReading = t('hero.unknownStatus', 'Unknown');
  const rangeLabel = t('hero.range', 'Range');
  const { fmtNumber } = useNumberFormatting();
  const { data: vehicles, isLoading: vehiclesLoading, error: vehiclesError } = useVehicles();
  const vehicle = vehicleId
    ? vehicles?.find((v) => v.id === vehicleId) ?? vehicles?.[0]
    : vehicles?.[0];

  const id = vehicle?.id ?? 0;
  /* The fleet batch (`useFleetStates`) seeds `vehicleKeys.state(id)` on every
   * successful poll, so an ambient per-vehicle poll on top of it is pure
   * duplication — the exact N+1 the batch endpoint exists to remove.
   *
   * The per-vehicle read therefore polls only as BOUNDED RECOVERY: it stands
   * down while the seeded reading is confirmed fresh, and resumes the moment
   * that reading ages out (batch not mounted on this surface, or failing).
   * Manual refresh and SSE reconnect recovery are unaffected. */
  const [recoveryInterval, setRecoveryInterval] = useState<number | false>(INTERVALS.STANDARD);
  const { data: stateData, error, isFetching, isError, refetch } = useVehicleState(id, {
    refetchInterval: recoveryInterval,
  });
  /* Freshness must describe the OBSERVATION, not the request.
   *
   * `dataUpdatedAt` is when the fetch completed, so a vehicle that has not
   * emitted telemetry in an hour still rendered "updated just now" on every
   * poll — and after a failed poll TanStack keeps the previous data while the
   * timestamp of the *next* success moves again. `observedAt` comes from the
   * backend's newest real live signal and never advances on a failed read. */
  const observedAt = stateData?.observedAt ?? undefined;
  const [freshnessClock, setFreshnessClock] = useState(0);
  const freshness = useMemo(
    () => resolveVehicleStateFreshness(
      stateData?.freshness,
      observedAt ?? null,
    ),
    [stateData?.freshness, observedAt, freshnessClock],
  );
  const trusted = freshness === 'fresh';
  useEffect(() => {
    if (stateData?.freshness !== 'fresh' || observedAt == null) return undefined;
    const remaining = observedAt + TELEMETRY_STALE_AFTER_MS - Date.now();
    if (remaining <= 0) return undefined;
    const timer = window.setTimeout(
      () => setFreshnessClock((version) => version + 1),
      remaining + 1,
    );
    return () => window.clearTimeout(timer);
  }, [stateData?.freshness, observedAt]);
  useEffect(() => {
    setRecoveryInterval(trusted ? false : INTERVALS.STANDARD);
  }, [trusted]);
  /* State values arrive in SI units: range/odometer in meters and
   * temperatures in °C. Convert at the display boundary only. The callbacks
   * are memoised on their unit preference so a background re-render (the state
   * query polls) does not hand the body fresh function identities each time. */
  const { unitPrefs } = useUnits();

  const distanceUnit = unitPrefs.distance;
  const tempUnit = unitPrefs.temperature;
  const toDistanceDisplay = useCallback(
    (meters: number) => convertDistanceFromSI(meters, distanceUnit),
    [distanceUnit],
  );
  const toTemperatureDisplay = useCallback(
    (celsius: number) => convertTempFromSI(celsius, tempUnit),
    [tempUnit],
  );
  const handleRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const dataState = deriveDataState({
    data: vehicle ? { vehicle, stateData } : vehiclesLoading || vehiclesError || isError ? undefined : null,
    error: error ?? (!vehicle ? vehiclesError : null),
    isError,
    isFetching,
    dataUpdatedAt: observedAt,
    refetch,
  });

  const state = stateData?.state ?? null;
  const verifiedFields = stateData?.verifiedFields ?? EMPTY_VERIFIED_FIELDS;
  /* The shared precedence: verified charging → verified motion → verified FSM
   * state. `null` means Unknown and is rendered as such — it must never fall
   * through to "offline". */
  const status = deriveTrustedVehicleStatus(state, {
    freshness,
    observedAt: observedAt ?? null,
    verifiedFields,
  });
  const unknownStatus = status == null;

  const batteryLevel =
    state?.battery_level != null && Number.isFinite(state.battery_level)
      ? state.battery_level
      : null;
  const rangeDisplay =
    state?.rated_range != null && Number.isFinite(state.rated_range)
      ? toDistanceDisplay(state.rated_range)
      : null;
  /* The charge limit is not part of the typed VehicleState contract; extended
   * state payloads may carry it as `charge_limit_soc` (the same defensive
   * read BatteryLinearGaugeWidget performs). A non-finite or out-of-range
   * value never reaches the meter marker. */
  const chargeLimitRaw = (state as Record<string, unknown> | null)?.charge_limit_soc;
  const chargeLimit =
    typeof chargeLimitRaw === 'number' &&
    Number.isFinite(chargeLimitRaw) &&
    chargeLimitRaw >= 0 &&
    chargeLimitRaw <= 100
      ? chargeLimitRaw
      : null;
  const etaHours = state?.time_to_full_charge;
  const hasEta = etaHours != null && Number.isFinite(etaHours) && etaHours > 0;
  const isCharging = status === 'charging';
  const batteryTone =
    batteryLevel == null ? 'ok' : batteryLevel <= 20 ? 'bad' : batteryLevel <= 40 ? 'warn' : 'ok';
  const batteryFillClass =
    batteryTone === 'bad'
      ? 'bg-[var(--semantic-danger)]'
      : batteryTone === 'warn'
        ? 'bg-[var(--semantic-warning)]'
        : 'bg-[var(--semantic-success)]';
  const remainingPct =
    isCharging && chargeLimit != null && batteryLevel != null
      ? Math.max(0, Math.round(chargeLimit - batteryLevel))
      : null;

  const vehicleName = vehicle ? vehicle.display_name || vehicle.vin : '';
  const modelLine = vehicle
    ? [vehicle.model, vehicle.trim_badging].filter(Boolean).join(' ')
    : '';
  /* Subtitle: FSM state + how long the vehicle has been in it (`since`).
   * The preview's place name ("Home") has no data source in the existing
   * state hooks, so it is omitted rather than fabricated. */
  const fsmState =
    state?.state && (Object.keys(VEHICLE_STATE_LABELS) as VehicleState[]).includes(state.state as VehicleState)
      ? (state.state as VehicleState)
      : null;
  const sinceMs = state?.since ? Date.parse(state.since) : Number.NaN;
  const sinceDuration = Number.isFinite(sinceMs)
    ? (() => {
        const elapsedSeconds = Math.max(0, Math.floor((Date.now() - sinceMs) / 1000));
        return formatDurationSecondsAsMinutes(elapsedSeconds);
      })()
    : null;
  const subtitle = state
    ? [
        fsmState
          ? VEHICLE_STATE_LABELS[fsmState]
          : null,
        sinceDuration,
      ]
        .filter(Boolean)
        .join(' ') || null
    : null;

  const footer = vehicle ? (
    <span className="flex w-full min-w-0 items-center justify-between gap-2">
      <span>
        {t('widget.verifiedFields', '{{count}} verified fields', {
          count: verifiedFields.length,
        })}
      </span>
      <Link
        to={`/vehicles/${vehicle.id}`}
        className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center font-medium text-[var(--text-primary)]"
      >
        {t('hero.details', 'Details')} <span aria-hidden="true">→</span>
      </Link>
    </span>
  ) : undefined;

  return (
    <WidgetShell
      title={!vehicle || vehiclesLoading ? t('glance.overviewAria', 'Vehicle overview') : undefined}
      loading={vehiclesLoading}
      dataState={dataState}
      footer={footer}
      // `0` means "no verified observation" to WidgetShell (it renders the
      // freshness control with a null timestamp). Passing `undefined` would
      // HIDE the freshness + refresh control entirely — exactly when the user
      // most needs it.
      updatedAt={observedAt ?? 0}
      refreshIntervalMs={recoveryInterval || undefined}
      isFetching={isFetching}
      isStale={!trusted}
      isError={isError}
      onRefresh={handleRefresh}
    >
      {vehicle ? (
        <div className="flex min-w-0 flex-col gap-3">
          {/* Vehicle name + model, with the trusted status pill. */}
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <Heading level="section" className="min-w-0 max-w-full break-words text-base">
                {modelLine ? `${vehicleName} · ${modelLine}` : vehicleName}
              </Heading>
              {subtitle ? (
                <Text as="p" size="sm" color="secondary">
                  {subtitle}
                </Text>
              ) : state == null ? (
                <Text as="p" size="sm" color="muted">
                  {t('hero.noReadings', 'No vehicle readings available')}
                </Text>
              ) : null}
            </div>
            {unknownStatus ? (
              <span
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)]"
                title={t('hero.unknownHelp', 'No current, verified telemetry backs an operational state for this vehicle.')}
              >
                <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
                {unknownReading}
              </span>
            ) : (
              <StatusBadge status={status} size="sm" showDot />
            )}
          </div>

          {/* Headline battery + estimated range. Each value appears once. */}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <WidgetBigNumber
              value={batteryLevel}
              unit="%"
              label={t('hero.battery', 'Battery')}
              decimals={0}
              animated={false}
            />
            <div role="group" aria-label={rangeLabel} aria-description={rangeDisplay == null ? unknownReading : undefined} className="text-right">
              <Text as="p" size="sm" color="secondary">
                {rangeLabel}
              </Text>
              <p className="text-xl font-semibold tabular-nums text-[var(--text-primary)]">
                {rangeDisplay != null ? fmtNumber(rangeDisplay, 0) : '—'}
                {rangeDisplay != null && (
                  <span className="text-xs font-normal text-[var(--text-secondary)]"> {distanceUnit}</span>
                )}
              </p>
            </div>
          </div>

          {/* Battery meter against the charge limit (a meaningful scale). */}
          <div>
            {chargeLimit != null && (
              <div className="relative h-4" aria-hidden="true">
                <span
                  className="absolute -translate-x-1/2 text-xs whitespace-nowrap text-[var(--text-muted)]"
                  style={{ left: `${chargeLimit}%` }}
                >
                  {t('widget.chargeLimit', 'Limit')} {fmtNumber(chargeLimit, 0)}%
                </span>
              </div>
            )}
            <div
              role={batteryLevel != null ? 'meter' : 'group'}
              aria-label={t('hero.battery', 'Battery')}
              aria-description={batteryLevel == null ? unknownReading : undefined}
              aria-valuenow={batteryLevel != null ? Math.round(batteryLevel) : undefined}
              aria-valuemin={batteryLevel != null ? 0 : undefined}
              aria-valuemax={batteryLevel != null ? 100 : undefined}
              aria-valuetext={batteryLevel != null ? `${fmtNumber(batteryLevel, 0)}%` : undefined}
              className="relative h-3 w-full overflow-visible rounded-shape-sm bg-[var(--surface-2)]"
            >
              {batteryLevel != null && (
                <div
                  className={`${batteryFillClass} h-full rounded-shape-sm transition-[width] duration-slow ease-out motion-reduce:transition-none`}
                  style={{ width: `${Math.min(100, Math.max(0, batteryLevel))}%` }}
                />
              )}
              {chargeLimit != null && (
                <span
                  data-testid="charge-limit-marker"
                  title={`${t('widget.chargeLimit', 'Limit')} ${fmtNumber(chargeLimit, 0)}%`}
                  className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-[var(--text-primary)]/70"
                  style={{ left: `${chargeLimit}%` }}
                />
              )}
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-2 text-xs tabular-nums text-[var(--text-muted)]">
              <span>0%</span>
              <span className="text-center">
                {isCharging && (remainingPct != null || hasEta) ? (
                  <>
                    {remainingPct != null && <>+{remainingPct}%</>}
                    {remainingPct != null && hasEta && <> · </>}
                    {hasEta && <ChargeDoneAt etaHours={etaHours} />}
                  </>
                ) : null}
              </span>
              <span>100%</span>
            </div>
          </div>

          {/* Access + cabin chips. */}
          <div className="flex flex-wrap gap-2">
            <Chip
              icon={
                state?.is_locked ? (
                  <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Unlock className="h-3.5 w-3.5" aria-hidden="true" />
                )
              }
            >
              {state?.is_locked == null
                ? '—'
                : state.is_locked
                  ? t('common.locked', 'Locked')
                  : t('common.unlocked', 'Unlocked')}
            </Chip>
            <Chip>
              {t('common.sentry', 'Sentry')}{' '}
              <span className="font-semibold text-[var(--text-primary)]">
                {state?.sentry_mode == null
                  ? '—'
                  : state.sentry_mode
                    ? t('common.on', 'On')
                    : t('common.off', 'Off')}
              </span>
            </Chip>
            <Chip
              label={t('hero.inside', 'Inside')}
              description={state?.inside_temp == null || !Number.isFinite(state.inside_temp) ? unknownReading : undefined}
            >
              <span className="font-semibold text-[var(--text-primary)]">
                {tempChipText(state?.inside_temp, toTemperatureDisplay, tempUnit, (v, d) => fmtNumber(v, d))}
              </span>
            </Chip>
            <Chip
              label={t('hero.outside', 'Outside')}
              description={state?.outside_temp == null || !Number.isFinite(state.outside_temp) ? unknownReading : undefined}
            >
              <span className="font-semibold text-[var(--text-primary)]">
                {tempChipText(state?.outside_temp, toTemperatureDisplay, tempUnit, (v, d) => fmtNumber(v, d))}
              </span>
            </Chip>
          </div>
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when no vehicle is linked; no specific recovery action available */
          icon={<Car className="h-5 w-5" />}
          message={t('widget.noVehicle', 'No vehicle data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
