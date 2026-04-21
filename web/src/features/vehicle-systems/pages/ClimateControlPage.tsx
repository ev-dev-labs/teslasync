import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import {
  Thermometer,
  Wind,
  Snowflake,
  Sun,
  Power,
  Flame,
  CircleGauge,
  Settings,
  ThermometerSun,
  RefreshCw,
  ShieldCheck,
  BatteryCharging,
  Zap,
  Activity,
  AlertTriangle,
  Monitor,
} from 'lucide-react';

import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { DataTable, useSortToggle, type Column } from '@/components/ui/DataTable';
import { MetricCard } from '@/components/data-display/MetricCard';
import { RadialGauge } from '@/components/charts/RadialGauge';
import { Skeleton } from '@/components/feedback/Skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { FadeIn } from '@/components/motion/FadeIn';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  chartMarginLabeled,
  axisTick,
  chartAnimation,
} from '@/components/charts';
import { ChartTooltip } from '@/components/charts/ChartTooltip';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSettings } from '@/hooks/useSettings';
import { formatDateTime, formatTime } from '@/lib/dateFormat';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { CHART_COLORS } from '@/lib/colors';

import { useVehicles, useChargingTelemetryLatest } from '@/api/hooks/useVehicles';
import { useClimate, useClimateHistory } from '@/api/hooks/useVehicleSystems';
import type { ClimateState } from '@/types/vehicle-systems';

/* ─── Types ─── */

interface HeatLevelStyle {
  color: string;
  bg: string;
  label: string;
}

interface SeatDef {
  key: keyof Pick<
    ClimateState,
    | 'seatHeaterLeft'
    | 'seatHeaterRight'
    | 'seatHeaterRearLeft'
    | 'seatHeaterRearCenter'
    | 'seatHeaterRearRight'
  >;
  label: string;
  row: 'front' | 'rear';
}

/* ─── Constants ─── */

const HEAT_LEVELS: HeatLevelStyle[] = [
  { color: 'text-gray-500', bg: 'bg-gray-500/10', label: 'Off' },
  { color: 'text-cyan-400', bg: 'bg-cyan-400/10', label: 'Low' },
  { color: 'text-amber-400', bg: 'bg-amber-400/10', label: 'Medium' },
  { color: 'text-red-400', bg: 'bg-red-400/10', label: 'High' },
];

const SEATS: SeatDef[] = [
  { key: 'seatHeaterLeft', label: 'Front Left', row: 'front' },
  { key: 'seatHeaterRight', label: 'Front Right', row: 'front' },
  { key: 'seatHeaterRearLeft', label: 'Rear Left', row: 'rear' },
  { key: 'seatHeaterRearCenter', label: 'Rear Center', row: 'rear' },
  { key: 'seatHeaterRearRight', label: 'Rear Right', row: 'rear' },
];


/* ─── Helpers ─── */

function heatStyle(level: number): HeatLevelStyle {
  return HEAT_LEVELS[Math.min(Math.max(level, 0), 3)];
}

function heatBadgeVariant(level: number): 'neutral' | 'info' | 'warning' | 'danger' {
  if (level <= 0) return 'neutral';
  if (level === 1) return 'info';
  if (level === 2) return 'warning';
  return 'danger';
}

function keeperVariant(mode: string): 'neutral' | 'info' | 'warning' | 'danger' {
  switch (mode) {
    case 'On':
      return 'info';
    case 'Dog Mode':
      return 'warning';
    case 'Camp Mode':
      return 'info';
    default:
      return 'neutral';
  }
}

function keeperLabel(mode: string): string {
  switch (mode) {
    case 'On':
      return 'On';
    case 'Dog Mode':
      return 'Dog Mode';
    case 'Camp Mode':
      return 'Camp Mode';
    default:
      return 'Off';
  }
}

function comfortBadge(
  inside: number,
  target: number,
): { variant: 'success' | 'warning' | 'danger'; label: string } {
  const delta = Math.abs(inside - target);
  if (delta <= 1) return { variant: 'success', label: 'Comfortable' };
  if (delta <= 3) return { variant: 'warning', label: 'Adjusting' };
  return { variant: 'danger', label: 'Far from target' };
}

/* ─── Seat Heater Card (extracted for readability) ─── */

function SeatHeaterCard({
  label,
  level,
  t,
}: {
  label: string;
  level: number;
  t: (s: string) => string;
}) {
  const style = heatStyle(level);
  return (
    <GlassPanel className={cn('flex flex-col items-center gap-2 p-4', style.bg)}>
      <Flame className={cn('h-6 w-6', style.color)} />
      <span className="text-xs font-medium text-[var(--text-secondary)]">
        {t(label)}
      </span>
      <Badge variant={heatBadgeVariant(level)} size="sm">
        {t(style.label)} ({level}/3)
      </Badge>
    </GlassPanel>
  );
}

/* ─── Seat Cooling Card ─── */

const COOL_LEVELS: HeatLevelStyle[] = [
  { color: 'text-gray-500', bg: 'bg-gray-500/10', label: 'Off' },
  { color: 'text-sky-400', bg: 'bg-sky-400/10', label: 'Low' },
  { color: 'text-cyan-300', bg: 'bg-cyan-300/10', label: 'Medium' },
  { color: 'text-blue-400', bg: 'bg-blue-400/10', label: 'High' },
];

function coolStyle(level: number): HeatLevelStyle {
  return COOL_LEVELS[Math.min(Math.max(Math.round(level), 0), 3)];
}

function coolBadgeVariant(level: number): 'neutral' | 'info' | 'warning' | 'danger' {
  if (level <= 0) return 'neutral';
  if (level === 1) return 'info';
  if (level === 2) return 'info';
  return 'info';
}

function SeatCoolingCard({
  label,
  level,
  t,
}: {
  label: string;
  level: number | null | undefined;
  t: (s: string) => string;
}) {
  const lvl = level ?? 0;
  const style = coolStyle(lvl);
  return (
    <GlassPanel className={cn('flex flex-col items-center gap-2 p-4', style.bg)}>
      <Snowflake className={cn('h-6 w-6', style.color)} />
      <span className="text-xs font-medium text-[var(--text-secondary)]">
        {t(label)}
      </span>
      {level != null ? (
        <Badge variant={coolBadgeVariant(lvl)} size="sm">
          {t(style.label)} ({Math.round(lvl)}/3)
        </Badge>
      ) : (
        <span className="text-xs text-[var(--text-muted)]">—</span>
      )}
    </GlassPanel>
  );
}

/* ─── Column accessor for sort ─── */

function climateAccessor(row: ClimateState, key: string): number | string {
  switch (key) {
    case 'timestamp':
      return new Date(row.timestamp).getTime();
    case 'insideTemp':
      return row.insideTemp;
    case 'outsideTemp':
      return row.outsideTemp;
    case 'driverTempSetting':
      return row.driverTempSetting;
    case 'fanSpeed':
      return row.fanSpeed;
    default:
      return 0;
  }
}

/* ═══════════════════════════════════════════════════════
   Climate Control Page
   ═══════════════════════════════════════════════════════ */

export default function ClimateControlPage() {
  const { t } = useTranslation();
  usePageTitle(t('Climate Control'));
  const { convertTemp, tempUnit } = useSettings();
  const isFahrenheit = tempUnit === '°F';
  const tempGaugeMax = isFahrenheit ? 131 : 55;

  /* ─── Vehicle selector ─── */
  const { data: vehicles } = useVehicles();
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const activeId =
    vehicleId ?? (vehicles?.[0]?.id != null ? String(vehicles[0].id) : '');

  /* ─── Climate data ─── */
  const {
    data: latest,
    isLoading,
    error,
    refetch,
  } = useClimate(activeId);

  const { data: history, isLoading: historyLoading } = useClimateHistory(activeId);

  /* ─── Charging telemetry (for NotEnoughPowerToHeat alert) ─── */
  const activeIdNum = Number(activeId) || 0;
  const { data: chargingLatest } = useChargingTelemetryLatest(activeIdNum);

  /* ─── Comfort indicator ─── */
  const comfort = useMemo(
    () =>
      comfortBadge(
        latest?.insideTemp ?? 0,
        latest?.driverTempSetting ?? 0,
      ),
    [latest?.insideTemp, latest?.driverTempSetting],
  );

  /* ─── Table sort ─── */
  const { sortKey, sortDir, onSort, sortFn } = useSortToggle('timestamp', 'desc');

  const sortedHistory = useMemo(() => {
    if (!history) return [];
    return sortFn(history, climateAccessor);
  }, [history, sortFn]);

  /* ─── Table columns ─── */
  const columns = useMemo<Column<ClimateState>[]>(
    () => [
      {
        key: 'timestamp',
        header: t('Time'),
        sortable: true,
        render: (row) => (
          <span className="whitespace-nowrap">{formatDateTime(row.timestamp)}</span>
        ),
      },
      {
        key: 'insideTemp',
        header: `${t('Inside')} ${tempUnit}`,
        sortable: true,
        render: (row) => fmtNumber(convertTemp(row.insideTemp), 1),
      },
      {
        key: 'outsideTemp',
        header: `${t('Outside')} ${tempUnit}`,
        sortable: true,
        render: (row) => fmtNumber(convertTemp(row.outsideTemp), 1),
      },
      {
        key: 'driverTempSetting',
        header: `${t('Set Temp')} ${tempUnit}`,
        sortable: true,
        render: (row) => fmtNumber(convertTemp(row.driverTempSetting), 1),
      },
      {
        key: 'fanSpeed',
        header: t('Fan'),
        sortable: true,
        render: (row) => String(row.fanSpeed),
      },
      {
        key: 'isAcOn',
        header: t('HVAC'),
        render: (row) => (
          <Badge variant={row.isAcOn ? 'success' : 'neutral'} size="sm">
            {row.isAcOn ? t('On') : t('Off')}
          </Badge>
        ),
      },
      {
        key: 'climateKeeperMode',
        header: t('Climate Keeper'),
        render: (row) => (
          <Badge variant={keeperVariant(row.climateKeeperMode)} size="sm">
            {t(keeperLabel(row.climateKeeperMode))}
          </Badge>
        ),
      },
    ],
    [t],
  );

  /* ─── Front / rear seat lists ─── */
  const frontSeats = SEATS.filter((s) => s.row === 'front');
  const rearSeats = SEATS.filter((s) => s.row === 'rear');

  /* ─── Chronological history (backend returns newest-first) ─── */
  const chronoHistory = useMemo(() => {
    if (!history || history.length === 0) return [];
    return [...history].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
  }, [history]);

  const convertedChartData = useMemo(() =>
    chronoHistory.map(h => ({
      ...h,
      insideTemp: h.insideTemp != null ? convertTemp(h.insideTemp) : null,
      outsideTemp: h.outsideTemp != null ? convertTemp(h.outsideTemp) : null,
      driverTempSetting: h.driverTempSetting != null ? convertTemp(h.driverTempSetting) : null,
    })),
    [chronoHistory, convertTemp],
  );

  /* ─── Comfort score & temp delta ─── */
  const comfortScore = useMemo(() => {
    if (latest?.insideTemp == null || latest?.driverTempSetting == null) return null;
    const delta = Math.abs(latest.insideTemp - latest.driverTempSetting);
    return Math.max(0, 100 - delta * 10);
  }, [latest?.insideTemp, latest?.driverTempSetting]);

  const tempDelta = useMemo(() => {
    if (latest?.insideTemp == null || latest?.driverTempSetting == null) return null;
    return +(fmtNumber(latest.insideTemp - latest.driverTempSetting, 1));
  }, [latest?.insideTemp, latest?.driverTempSetting]);

  /* ─── Climate efficiency stats (from real power samples only) ─── */
  const efficiencyStats = useMemo(() => {
    if (chronoHistory.length === 0) return null;
    const withPower = chronoHistory.filter((h) => h.hvacPower != null && h.hvacPower > 0);
    if (withPower.length === 0) return null;
    const powers = withPower.map((h) => h.hvacPower);
    const avg = powers.reduce((s, v) => s + v, 0) / powers.length;
    const peak = Math.max(...powers);
    const firstTs = new Date(chronoHistory[0].timestamp).getTime();
    const lastTs = new Date(chronoHistory[chronoHistory.length - 1].timestamp).getTime();
    const hours = Math.max((lastTs - firstTs) / 3_600_000, 0.01);
    const energy = avg * hours;
    return { avg, peak, energy };
  }, [chronoHistory]);

  /* ═══════════════════════════════════════════════════════
     Render
     ═══════════════════════════════════════════════════════ */

  return (
    <PageContainer
      title={t('Climate Control')}
      subtitle={t('HVAC status, temperatures, and seat heaters')}
      loading={isLoading}
      error={error as Error | null}
      actions={
        <div className="flex items-center gap-3">
          {vehicles && vehicles.length > 1 && (
            <Select
              options={vehicles.map((v) => ({
                value: String(v.id),
                label: v.display_name || v.vin,
              }))}
              value={activeId}
              onChange={(e) => setVehicleId(e.target.value)}
            />
          )}
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw className="h-4 w-4" />}
            onClick={() => void refetch()}
          >
            {t('Refresh')}
          </Button>
        </div>
      }
    >
      {/* ─── HVAC Status Banner ─── */}
      <FadeIn>
        <GlassPanel
          className={cn(
            'flex flex-wrap items-center justify-between gap-4 p-4',
            latest?.isAcOn ? 'border-cyan-500/30' : 'border-gray-600/30',
          )}
          glow={latest?.isAcOn ? 'cyan' : 'none'}
        >
          <div className="flex items-center gap-3">
            <Power
              className={cn(
                'h-6 w-6',
                latest?.isAcOn ? 'text-cyan-400' : 'text-gray-500',
              )}
            />
            <span className="text-sm font-medium text-[var(--text-primary)]">
              {t('HVAC System')}
            </span>
            <Badge variant={latest?.isAcOn ? 'success' : 'neutral'}>
              {latest?.isAcOn ? t('Active') : t('Off')}
            </Badge>
            <Badge variant={comfort.variant} size="sm">
              {t(comfort.label)}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {latest?.climateKeeperMode &&
              latest.climateKeeperMode !== 'Off' && (
                <Badge variant={keeperVariant(latest.climateKeeperMode)} dot>
                  {t(keeperLabel(latest.climateKeeperMode))}
                </Badge>
              )}
            {latest?.defrostMode && latest.defrostMode !== 'Off' && (
              <Badge variant="info" dot>
                <Snowflake className="mr-1 inline h-3 w-3" />
                {t('Defrost')}{latest.defrostMode !== 'Normal' ? ` (${latest.defrostMode})` : ''}
              </Badge>
            )}
            {latest?.batteryHeater && (
              <Badge variant="warning" dot>
                <BatteryCharging className="mr-1 inline h-3 w-3" />
                {t('Battery Heater')}
              </Badge>
            )}
            {chargingLatest?.not_enough_power_to_heat && (
              <Badge variant="danger" dot>
                <AlertTriangle className="mr-1 inline h-3 w-3" />
                {t('Insufficient Power to Heat')}
              </Badge>
            )}
          </div>
        </GlassPanel>
      </FadeIn>

      {/* ─── Temperature Gauges ─── */}
      <FadeIn delay={0.1}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <GlassPanel className="flex flex-col items-center gap-2 p-6">
            <RadialGauge
              value={convertTemp(latest?.insideTemp ?? 0)}
              max={tempGaugeMax}
              label={t('Inside Temp')}
              unit={tempUnit}
              color={CHART_COLORS[0]}
            />
            <span className="text-lg font-bold text-[var(--text-primary)]">
              {fmtNumber(convertTemp(latest?.insideTemp ?? 0), 1)}{tempUnit}
            </span>
          </GlassPanel>

          <GlassPanel className="flex flex-col items-center gap-2 p-6">
            <RadialGauge
              value={convertTemp(latest?.outsideTemp ?? 0)}
              max={tempGaugeMax}
              label={t('Outside Temp')}
              unit={tempUnit}
              color={CHART_COLORS[1]}
            />
            <span className="text-lg font-bold text-[var(--text-primary)]">
              {fmtNumber(convertTemp(latest?.outsideTemp ?? 0), 1)}{tempUnit}
            </span>
          </GlassPanel>

          <GlassPanel className="flex flex-col items-center gap-2 p-6">
            <RadialGauge
              value={convertTemp(latest?.driverTempSetting ?? 0)}
              max={tempGaugeMax}
              label={t('Driver Set Temp')}
              unit={tempUnit}
              color={CHART_COLORS[2]}
            />
            <span className="text-lg font-bold text-[var(--text-primary)]">
              {fmtNumber(convertTemp(latest?.driverTempSetting ?? 0), 1)}{tempUnit}
            </span>
          </GlassPanel>
        </div>
      </FadeIn>

      {/* ─── Climate Status Cards (6-card grid) ─── */}
      <FadeIn delay={0.2}>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <MetricCard
            label={t('HVAC Power')}
            value={latest?.isAcOn ? t('On') : t('Off')}
            icon={
              <Power
                className={cn(
                  'h-5 w-5',
                  latest?.isAcOn ? 'text-cyan-400' : 'text-gray-500',
                )}
              />
            }
            subtitle={
              latest?.hvacPower != null
                ? `${fmtNumber(latest.hvacPower, 1)} kW`
                : undefined
            }
          />

          <MetricCard
            label={t('Auto Conditioning')}
            value={latest?.isAutoClimate ? t('On') : t('Off')}
            icon={<Settings className="h-5 w-5 text-blue-400" />}
          />

          <MetricCard
            label={t('Climate Keeper')}
            value={t(keeperLabel(latest?.climateKeeperMode ?? 'off'))}
            icon={<ThermometerSun className="h-5 w-5 text-amber-400" />}
            subtitle={
              latest?.climateKeeperMode &&
              latest.climateKeeperMode !== 'Off'
                ? t('Active')
                : undefined
            }
          />

          <MetricCard
            label={t('Fan Speed')}
            value={String(latest?.fanSpeed ?? 0)}
            icon={<Wind className="h-5 w-5 text-teal-400" />}
            subtitle={`${t('Level')} 0–10`}
          />

          <MetricCard
            label={t('Fan Status')}
            value={
              latest?.hvacFanStatus != null
                ? latest.hvacFanStatus > 0
                  ? t('Running')
                  : t('Idle')
                : '—'
            }
            icon={
              <Wind
                className={cn(
                  'h-5 w-5',
                  latest?.hvacFanStatus != null && latest.hvacFanStatus > 0
                    ? 'text-teal-400'
                    : 'text-gray-500',
                )}
              />
            }
            subtitle={
              latest?.hvacFanStatus != null
                ? `${t('Code')} ${latest.hvacFanStatus}`
                : undefined
            }
          />

          <MetricCard
            label={t('Steering Wheel Heater')}
            value={latest?.steeringWheelHeat ? t('On') : t('Off')}
            icon={
              <CircleGauge
                className={cn(
                  'h-5 w-5',
                  latest?.steeringWheelHeat
                    ? 'text-amber-400'
                    : 'text-gray-500',
                )}
              />
            }
          />

          <MetricCard
            label={t('Steering Wheel Heat Level')}
            value={
              latest?.hvacSteeringWheelHeatLevel == null
                ? '—'
                : t(heatStyle(latest.hvacSteeringWheelHeatLevel).label)
            }
            icon={
              <Flame
                className={cn(
                  'h-5 w-5',
                  latest?.hvacSteeringWheelHeatLevel != null
                    ? heatStyle(latest.hvacSteeringWheelHeatLevel).color
                    : 'text-gray-500',
                )}
              />
            }
            subtitle={
              latest?.hvacSteeringWheelHeatLevel != null
                ? `${t('Level')} ${fmtInt(latest.hvacSteeringWheelHeatLevel)}`
                : undefined
            }
          />

          <MetricCard
            label={t('Steering Wheel Heat Auto')}
            value={
              latest?.hvacSteeringWheelHeatAuto == null
                ? '—'
                : latest.hvacSteeringWheelHeatAuto
                  ? t('Auto')
                  : t('Manual')
            }
            icon={
              <Activity
                className={cn(
                  'h-5 w-5',
                  latest?.hvacSteeringWheelHeatAuto
                    ? 'text-amber-400'
                    : 'text-gray-500',
                )}
              />
            }
          />

          <MetricCard
            label={t('Defrost Mode')}
            value={latest?.defrostMode && latest.defrostMode !== 'Off' ? latest.defrostMode : t('Off')}
            icon={
              <Snowflake
                className={cn(
                  'h-5 w-5',
                  latest?.defrostMode && latest.defrostMode !== 'Off' ? 'text-blue-400' : 'text-gray-500',
                )}
              />
            }
          />

          <MetricCard
            label={t('Defrost for Preconditioning')}
            value={
              latest?.defrostForPreconditioning == null
                ? '—'
                : latest.defrostForPreconditioning
                  ? t('Active')
                  : t('Inactive')
            }
            icon={
              <Snowflake
                className={cn(
                  'h-5 w-5',
                  latest?.defrostForPreconditioning ? 'text-cyan-400' : 'text-gray-500',
                )}
              />
            }
            subtitle={
              latest?.defrostForPreconditioning
                ? t('Clearing windshield before drive')
                : undefined
            }
          />

          <MetricCard
            label={t('Rear Defrost')}
            value={
              latest?.rearDefrostEnabled == null
                ? '—'
                : latest.rearDefrostEnabled
                  ? t('On')
                  : t('Off')
            }
            icon={
              <Snowflake
                className={cn(
                  'h-5 w-5',
                  latest?.rearDefrostEnabled ? 'text-blue-400' : 'text-gray-500',
                )}
              />
            }
            subtitle={
              latest?.rearDefrostEnabled
                ? t('Clearing rear window')
                : undefined
            }
          />

          <MetricCard
            label={t('Wiper Heater', 'Wiper Heater')}
            value={
              latest?.wiperHeatEnabled == null
                ? '—'
                : latest.wiperHeatEnabled
                  ? t('On')
                  : t('Off')
            }
            icon={
              <Flame
                className={cn(
                  'h-5 w-5',
                  latest?.wiperHeatEnabled ? 'text-orange-400' : 'text-gray-500',
                )}
              />
            }
            subtitle={
              latest?.wiperHeatEnabled
                ? t('Heating windshield wipers', 'Heating windshield wipers')
                : undefined
            }
          />

          <MetricCard
            label={t('Rear Display HVAC', 'Rear Display HVAC')}
            value={
              latest?.rearDisplayHvacEnabled == null
                ? '—'
                : latest.rearDisplayHvacEnabled
                  ? t('Enabled')
                  : t('Disabled')
            }
            icon={
              <Monitor
                className={cn(
                  'h-5 w-5',
                  latest?.rearDisplayHvacEnabled ? 'text-cyan-400' : 'text-gray-500',
                )}
              />
            }
            subtitle={
              latest?.rearDisplayHvacEnabled
                ? t('Rear passengers can control HVAC', 'Rear passengers can control HVAC')
                : undefined
            }
          />
        </div>
      </FadeIn>

      {/* ─── Protection & Safety Row ─── */}
      <FadeIn delay={0.25}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label={t('Overheat Protection')}
            value={latest?.overheatProtection ?? t('Unknown')}
            icon={<ShieldCheck className="h-5 w-5 text-green-400" />}
          />
          <MetricCard
            label={t('Overheat Temp Limit', 'Overheat Temp Limit')}
            value={latest?.cabinOverheatProtectionTempLimit ?? '—'}
            icon={<ThermometerSun className="h-5 w-5 text-orange-400" />}
          />
          <MetricCard
            label={t('Battery Heater')}
            value={latest?.batteryHeater ? t('On') : t('Off')}
            icon={
              <BatteryCharging
                className={cn(
                  'h-5 w-5',
                  latest?.batteryHeater ? 'text-amber-400' : 'text-gray-500',
                )}
              />
            }
          />
          <MetricCard
            label={t('Passenger Setting')}
            value={`${fmtNumber(latest?.passengerTempSetting ?? 0, 1)}°C`}
            icon={<Thermometer className="h-5 w-5 text-purple-400" />}
          />
        </div>
      </FadeIn>

      {/* ─── Thermal Comfort Indicator ─── */}
      <FadeIn delay={0.27}>
        <GlassPanel className="p-6">
          <div className="mb-4 flex items-center gap-2">
            <Thermometer className="h-5 w-5 text-cyan-400" />
            <span className="text-base font-semibold text-[var(--text-primary)]">
              {t('Thermal Comfort')}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* Comfort Score */}
            <GlassPanel className="flex flex-col items-center gap-2 p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-white/50">
                {t('Comfort Score')}
              </span>
              <div
                className={cn(
                  'flex h-20 w-20 items-center justify-center rounded-full',
                  comfortScore != null && comfortScore >= 80
                    ? 'bg-green-500/20'
                    : comfortScore != null && comfortScore >= 50
                      ? 'bg-amber-500/20'
                      : 'bg-red-500/20',
                )}
              >
                <span
                  className={cn(
                    'text-2xl font-bold',
                    comfortScore != null && comfortScore >= 80
                      ? 'text-green-400'
                      : comfortScore != null && comfortScore >= 50
                        ? 'text-amber-400'
                        : 'text-red-400',
                  )}
                >
                  {comfortScore != null ? fmtInt(comfortScore) : '—'}
                </span>
              </div>
              <Badge
                variant={
                  comfortScore != null && comfortScore >= 80
                    ? 'success'
                    : comfortScore != null && comfortScore >= 50
                      ? 'warning'
                      : 'danger'
                }
                size="sm"
              >
                {comfortScore != null && comfortScore >= 80
                  ? t('Excellent')
                  : comfortScore != null && comfortScore >= 50
                    ? t('Moderate')
                    : t('Poor')}
              </Badge>
            </GlassPanel>

            {/* Temp Delta */}
            <GlassPanel className="flex flex-col items-center gap-2 p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-white/50">
                {t('Temp Delta')}
              </span>
              <div
                className={cn(
                  'flex h-20 w-20 items-center justify-center rounded-full',
                  tempDelta == null
                    ? 'bg-white/5'
                    : Math.abs(tempDelta) <= 1
                      ? 'bg-green-500/20'
                      : Math.abs(tempDelta) <= 3
                        ? 'bg-amber-500/20'
                        : 'bg-red-500/20',
                )}
              >
                <span
                  className={cn(
                    'text-2xl font-bold',
                    tempDelta == null
                      ? 'text-white/30'
                      : Math.abs(tempDelta) <= 1
                        ? 'text-green-400'
                        : Math.abs(tempDelta) <= 3
                          ? 'text-amber-400'
                          : 'text-red-400',
                  )}
                >
                  {tempDelta != null
                    ? `${tempDelta > 0 ? '+' : ''}${tempDelta}`
                    : '—'}
                </span>
              </div>
              <span className="text-[10px] rounded-full bg-white/5 px-3 py-1 font-medium text-white/50">
                {tempDelta != null
                  ? Math.abs(tempDelta) <= 1
                    ? t('Near Target')
                    : tempDelta > 0
                      ? t('Above Target')
                      : t('Below Target')
                  : t('N/A')}
              </span>
            </GlassPanel>

            {/* Comfort Status */}
            <GlassPanel className="flex flex-col items-center gap-2 p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-white/50">
                {t('Status')}
              </span>
              <div
                className={cn(
                  'flex h-20 w-20 items-center justify-center rounded-full',
                  comfortScore != null && comfortScore >= 80
                    ? 'bg-green-500/20'
                    : comfortScore != null && comfortScore >= 50
                      ? 'bg-amber-500/20'
                      : 'bg-red-500/20',
                )}
              >
                {tempDelta != null && tempDelta > 2 ? (
                  <Sun className="h-8 w-8 text-amber-400" />
                ) : tempDelta != null && tempDelta < -2 ? (
                  <Snowflake className="h-8 w-8 text-cyan-400" />
                ) : (
                  <Wind className="h-8 w-8 text-green-400" />
                )}
              </div>
              <Badge variant={comfort.variant} size="sm">
                {tempDelta != null && tempDelta > 2
                  ? t('Too Warm')
                  : tempDelta != null && tempDelta < -2
                    ? t('Too Cold')
                    : t('Comfortable')}
              </Badge>
            </GlassPanel>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* ─── Climate Efficiency Panel ─── */}
      <FadeIn delay={0.28}>
        <GlassPanel className="p-6">
          <div className="mb-4 flex items-center gap-2">
            <Activity className="h-5 w-5 text-cyan-400" />
            <span className="text-base font-semibold text-[var(--text-primary)]">
              {t('Climate Efficiency')}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricCard
              label={t('Avg Power')}
              value={efficiencyStats ? fmtNumber(efficiencyStats.avg, 1) : '—'}
              subtitle="kW"
              icon={<Zap className="h-4 w-4" />}
              color="cyan"
            />
            <MetricCard
              label={t('Peak Power')}
              value={efficiencyStats ? fmtNumber(efficiencyStats.peak, 1) : '—'}
              subtitle="kW"
              icon={<Zap className="h-4 w-4" />}
              color="purple"
            />
            <MetricCard
              label={t('Est. Energy Used')}
              value={efficiencyStats ? fmtNumber(efficiencyStats.energy, 2) : '—'}
              subtitle="kWh"
              icon={<Zap className="h-4 w-4" />}
              color="amber"
            />
            <MetricCard
              label={t('Comfort Score')}
              value={comfortScore != null ? `${fmtInt(comfortScore)}%` : '—'}
              icon={<Thermometer className="h-4 w-4" />}
              color={comfortScore != null && comfortScore >= 80 ? 'green' : 'amber'}
            />
          </div>
        </GlassPanel>
      </FadeIn>

      {/* ─── Seat Heater Grid ─── */}
      <FadeIn delay={0.3}>
        <GlassPanel className="p-6">
          <div className="mb-4 flex items-center gap-2">
            <Flame className="h-5 w-5 text-amber-400" />
            <span className="text-base font-semibold text-[var(--text-primary)]">
              {t('Seat Heaters')}
            </span>
          </div>

          {/* Front row — 2 seats */}
          <div className="mx-auto mb-3 grid max-w-xs grid-cols-2 gap-3">
            {frontSeats.map((seat) => (
              <SeatHeaterCard
                key={seat.key}
                label={seat.label}
                level={latest?.[seat.key] ?? 0}
                t={t}
              />
            ))}
          </div>

          {/* Auto Seat Climate (front row) */}
          <div className="mx-auto mb-3 grid max-w-xs grid-cols-2 gap-3">
            <div className="flex items-center justify-between rounded-md border border-white/[0.06] bg-white/[0.03] px-3 py-2">
              <span className="text-xs text-[var(--text-secondary)]">
                {t('Auto Climate (Left)')}
              </span>
              {latest?.autoSeatClimateLeft != null ? (
                <Badge
                  variant={latest.autoSeatClimateLeft ? 'success' : 'neutral'}
                  size="sm"
                >
                  {latest.autoSeatClimateLeft ? t('Auto') : t('Manual')}
                </Badge>
              ) : (
                <span className="text-xs text-[var(--text-muted)]">—</span>
              )}
            </div>
            <div className="flex items-center justify-between rounded-md border border-white/[0.06] bg-white/[0.03] px-3 py-2">
              <span className="text-xs text-[var(--text-secondary)]">
                {t('Auto Climate (Right)')}
              </span>
              {latest?.autoSeatClimateRight != null ? (
                <Badge
                  variant={latest.autoSeatClimateRight ? 'success' : 'neutral'}
                  size="sm"
                >
                  {latest.autoSeatClimateRight ? t('Auto') : t('Manual')}
                </Badge>
              ) : (
                <span className="text-xs text-[var(--text-muted)]">—</span>
              )}
            </div>
          </div>

          {/* Rear row — 3 seats */}
          <div className="mx-auto grid max-w-md grid-cols-3 gap-3">
            {rearSeats.map((seat) => (
              <SeatHeaterCard
                key={seat.key}
                label={seat.label}
                level={latest?.[seat.key] ?? 0}
                t={t}
              />
            ))}
          </div>

          {/* Front row — seat cooling */}
          <div className="mt-4 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Snowflake className="h-4 w-4 text-sky-400" />
              <span className="text-sm font-semibold text-[var(--text-primary)]">
                {t('Seat Cooling')}
              </span>
            </div>
            {latest?.seatVentEnabled != null ? (
              <Badge
                variant={latest.seatVentEnabled ? 'success' : 'neutral'}
                size="sm"
              >
                {t('Ventilation')}: {latest.seatVentEnabled ? t('On') : t('Off')}
              </Badge>
            ) : (
              <Badge variant="neutral" size="sm">
                {t('Ventilation')}: —
              </Badge>
            )}
          </div>
          <div className="mx-auto mt-3 grid max-w-xs grid-cols-2 gap-3">
            <SeatCoolingCard
              label="Front Left"
              level={latest?.climateSeatCoolingFrontLeft}
              t={t}
            />
            <SeatCoolingCard
              label="Front Right"
              level={latest?.climateSeatCoolingFrontRight}
              t={t}
            />
          </div>

          {/* Legend */}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-4">
            {HEAT_LEVELS.map((lvl, idx) => (
              <div key={lvl.label} className="flex items-center gap-1.5">
                <Flame className={cn('h-3.5 w-3.5', lvl.color)} />
                <span className="text-xs text-[var(--text-muted)]">
                  {idx} — {t(lvl.label)}
                </span>
              </div>
            ))}
          </div>
        </GlassPanel>
      </FadeIn>

      {/* ─── Temperature History Chart ─── */}
      <FadeIn delay={0.4}>
        <GlassPanel className="p-6">
          <div className="mb-4 flex items-center gap-2">
            <Thermometer className="h-5 w-5 text-cyan-400" />
            <span className="text-base font-semibold text-[var(--text-primary)]">
              {t('Temperature History')}
            </span>
          </div>

          {historyLoading ? (
            <Skeleton height={300} />
          ) : !history || history.length === 0 ? (
            <EmptyState
              icon={<Thermometer className="h-10 w-10 text-[var(--text-muted)]" />}
              message={t('No temperature history available.')}
            />
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={convertedChartData} margin={chartMarginLabeled}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--glass-border)"
                  strokeOpacity={0.4}
                />
                <XAxis
                  dataKey="timestamp"
                  tick={axisTick}
                  tickFormatter={(v: string) => formatTime(v)}
                />
                <YAxis tick={axisTick} unit="°C" />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="insideTemp"
                  name={t('Inside Temp')}
                  stroke={CHART_COLORS[0]}
                  dot={false}
                  strokeWidth={2}
                  {...chartAnimation}
                />
                <Line
                  type="monotone"
                  dataKey="outsideTemp"
                  name={t('Outside Temp')}
                  stroke={CHART_COLORS[1]}
                  dot={false}
                  strokeWidth={2}
                  {...chartAnimation}
                />
                <Line
                  type="monotone"
                  dataKey="driverTempSetting"
                  name={t('Driver Set Temp')}
                  stroke={CHART_COLORS[2]}
                  dot={false}
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  {...chartAnimation}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </GlassPanel>
      </FadeIn>

      {/* ─── HVAC Power & Fan Speed History ─── */}
      <FadeIn delay={0.45}>
        <GlassPanel className="p-6">
          <div className="mb-4 flex items-center gap-2">
            <Wind className="h-5 w-5 text-purple-400" />
            <span className="text-base font-semibold text-[var(--text-primary)]">
              {t('HVAC Power & Fan Speed')}
            </span>
          </div>

          {historyLoading ? (
            <Skeleton height={300} />
          ) : chronoHistory.length === 0 ? (
            <EmptyState
              icon={<Wind className="h-10 w-10 text-[var(--text-muted)]" />}
              message={t('No HVAC history available.')}
            />
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <AreaChart data={convertedChartData} margin={chartMarginLabeled}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--glass-border)"
                  strokeOpacity={0.4}
                />
                <XAxis
                  dataKey="timestamp"
                  tick={axisTick}
                  tickFormatter={(v: string) => formatTime(v)}
                />
                <YAxis
                  yAxisId="power"
                  tick={axisTick}
                  label={{
                    value: 'kW',
                    angle: -90,
                    position: 'insideLeft',
                    style: { fontSize: 10, fill: 'var(--text-muted)' },
                  }}
                />
                <YAxis
                  yAxisId="fan"
                  orientation="right"
                  domain={[0, 10]}
                  tick={axisTick}
                  label={{
                    value: t('Fan Level'),
                    angle: 90,
                    position: 'insideRight',
                    style: { fontSize: 10, fill: 'var(--text-muted)' },
                  }}
                />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                <Area
                  yAxisId="power"
                  type="monotone"
                  dataKey="hvacPower"
                  name={t('HVAC Power (kW)')}
                  stroke={CHART_COLORS[0]}
                  fill={CHART_COLORS[0]}
                  fillOpacity={0.15}
                  strokeWidth={2}
                  dot={false}
                  {...chartAnimation}
                />
                <Line
                  yAxisId="fan"
                  type="stepAfter"
                  dataKey="fanSpeed"
                  name={t('Fan Speed')}
                  stroke={CHART_COLORS[3]}
                  strokeWidth={2}
                  dot={false}
                  {...chartAnimation}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </GlassPanel>
      </FadeIn>

      {/* ─── Climate History DataTable ─── */}
      <FadeIn delay={0.5}>
        <GlassPanel className="p-6">
          <div className="mb-4 flex items-center gap-2">
            <CircleGauge className="h-5 w-5 text-purple-400" />
            <span className="text-base font-semibold text-[var(--text-primary)]">
              {t('Climate History')}
            </span>
          </div>

          {historyLoading ? (
            <Skeleton lines={8} />
          ) : sortedHistory.length === 0 ? (
            <EmptyState message={t('No history records found.')} />
          ) : (
            <DataTable
              columns={columns}
              data={sortedHistory}
              keyExtractor={(row) => row.id}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              compact
              pagination
            />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
