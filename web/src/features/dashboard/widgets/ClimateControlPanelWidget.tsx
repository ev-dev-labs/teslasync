import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Thermometer, Fan, Armchair, CircleDot, Snowflake, Zap, Power,
} from 'lucide-react';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useVehicles, useClimateLatest } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { resolveHvacActive } from '@/lib/climateState';
import { fmtInt } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { convertTempFromSI } from '@/lib/unitConversion';

export default function ClimateControlPanelWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { data: climateData, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = useClimateLatest(id, 5_000);
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
  }, [climateData, toTemperatureDisplay]);

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

  const steeringHeat = climateData?.hvac_steering_wheel_heat_level ?? 0;

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.climatePanel.title', 'Climate Control')}
      icon={isCompact ? undefined : <Thermometer className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
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
            temps={temps}
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
    <div className="h-full flex flex-col items-center justify-center gap-1">
      <Thermometer className="h-5 w-5 text-neon-cyan" />
      <span className="text-lg font-bold text-[var(--text-primary)]">
        {inside != null ? `${inside}${tempUnit}` : '—'}
      </span>
    </div>
  );
}

/* ── Full 2x2 view ── */
interface FullViewProps {
  climateData: NonNullable<ReturnType<typeof useClimateLatest>['data']>;
  temps: { inside: string | null; outside: string | null } | null;
  tempUnit: string;
  seatHeaters: { label: string; level: number }[];
  steeringHeat: number;
  t: (k: string, f: string) => string;
}

function FullView({ climateData, temps, tempUnit, seatHeaters, steeringHeat, t }: FullViewProps) {
  const hvacState = resolveHvacActive(climateData.hvac_power, climateData.is_ac_on);

  return (
    <div className="h-full flex flex-col justify-between gap-2.5">
      {/* HVAC status badge */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Power className="h-3.5 w-3.5 text-[var(--text-muted)]" />
          <Badge variant={hvacState === true ? 'success' : 'neutral'} size="sm">
            {hvacState === true
              ? t('widget.climatePanel.hvacOn', 'HVAC On')
              : hvacState === false
                ? t('widget.climatePanel.hvacOff', 'HVAC Off')
                : t('widget.climatePanel.hvacUnknown', 'HVAC Unknown')}
          </Badge>
        </div>
      </div>

      {/* Temperature row */}
      <div className="grid grid-cols-2 gap-2">
        <MetricCell
          icon={<Thermometer className="h-3 w-3 text-neon-cyan" />}
          label={t('widget.climatePanel.cabin', 'Cabin')}
          value={temps?.inside != null ? `${temps.inside}${tempUnit}` : '—'}
        />
        <MetricCell
          icon={<Thermometer className="h-3 w-3 text-blue-400" />}
          label={t('widget.climatePanel.outside', 'Outside')}
          value={temps?.outside != null ? `${temps.outside}${tempUnit}` : '—'}
        />
      </div>

      {/* Fan speed */}
      <div className="grid grid-cols-2 gap-2">
        <MetricCell
          icon={<Fan className="h-3 w-3 text-[var(--text-muted)]" />}
          label={t('widget.climatePanel.fanSpeed', 'Fan Speed')}
          value={climateData.fan_speed != null ? `${climateData.fan_speed}` : '—'}
        />
        <MetricCell
          icon={<CircleDot className="h-3 w-3 text-[var(--text-muted)]" />}
          label={t('widget.climatePanel.steeringHeat', 'Wheel Heat')}
          value={steeringHeat > 0 ? `${steeringHeat}/3` : t('widget.climatePanel.off', 'Off')}
        />
      </div>

      {/* Seat heaters + status badges */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {seatHeaters.length > 0 ? (
          seatHeaters.map((s) => (
            <span
              key={s.label}
              className="inline-flex items-center gap-0.5 text-2xs px-1.5 py-0.5 rounded-full bg-orange-500/10 text-orange-400"
            >
              <Armchair className="h-2.5 w-2.5" /> {s.label} {s.level}/3
            </span>
          ))
        ) : (
          <span className="text-2xs text-[var(--text-muted)]">
            {t('widget.climatePanel.noSeatHeat', 'No seat heaters active')}
          </span>
        )}
        {climateData.defrost_mode && climateData.defrost_mode !== 'Off' && (
          <span className="inline-flex items-center gap-0.5 text-2xs px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400">
            <Snowflake className="h-2.5 w-2.5" /> {t('widget.climatePanel.defrost', 'Defrost')}
          </span>
        )}
        {climateData.battery_heater && (
          <span className="inline-flex items-center gap-0.5 text-2xs px-1.5 py-0.5 rounded-full bg-orange-500/10 text-orange-400">
            <Zap className="h-2.5 w-2.5" /> {t('widget.climatePanel.batHeater', 'Bat Heater')}
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Tiny metric cell (reused pattern) ── */
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
