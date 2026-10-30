import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Battery } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { knownNumber } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid } from './shared';
import { batteryColor } from './BatteryGaugeWidget';
import { ChargeBatteryPack, ChargeMeter, useVerifiedChargeActivity } from './instruments/ChargeInstruments';
import type { WidgetProps } from './types';

export default function BatteryLinearGaugeWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const query = useVehicleState(id);
  const { data: stateData, isLoading, isFetching, isStale, isError, error, dataUpdatedAt, refetch } = query;
  const trust = useDataState(query, { provenance: stateData?.live ? 'live' : 'cached', maxAgeMs: 120_000 });
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const state = stateData?.state;
  const active = useVerifiedChargeActivity(query);

  const isCompact = size.cols === 1 && size.rows === 1;

  const batteryLevel = knownNumber(state?.battery_level);
  /* SI-floor: state.rated_range arrives in METERS; convert only for display. */
  const ratedRange = knownNumber(state?.rated_range);
  const rangeText =
    ratedRange != null ? `${fmtNumber(convertDistanceFromSI(ratedRange, distanceUnit), 0)} ${distanceUnit}` : null;
  // charge_limit_soc may be present on extended state payloads. Validate it is
  // a finite number before use so a malformed field never leaks a NaN into the
  // gauge overlay or the stat row.
  const chargeLimitRaw = (state as Record<string, unknown> | undefined)?.charge_limit_soc;
  const chargeLimitSoc =
    typeof chargeLimitRaw === 'number' && Number.isFinite(chargeLimitRaw) && chargeLimitRaw >= 0 && chargeLimitRaw <= 100 ? chargeLimitRaw : undefined;
  const denseShort = size.rows <= 2 && (chargeLimitSoc != null || state?.is_charging === true);

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.batteryLevel', 'Battery')}
      icon={isCompact ? undefined : <Battery className="h-3.5 w-3.5 text-[var(--text-muted)]" />}
      loading={isLoading}
      dataState={stateData != null || isLoading || isError || error ? trust : undefined}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      <div className="flex min-w-0 flex-col gap-2">
        {batteryLevel != null ? (
          <div className={`flex w-full min-w-0 flex-col ${size.rows <= 2 ? 'gap-2' : 'gap-3'}`}>
            <div className="flex min-w-0 items-center justify-between gap-3">
              <WidgetBigNumber value={batteryLevel} unit="%" decimals={0} animated={false} />
              <ChargeBatteryPack level={batteryLevel} active={active} className={isCompact || denseShort ? 'w-20' : 'w-28'} />
            </div>
            <ChargeMeter
              value={batteryLevel}
              label={t('widget.batteryLevel', 'Battery')}
              color={batteryColor(batteryLevel)}
              marker={chargeLimitSoc}
              markerLabel={chargeLimitSoc != null ? `${t('widget.chargeLimit', 'Limit')} ${chargeLimitSoc}%` : undefined}
              preserveOutOfScaleMarker
              active={active}
            />
            {!isCompact && (rangeText != null || state?.is_charging) && (
              <div className={denseShort ? 'flex min-w-0 flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center' : 'flex min-w-0 flex-col items-center gap-1 text-center'}>
                {rangeText != null && (
                  <p className="text-xs leading-snug text-[var(--text-muted)]">
                    {t('widget.batteryGauge.range', '{{range}} range', { range: rangeText })}
                  </p>
                )}
                {state?.is_charging && (
                  <p className="text-xs leading-snug text-[var(--text-muted)]">
                    {chargeLimitSoc != null
                      ? `${t('widget.charging', 'Charging')} · ${t('widget.chargeLimit', 'Limit')} ${chargeLimitSoc}%`
                      : t('widget.charging', 'Charging')}
                  </p>
                )}
              </div>
            )}
          </div>
        ) : state ? (
          <>
            <WidgetBigNumber value={null} label={t('widget.batteryLevel', 'Battery')} />
            {!isCompact && chargeLimitSoc != null && (
              <WidgetStatGrid stats={[{ label: t('widget.chargeLimit', 'Limit'), value: chargeLimitSoc, unit: '%' }]} />
            )}
          </>
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<Battery className="h-6 w-6" />}
            message={t('widget.noBattery', 'No battery data')}
            className="py-4"
          />
        )}
      </div>
    </WidgetShell>
  );
}
