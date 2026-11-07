import { useCallback, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Thermometer } from 'lucide-react';
import { Badge, Caption, Text } from '@/components/ui';
import { deriveDataState } from '@/api/dataState';
import { EmptyState } from '@/components/feedback';
import { useVehicles, useClimateLatest } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { resolveHvacActive } from '@/lib/climateState';

import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber } from './shared';
import WidgetClimateReadout from './shared/WidgetClimateReadout';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
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
    isStale,
    dataUpdatedAt,
    refetch,
  }, { unavailable: !climateData });
  const emptyState = (
    <EmptyState /* no-action: transient source absence; refresh remains available in the shell */
      icon={<Thermometer className="h-5 w-5" />}
      message={t('widget.climatePanel.noData', 'No climate data')}
      className="py-4"
    />
  );

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
      {isCompact ? (
        <CompactView inside={temps?.inside ?? null} tempUnit={tempUnit}
          hasData={climateData != null} emptyState={emptyState} />
      ) : (
        <FullView
          climateData={climateData ?? null}
          toTemperatureDisplay={toTemperatureDisplay}
          tempUnit={tempUnit}
          t={t}
          observationCurrent={observationCurrent}
          emptyState={emptyState}
        />
      )}
    </WidgetShell>
  );
}

/* ── Compact: single temperature display ── */
function CompactView({ inside, tempUnit, hasData, emptyState }: {
  inside: string | null; tempUnit: string; hasData: boolean; emptyState: ReactNode;
}) {
  const headline = <WidgetClimateReadout>
    <WidgetBigNumber value={inside != null ? `${inside}${tempUnit}` : null} />
  </WidgetClimateReadout>;
  return (
    <InstrumentPresentation family="climate" compact headline={headline} icon={<Thermometer />}
      instrument={!hasData ? emptyState : undefined}>
      {hasData ? headline : emptyState}
    </InstrumentPresentation>
  );
}

/* ── Full 2x2 view ── */
interface FullViewProps {
  climateData: NonNullable<ReturnType<typeof useClimateLatest>['data']> | null;
  toTemperatureDisplay: (value: number) => number;
  tempUnit: string;
  t: (k: string, f: string) => string;
  observationCurrent: boolean;
  emptyState: ReactNode;
}

function FullView({ climateData, toTemperatureDisplay, tempUnit, t, observationCurrent, emptyState }: FullViewProps) {
  const { fmtInt } = useNumberFormatting();
  const hvacState = resolveHvacActive(climateData?.hvac_power, climateData?.is_ac_on);
  const inside = climateData?.inside_temp_c ?? climateData?.inside_temp;
  const outside = climateData?.outside_temp_c ?? climateData?.outside_temp;
  const setpoint = climateData?.driver_setpoint_c ?? climateData?.driver_temp_setting;
  const insideValue = inside != null && Number.isFinite(inside) ? fmtInt(toTemperatureDisplay(inside)) : null;
  const outsideValue = outside != null && Number.isFinite(outside) ? fmtInt(toTemperatureDisplay(outside)) : null;
  const setpointValue = setpoint != null && Number.isFinite(setpoint) ? fmtInt(toTemperatureDisplay(setpoint)) : null;

  const seatValues = [
    { label: t('widget.climatePanel.seatFL', 'FL'), value: climateData?.seat_heater_left },
    { label: t('widget.climatePanel.seatFR', 'FR'), value: climateData?.seat_heater_right },
    { label: t('widget.climatePanel.seatRL', 'RL'), value: climateData?.seat_heater_rear_left },
    { label: t('widget.climatePanel.seatRC', 'RC'), value: climateData?.seat_heater_rear_center },
    { label: t('widget.climatePanel.seatRR', 'RR'), value: climateData?.seat_heater_rear_right },
  ].map(seat => ({ ...seat, value: knownHeatLevel(seat.value) }));
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
  const steeringLevel = knownHeatLevel(climateData?.hvac_steering_wheel_heat_level);
  const wheelHeat = typeof steeringLevel === 'number' && Number.isFinite(steeringLevel)
    ? steeringLevel > 0 ? `${steeringLevel}/3` : t('widget.climatePanel.off', 'Off')
    : null;
  const overheat = climateData?.cabin_overheat_protection;
  const fanLevel = climateData?.fan_speed ?? climateData?.fan_status ?? climateData?.hvac_fan_status ?? climateData?.hvac_fan_speed;
  const fanKnown = typeof fanLevel === 'number' && Number.isInteger(fanLevel) && fanLevel >= 0;
  const defrost = climateData?.defrost_mode;
  const defrostActive = typeof defrost === 'string' && defrost !== 'Off' && defrost.trim() !== '';
  const unknown = t('hero.unknownStatus', 'Unknown');
  const headline = (
    <WidgetClimateReadout>
      <WidgetBigNumber
        value={insideValue}
        unit={insideValue != null ? tempUnit : undefined}
        label={setpointValue != null
          ? `${t('hero.inside', 'Inside')} · ${t('widget.climatePanel.set', 'set')} ${setpointValue}${tempUnit}`
          : t('hero.inside', 'Inside')}
        animated={false}
      />
    </WidgetClimateReadout>
  );
  const airflow = <ClimateAirflow active={hvacState === true && observationCurrent} />;
  const indicators = (
    <div className="flex flex-wrap items-center gap-2">
      {hvacState !== null && (
        <Text as="span" variant="bodySm" className="inline-flex items-center gap-2">
          <span aria-hidden="true" className={cn(
            'size-2 rounded-full',
            hvacState ? 'bg-[var(--semantic-success)]' : 'bg-[var(--text-secondary)]',
          )} />
          {hvacState
            ? t('widget.climatePanel.hvacOn', 'HVAC on')
            : t('widget.climatePanel.hvacOff', 'HVAC off')}
        </Text>
      )}
      {fanKnown && (
        <Badge variant="neutral" size="sm">
          {t('widget.climatePanel.fanShort', 'Fan')} {fmtInt(fanLevel)}
        </Badge>
      )}
      {defrostActive && (
        <Badge variant="info" size="sm">
          {t('widget.climatePanel.defrost', 'Defrost')}
        </Badge>
      )}
    </div>
  );
  const statuses = [
    { id: 'seats', label: t('widget.climatePanel.seats', 'Seats'), value: seatSummary },
    { id: 'steering', label: t('widget.climatePanel.steeringHeat', 'Steering heat'), value: wheelHeat },
    { id: 'overheat', label: t('widget.climatePanel.cabinOverheat', 'Cabin overheat'),
      value: typeof overheat === 'boolean' ? overheat ? t('widget.climatePanel.on', 'On') : t('widget.climatePanel.off', 'Off') : null },
    { id: 'battery', label: t('widget.climatePanel.batHeater', 'Battery heater'),
      value: typeof climateData?.battery_heater === 'boolean'
        ? climateData.battery_heater ? t('widget.climatePanel.on', 'On') : t('widget.climatePanel.off', 'Off') : null },
  ];
  const knownStatuses = statuses.filter(({ value }) => value != null);

  return (
    <InstrumentPresentation
      family="climate" headline={headline} icon={<Thermometer />}
      context={<div className="space-y-2">
        {indicators}
        {(hvacState === null || !fanKnown || !defrostActive) && (
          <div className="flex flex-wrap gap-2">
            {hvacState === null && <Badge variant="neutral" size="sm">{t('widget.climatePanel.hvacUnknown', 'HVAC unknown')}</Badge>}
            {!fanKnown && <Badge variant="neutral" size="sm">{t('widget.climatePanel.fanShort', 'Fan')} · {unknown}</Badge>}
            {!defrostActive && <Badge variant="neutral" size="sm">
              {t('widget.climatePanel.defrost', 'Defrost')} · {defrost === 'Off' ? t('widget.climatePanel.off', 'Off') : unknown}
            </Badge>}
          </div>
        )}
        <Caption>{t('dashboardWidgets.climate.climatePanel.readOnly', 'Climate readings only; no commands are sent.')}</Caption>
      </div>}
      instrument={<>{airflow}{!climateData && emptyState}</>}
      details={<div className={cn('grid grid-cols-1 @xs:grid-cols-2', dashboardTokens.density.gridGap)}>
        <StatusTile label={t('widget.climatePanel.outside', 'Outside')} value={outsideValue != null ? `${outsideValue}${tempUnit}` : '—'} />
        {statuses.map(({ id, label, value }) => <StatusTile key={id} label={label} value={value ?? unknown} />)}
      </div>}
    >
      {climateData ? (
        <div className="flex h-full min-w-0 flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {headline}
            </div>
            <div className="shrink-0 text-end">
              <Text as="p" variant="caption" className={dashboardTokens.metricLabel}>{t('widget.climatePanel.outside', 'Outside')}</Text>
              <Text as="p" variant="bodySm" className={cn(dashboardTokens.secondaryMetric, 'mt-1')}>
                {outsideValue != null ? `${outsideValue}${tempUnit}` : '—'}
              </Text>
            </div>
          </div>

          {airflow}
          {indicators}

          {knownStatuses.length > 0 && (
            <div className={cn('grid grid-cols-1 @xs:grid-cols-2', dashboardTokens.density.gridGap)}>
              {knownStatuses.map(({ id, label, value }) => <StatusTile key={id} label={label} value={value ?? unknown} />)}
            </div>
          )}
        </div>
      ) : emptyState}
    </InstrumentPresentation>
  );
}

function knownHeatLevel(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 3 ? value : null;
}

function StatusTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="widget-status-tile min-w-0 py-2">
      <Text as="p" variant="caption">{label}</Text>
      <Text as="p" variant="bodySm" weight="semibold" className="mt-1 break-words tabular-nums" title={value}>{value}</Text>
    </div>
  );
}
