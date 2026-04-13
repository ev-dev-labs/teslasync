import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import {
  Thermometer,
  Wind,
  Snowflake,
  Power,
  Flame,
  CircleGauge,
  Settings,
  ThermometerSun,
  RefreshCw,
  ShieldCheck,
  BatteryCharging,
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
import { formatDateTime, formatTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { CHART_COLORS } from '@/lib/colors';

import { useVehicles } from '@/api/hooks/useVehicles';
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

const TEMP_GAUGE_MAX = 55;

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
    case 'keep':
      return 'info';
    case 'dog':
      return 'warning';
    case 'camp':
      return 'info';
    default:
      return 'neutral';
  }
}

function keeperLabel(mode: string): string {
  switch (mode) {
    case 'keep':
      return 'Keep';
    case 'dog':
      return 'Dog Mode';
    case 'camp':
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
    <GlassPanel className={clsx('flex flex-col items-center gap-2 p-4', style.bg)}>
      <Flame className={clsx('h-6 w-6', style.color)} />
      <span className="text-xs font-medium text-[var(--text-secondary)]">
        {t(label)}
      </span>
      <Badge variant={heatBadgeVariant(level)} size="sm">
        {t(style.label)} ({level}/3)
      </Badge>
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
        header: t('Inside °C'),
        sortable: true,
        render: (row) => fmtNumber(row.insideTemp, 1),
      },
      {
        key: 'outsideTemp',
        header: t('Outside °C'),
        sortable: true,
        render: (row) => fmtNumber(row.outsideTemp, 1),
      },
      {
        key: 'driverTempSetting',
        header: t('Set Temp °C'),
        sortable: true,
        render: (row) => fmtNumber(row.driverTempSetting, 1),
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

  /* ═══════════════════════════════════════════════════════
     Render
     ═══════════════════════════════════════════════════════ */

  return (
    <PageContainer
      title={t('Climate Control')}
      subtitle={t('HVAC status, temperatures, and seat heaters')}
      loading={isLoading}
      error={error as Error | null}
      empty={!latest && !isLoading}
      emptyMessage={t('No climate data available.')}
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
          className={clsx(
            'flex flex-wrap items-center justify-between gap-4 p-4',
            latest?.isAcOn ? 'border-cyan-500/30' : 'border-gray-600/30',
          )}
          glow={latest?.isAcOn ? 'cyan' : 'none'}
        >
          <div className="flex items-center gap-3">
            <Power
              className={clsx(
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
              latest.climateKeeperMode !== 'off' && (
                <Badge variant={keeperVariant(latest.climateKeeperMode)} dot>
                  {t(keeperLabel(latest.climateKeeperMode))}
                </Badge>
              )}
            {latest?.defrostMode && (
              <Badge variant="info" dot>
                <Snowflake className="mr-1 inline h-3 w-3" />
                {t('Defrost')}
              </Badge>
            )}
            {latest?.batteryHeater && (
              <Badge variant="warning" dot>
                <BatteryCharging className="mr-1 inline h-3 w-3" />
                {t('Battery Heater')}
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
              value={latest?.insideTemp ?? 0}
              max={TEMP_GAUGE_MAX}
              label={t('Inside Temp')}
              unit="°C"
              color={CHART_COLORS[0]}
            />
            <span className="text-lg font-bold text-[var(--text-primary)]">
              {fmtNumber(latest?.insideTemp ?? 0, 1)}°C
            </span>
          </GlassPanel>

          <GlassPanel className="flex flex-col items-center gap-2 p-6">
            <RadialGauge
              value={latest?.outsideTemp ?? 0}
              max={TEMP_GAUGE_MAX}
              label={t('Outside Temp')}
              unit="°C"
              color={CHART_COLORS[1]}
            />
            <span className="text-lg font-bold text-[var(--text-primary)]">
              {fmtNumber(latest?.outsideTemp ?? 0, 1)}°C
            </span>
          </GlassPanel>

          <GlassPanel className="flex flex-col items-center gap-2 p-6">
            <RadialGauge
              value={latest?.driverTempSetting ?? 0}
              max={TEMP_GAUGE_MAX}
              label={t('Driver Set Temp')}
              unit="°C"
              color={CHART_COLORS[2]}
            />
            <span className="text-lg font-bold text-[var(--text-primary)]">
              {fmtNumber(latest?.driverTempSetting ?? 0, 1)}°C
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
                className={clsx(
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
              latest.climateKeeperMode !== 'off'
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
            label={t('Steering Wheel Heater')}
            value={latest?.steeringWheelHeat ? t('On') : t('Off')}
            icon={
              <CircleGauge
                className={clsx(
                  'h-5 w-5',
                  latest?.steeringWheelHeat
                    ? 'text-amber-400'
                    : 'text-gray-500',
                )}
              />
            }
          />

          <MetricCard
            label={t('Defrost Mode')}
            value={latest?.defrostMode ? t('Active') : t('Inactive')}
            icon={
              <Snowflake
                className={clsx(
                  'h-5 w-5',
                  latest?.defrostMode ? 'text-blue-400' : 'text-gray-500',
                )}
              />
            }
          />
        </div>
      </FadeIn>

      {/* ─── Protection & Safety Row ─── */}
      <FadeIn delay={0.25}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <MetricCard
            label={t('Overheat Protection')}
            value={latest?.overheatProtection ?? t('Unknown')}
            icon={<ShieldCheck className="h-5 w-5 text-green-400" />}
          />
          <MetricCard
            label={t('Battery Heater')}
            value={latest?.batteryHeater ? t('On') : t('Off')}
            icon={
              <BatteryCharging
                className={clsx(
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

          {/* Legend */}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-4">
            {HEAT_LEVELS.map((lvl, idx) => (
              <div key={lvl.label} className="flex items-center gap-1.5">
                <Flame className={clsx('h-3.5 w-3.5', lvl.color)} />
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
              <LineChart data={history} margin={chartMarginLabeled}>
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
            />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
