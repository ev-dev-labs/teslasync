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
import { ChargeBatteryPack, ChargeMeter, useVerifiedChargeActivity } from './instruments/ChargeInstruments';
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
  const active = useVerifiedChargeActivity(query);
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
        {batteryLevel != null ? (
          <>
            <div className="flex min-w-0 items-center justify-between gap-3">
              <WidgetBigNumber value={batteryLevel} unit="%" decimals={0} animated={false} />
              <ChargeBatteryPack level={batteryLevel} active={active} />
            </div>
            <ChargeMeter
              value={batteryLevel}
              label={t('widget.battery', 'Battery')}
              marker={chargeLimit}
              markerLabel={chargeLimit != null ? t('widget.batteryGauge.limitMarker', 'Charge limit {{pct}}%', { pct: fmtNumber(chargeLimit, 0) }) : undefined}
              color={batteryColor(batteryLevel)}
              active={active}
            />
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
