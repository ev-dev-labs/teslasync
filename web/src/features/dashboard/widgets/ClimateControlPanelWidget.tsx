import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Thermometer } from 'lucide-react';
import { Badge, Text } from '@/components/ui';
import { deriveDataState } from '@/api/dataState';
import { EmptyState } from '@/components/feedback';
import { useVehicles, useClimateLatest } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { resolveHvacActive } from '@/lib/climateState';

import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber } from './shared';
import type { WidgetProps } from './types';
import { convertTempFromSI } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { dashboardTokens } from '../lib/dashboardTokens';
import { cn } from '@/lib/cn';
import ClimateAirflow from './vehicle-instruments/ClimateAirflow';
import { useObservationCurrent } from './vehicle-instruments/useObservationCurrent';

export default function ClimateControlPanelWidget({ vehicleId, size }: WidgetProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { data: vehicles, isLoading: vehiclesLoading, error: vehiclesError } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { data: climateData, error, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = useClimateLatest(id, 5_000);
  const { unitPrefs } = useUnits();
  const toTemperatureDisplay = useCallback(
    (value: number) => convertTempFromSI(value, unitPrefs.temperature),
    [unitPrefs.temperature],
  );

  const tempUnit = unitPrefs.temperature;
  const observationCurrent = useObservationCurrent(climateData?.ts, !isError);

  const isCompact = size.cols <= 1 && size.rows <= 1;

  const temps = useMemo(() => {
    if (!climateData) return null;
    const inside = climateData.inside_temp_c ?? climateData.inside_temp;
    const outside = climateData.outside_temp_c ?? climateData.outside_temp;
    const driverSetpoint = climateData.driver_setpoint_c ?? climateData.driver_temp_setting;
    return {
      inside: inside != null && Number.isFinite(inside) ? fmtInt(toTemperatureDisplay(inside)) : null,
      outside: outside != null && Number.isFinite(outside) ? fmtInt(toTemperatureDisplay(outside)) : null,
      setpoint: driverSetpoint != null && Number.isFinite(driverSetpoint)
        ? fmtInt(toTemperatureDisplay(driverSetpoint))
        : null,
    };
  }, [climateData, toTemperatureDisplay, fmtInt]);

  const loading = isLoading || (vehiclesLoading && !id);
  const queryError = error ?? (!id ? vehiclesError : null);
  const dataState = deriveDataState({
    data: climateData ?? (loading || queryError || isError ? undefined : null),
    error: queryError,
    isError,
    isFetching,
    dataUpdatedAt,
    refetch,
  });

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.climatePanel.title', 'Climate control')}
      icon={isCompact ? undefined : <Thermometer className="h-3.5 w-3.5 text-[var(--semantic-info)]" />}
      loading={loading}
      dataState={dataState}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {climateData ? (
        isCompact ? (
          <CompactView inside={temps?.inside ?? null} tempUnit={tempUnit} />
        ) : (
          <FullView
            climateData={climateData}
            toTemperatureDisplay={toTemperatureDisplay}
            tempUnit={tempUnit}
            t={t}
            observationCurrent={observationCurrent}
          />
        )
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Thermometer className="h-5 w-5" />}
          message={t('widget.climatePanel.noData', 'No climate data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}

/* ── Compact: single temperature display ── */
function CompactView({ inside, tempUnit }: { inside: string | null; tempUnit: string }) {
  return (
    <WidgetBigNumber value={inside != null ? `${inside}${tempUnit}` : null} />
  );
}

/* ── Full 2x2 view ── */
interface FullViewProps {
  climateData: NonNullable<ReturnType<typeof useClimateLatest>['data']>;
  toTemperatureDisplay: (value: number) => number;
  tempUnit: string;
  t: (k: string, f: string) => string;
  observationCurrent: boolean;
}

function FullView({ climateData, toTemperatureDisplay, tempUnit, t, observationCurrent }: FullViewProps) {
  const { fmtInt } = useNumberFormatting();
  const hvacState = resolveHvacActive(climateData.hvac_power, climateData.is_ac_on);
  const inside = climateData.inside_temp_c ?? climateData.inside_temp;
  const outside = climateData.outside_temp_c ?? climateData.outside_temp;
  const setpoint = climateData.driver_setpoint_c ?? climateData.driver_temp_setting;
  const insideValue = inside != null && Number.isFinite(inside) ? fmtInt(toTemperatureDisplay(inside)) : null;
  const outsideValue = outside != null && Number.isFinite(outside) ? fmtInt(toTemperatureDisplay(outside)) : null;
  const setpointValue = setpoint != null && Number.isFinite(setpoint) ? fmtInt(toTemperatureDisplay(setpoint)) : null;

  const seatValues = [
    { label: t('widget.climatePanel.seatFL', 'FL'), value: climateData.seat_heater_left },
    { label: t('widget.climatePanel.seatFR', 'FR'), value: climateData.seat_heater_right },
    { label: t('widget.climatePanel.seatRL', 'RL'), value: climateData.seat_heater_rear_left },
    { label: t('widget.climatePanel.seatRC', 'RC'), value: climateData.seat_heater_rear_center },
    { label: t('widget.climatePanel.seatRR', 'RR'), value: climateData.seat_heater_rear_right },
  ];
  const activeSeats = seatValues.filter(({ value }) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0,
  );
  const seatSummary = activeSeats.length > 0
    ? activeSeats.map(({ label, value }) => `${label}${value}/3`).join(' · ')
    : seatValues.every(({ value }) => typeof value === 'number' && Number.isFinite(value))
      ? t('widget.climatePanel.off', 'Off')
      : seatValues.some(({ value }) => value == null)
        ? t('hero.unknownStatus', 'Unknown')
        : null;
  const steeringLevel = climateData.hvac_steering_wheel_heat_level;
  const wheelHeat = typeof steeringLevel === 'number' && Number.isFinite(steeringLevel)
    ? steeringLevel > 0 ? `${steeringLevel}/3` : t('widget.climatePanel.off', 'Off')
    : null;
  const overheat = climateData.cabin_overheat_protection;
  const fanLevel = climateData.fan_speed ?? climateData.fan_status ?? climateData.hvac_fan_status ?? climateData.hvac_fan_speed;

  return (
    <div className="flex h-full min-w-0 flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <WidgetBigNumber
            value={insideValue}
            unit={insideValue != null ? tempUnit : undefined}
            label={setpointValue != null
              ? `${t('hero.inside', 'Inside')} · ${t('widget.climatePanel.set', 'set')} ${setpointValue}${tempUnit}`
              : t('hero.inside', 'Inside')}
            animated={false}
          />
        </div>
        <div className="shrink-0 text-end">
          <p className={dashboardTokens.metricLabel}>{t('widget.climatePanel.outside', 'Outside')}</p>
          <p className={cn(dashboardTokens.secondaryMetric, 'mt-1')}>
            {outsideValue != null ? `${outsideValue}${tempUnit}` : '—'}
          </p>
        </div>
      </div>

      <ClimateAirflow active={hvacState === true && observationCurrent} />

      <div className="flex flex-wrap items-center gap-2">
        {hvacState !== null && (
          <span className="inline-flex items-center gap-2 text-sm text-[var(--text-primary)]">
            <span aria-hidden="true" className={cn(
              'size-2 rounded-full',
              hvacState ? 'bg-[var(--semantic-success)]' : 'bg-[var(--text-secondary)]',
            )} />
            {hvacState
              ? t('widget.climatePanel.hvacOn', 'HVAC on')
              : t('widget.climatePanel.hvacOff', 'HVAC off')}
          </span>
        )}
        {typeof fanLevel === 'number' && Number.isFinite(fanLevel) && (
          <Badge variant="neutral" size="sm">
            {t('widget.climatePanel.fanShort', 'Fan')} {fmtInt(fanLevel)}
          </Badge>
        )}
        {typeof climateData.defrost_mode === 'string' && climateData.defrost_mode !== 'Off' && climateData.defrost_mode.trim() !== '' && (
          <Badge variant="info" size="sm">
            {t('widget.climatePanel.defrost', 'Defrost')}
          </Badge>
        )}
      </div>

      {(seatSummary || wheelHeat != null || typeof overheat === 'boolean' || climateData.battery_heater != null) && (
        <div className={cn('grid grid-cols-1 @xs:grid-cols-2', dashboardTokens.density.gridGap)}>
          {seatSummary && (
            <StatusTile label={t('widget.climatePanel.seats', 'Seats')} value={seatSummary} />
          )}
          {wheelHeat != null && (
            <StatusTile label={t('widget.climatePanel.steeringHeat', 'Steering heat')} value={wheelHeat} />
          )}
          {typeof overheat === 'boolean' && (
            <StatusTile
              label={t('widget.climatePanel.cabinOverheat', 'Cabin overheat')}
              value={overheat ? t('widget.climatePanel.on', 'On') : t('widget.climatePanel.off', 'Off')}
            />
          )}
          {typeof climateData.battery_heater === 'boolean' && (
            <StatusTile
              label={t('widget.climatePanel.batHeater', 'Battery heater')}
              value={climateData.battery_heater ? t('widget.climatePanel.on', 'On') : t('widget.climatePanel.off', 'Off')}
            />
          )}
        </div>
      )}
    </div>
  );
}

function StatusTile({ label, value }: { label: string; value: string }) {
  return (
    <div className={cn('min-w-0 border border-[var(--border-subtle)] bg-[var(--surface-2)]', dashboardTokens.radius.inner, dashboardTokens.density.itemPadding)}>
      <Text as="p" variant="caption">{label}</Text>
      <Text as="p" variant="bodySm" weight="semibold" className="mt-1 break-words tabular-nums" title={value}>{value}</Text>
    </div>
  );
}
