import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Thermometer, Armchair, Snowflake, Zap, Power,
} from 'lucide-react';
import { Badge, Text } from '@/components/ui';
import type { StatMetric } from '@/components/data-display';
import type { DataState } from '@/api/dataState';
import { deriveDataState } from '@/api/dataState';
import { EmptyState } from '@/components/feedback';
import { useVehicles, useClimateLatest } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { resolveHvacActive } from '@/lib/climateState';

import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber } from './shared';
import { DashboardSourceBrief } from '../components/operationalbrief-all/DashboardSourceBrief';
import type { WidgetProps } from './types';
import { convertTempFromSI } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

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

  const isCompact = size.cols <= 1 && size.rows <= 1;

  const temps = useMemo(() => {
    if (!climateData) return null;
    return {
      inside: climateData.inside_temp != null ? fmtInt(toTemperatureDisplay(climateData.inside_temp)) : null,
      outside: climateData.outside_temp != null ? fmtInt(toTemperatureDisplay(climateData.outside_temp)) : null,
    };
  }, [climateData, toTemperatureDisplay, fmtInt]);

  const seatHeaters = useMemo(() => {
    if (!climateData) return [];
    const seats: { label: string; level: number }[] = [];
    if (climateData.seat_heater_left != null && climateData.seat_heater_left > 0)
      seats.push({ label: t('widget.climatePanel.seatFL', 'FL'), level: climateData.seat_heater_left });
    if (climateData.seat_heater_right != null && climateData.seat_heater_right > 0)
      seats.push({ label: t('widget.climatePanel.seatFR', 'FR'), level: climateData.seat_heater_right });
    if (climateData.seat_heater_rear_left != null && climateData.seat_heater_rear_left > 0)
      seats.push({ label: t('widget.climatePanel.seatRL', 'RL'), level: climateData.seat_heater_rear_left });
    if (climateData.seat_heater_rear_center != null && climateData.seat_heater_rear_center > 0)
      seats.push({ label: t('widget.climatePanel.seatRC', 'RC'), level: climateData.seat_heater_rear_center });
    if (climateData.seat_heater_rear_right != null && climateData.seat_heater_rear_right > 0)
      seats.push({ label: t('widget.climatePanel.seatRR', 'RR'), level: climateData.seat_heater_rear_right });
    return seats;
  }, [climateData, t]);

  const steeringHeat = climateData?.hvac_steering_wheel_heat_level ?? null;
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
      icon={isCompact ? undefined : <Thermometer className="h-3.5 w-3.5 text-neon-cyan" />}
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
            dataState={dataState}
            sourceScope={t('widget.climatePanel.summaryScope', 'Vehicle {{id}} · returned climate snapshot; continuous recording coverage is not established.', { id })}
            toTemperatureDisplay={toTemperatureDisplay}
            tempUnit={tempUnit}
            seatHeaters={seatHeaters}
            steeringHeat={steeringHeat}
            t={t}
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
  dataState: DataState<unknown>;
  sourceScope: string;
  toTemperatureDisplay: (value: number) => number;
  tempUnit: string;
  seatHeaters: { label: string; level: number }[];
  steeringHeat: number | null;
  t: (k: string, f: string) => string;
}

function FullView({ climateData, dataState, sourceScope, toTemperatureDisplay, tempUnit, seatHeaters, steeringHeat, t }: FullViewProps) {
  const { fmtInt } = useNumberFormatting();
  const hvacState = resolveHvacActive(climateData.hvac_power, climateData.is_ac_on);
  const metrics: StatMetric[] = [
    { metricId: 'temperature', occurrenceId: 'climate-panel-cabin', rawValue: climateData.inside_temp,
      label: t('widget.climatePanel.cabin', 'Cabin'),
      display: { formatter: raw => ({ value: fmtInt(toTemperatureDisplay(raw)), unit: tempUnit }) } },
    { metricId: 'temperature', occurrenceId: 'climate-panel-outside', rawValue: climateData.outside_temp,
      label: t('widget.climatePanel.outside', 'Outside'),
      display: { formatter: raw => ({ value: fmtInt(toTemperatureDisplay(raw)), unit: tempUnit }) } },
    { metricId: 'number', occurrenceId: 'climate-panel-fan-level', rawValue: climateData.fan_speed,
      label: t('widget.climatePanel.fanSpeed', 'Fan speed'),
      description: t('widget.climatePanel.fanLevelDescription', 'Reported fan level, not a velocity measurement.'),
      display: { notation: 'source' } },
    { metricId: 'number', occurrenceId: 'climate-panel-wheel-level', rawValue: steeringHeat,
      label: t('widget.climatePanel.steeringHeat', 'Wheel heat'),
      description: t('widget.climatePanel.wheelLevelDescription', 'Reported wheel-heater level on the 0–3 scale; zero means Off.'),
      display: { formatter: raw => ({ value: raw > 0 ? `${raw}/3` : t('widget.climatePanel.off', 'Off'), unit: '' }) } },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {/* HVAC status badge */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Power className="h-3.5 w-3.5 text-[var(--text-muted)]" />
          <Badge variant={hvacState === true ? 'success' : 'neutral'} size="sm">
            {hvacState === true
              ? t('widget.climatePanel.hvacOn', 'HVAC on')
              : hvacState === false
                ? t('widget.climatePanel.hvacOff', 'HVAC off')
                : t('widget.climatePanel.hvacUnknown', 'HVAC unknown')}
          </Badge>
        </div>
      </div>

      <DashboardSourceBrief metrics={metrics} state={dataState}
        eyebrow={t('widget.summaryEyebrow', 'Dashboard source summary')}
        title={t('widget.climatePanel.summaryTitle', 'Returned climate control readings')}
        description={t('widget.climatePanel.summaryDescription', 'Cabin and outside temperatures are independent SI measurements converted only for display. Fan and wheel-heater levels are not speeds; HVAC and heater statuses remain separate.')}
        scope={sourceScope}
        testId="dashboard-climate-panel-brief" />

      {/* Seat heaters + status badges */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {seatHeaters.length > 0 ? (
          seatHeaters.map((s) => (
            <Badge key={s.label} variant="warning" size="sm">
              <Armchair className="size-3" aria-hidden="true" /> {s.label} {s.level}/3
            </Badge>
          ))
        ) : (
          <Text variant="caption">
            {[climateData.seat_heater_left, climateData.seat_heater_right, climateData.seat_heater_rear_left, climateData.seat_heater_rear_center, climateData.seat_heater_rear_right].some((level) => level == null)
              ? t('hero.unknownStatus', 'Unknown')
              : t('widget.climatePanel.noSeatHeat', 'No seat heaters active')}
          </Text>
        )}
        {climateData.defrost_mode && climateData.defrost_mode !== 'Off' && (
          <Badge variant="info" size="sm">
            <Snowflake className="size-3" aria-hidden="true" /> {t('widget.climatePanel.defrost', 'Defrost')}
          </Badge>
        )}
        {climateData.battery_heater && (
          <Badge variant="warning" size="sm">
            <Zap className="size-3" aria-hidden="true" /> {t('widget.climatePanel.batHeater', 'Bat heater')}
          </Badge>
        )}
      </div>
    </div>
  );
}
