import { useTranslation } from 'react-i18next';
import { Battery } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { knownNumber } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';
import { gaugeTone } from '@/lib/tokens';
import { fmtNumber } from '@/lib/numberFormat';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { WidgetBigNumber } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

/**
 * Maps a state-of-charge percentage to the gauge fill colour. A
 * `null`/`undefined` level (a snapshot that has not landed yet) renders the
 * neutral grey rather than a misleading "critical" red.
 */
export function batteryColor(level: number | null | undefined): string {
  if (level == null || !Number.isFinite(level)) return gaugeTone.neutral;
  if (level > 50) return gaugeTone.success;
  if (level > 20) return gaugeTone.warning;
  return gaugeTone.danger;
}

export default function BatteryGaugeWidget({ vehicleId }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const query = useVehicleState(id);
  const { data: stateData, isLoading, isFetching, isStale, isError, error, dataUpdatedAt, refetch } = query;
  const trust = useDataState(query, { provenance: stateData?.live ? 'live' : 'cached', maxAgeMs: 120_000 });
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const state = stateData?.state;
  const batteryLevel = knownNumber(state?.battery_level);
  /* SI-floor: state.rated_range arrives in METERS; convert only for display. */
  const ratedRange = knownNumber(state?.rated_range);
  // charge_limit_soc may be present on extended state payloads (same source
  // BatteryLinearGaugeWidget reads). Validate it is a finite 0–100 number
  // before use so a malformed field never leaks a NaN into the marker.
  const chargeLimitRaw = (state as Record<string, unknown> | undefined)?.charge_limit_soc;
  const chargeLimit =
    typeof chargeLimitRaw === 'number' && Number.isFinite(chargeLimitRaw) && chargeLimitRaw >= 0 && chargeLimitRaw <= 100
      ? chargeLimitRaw
      : null;
  const clampedLevel = batteryLevel != null ? Math.min(100, Math.max(0, batteryLevel)) : null;
  // An out-of-scale reading is retained as the headline number but never
  // drawn as a clipped meter (it would read as a reachable 0%/100%).
  const inScale = batteryLevel != null && batteryLevel >= 0 && batteryLevel <= 100;
  const remainingToLimit =
    chargeLimit != null && batteryLevel != null ? Math.round(chargeLimit - batteryLevel) : null;
  const rangeText =
    ratedRange != null ? `${fmtNumber(convertDistanceFromSI(ratedRange, distanceUnit), 0)} ${distanceUnit}` : null;

  return (
    <WidgetShell
      title={t('widget.battery', 'Battery')}
      loading={isLoading}
      dataState={stateData != null || isLoading || isError || error ? trust : undefined}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      <div className="flex min-w-0 flex-col gap-2">
        {batteryLevel != null && clampedLevel != null ? (
          <>
            <WidgetBigNumber value={batteryLevel} unit="%" decimals={0} animated={false} />
            {inScale && (
            <div
              role="meter"
              aria-label={t('widget.battery', 'Battery')}
              aria-valuenow={clampedLevel}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuetext={`${fmtNumber(batteryLevel, 0)}%`}
              className="w-full min-w-0"
            >
              {chargeLimit != null && (
                <div className="relative h-4" aria-hidden="true">
                  <span
                    className="absolute bottom-0 -translate-x-1/2 text-xs font-medium whitespace-nowrap text-[var(--text-muted)]"
                    style={{ left: `${chargeLimit}%` }}
                  >
                    {fmtNumber(chargeLimit, 0)}%
                  </span>
                </div>
              )}
              <div className="relative h-3 w-full rounded-full bg-[var(--surface-2)]">
                <div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{ width: `${clampedLevel}%`, backgroundColor: batteryColor(batteryLevel) }}
                />
                {chargeLimit != null && (
                  <span
                    data-testid="gauge-marker"
                    title={t('widget.batteryGauge.limitMarker', 'Charge limit {{pct}}%', { pct: fmtNumber(chargeLimit, 0) })}
                    className="pointer-events-none absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-[var(--text-primary)]"
                    style={{ left: `${chargeLimit}%` }}
                  />
                )}
              </div>
            </div>
            )}
            {state?.is_charging && (
              <p className="text-xs leading-snug text-[var(--text-muted)]">
                {remainingToLimit != null && remainingToLimit > 0
                  ? t('widget.batteryGauge.chargingToLimit', 'Charging · +{{pct}}% to limit', { pct: remainingToLimit })
                  : t('widget.charging', 'Charging')}
              </p>
            )}
            {rangeText != null && (
              <p className="text-xs leading-snug text-[var(--text-muted)]">
                {t('widget.batteryGauge.range', '{{range}} range', { range: rangeText })}
              </p>
            )}
          </>
        ) : state ? (
          <WidgetBigNumber value={null} label={t('widget.battery', 'Battery')} />
        ) : (
          <EmptyState
            icon={<Battery className="h-6 w-6" />}
            message={t('widget.noBattery', 'No battery data')}
            action={{ label: t('common.refresh', 'Refresh'), onClick: () => { void refetch(); } }}
            className="py-4"
          />
        )}
      </div>
    </WidgetShell>
  );
}
