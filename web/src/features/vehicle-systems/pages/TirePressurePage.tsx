import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Gauge,
  AlertTriangle,
  TrendingDown,
  Activity,
  Clock,
} from 'lucide-react';
import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { DataTable, type Column } from '@/components/ui/DataTable';
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
} from '@/components/charts';
import { ChartTooltip } from '@/components/charts/ChartTooltip';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateTime } from '@/lib/dateFormat';
import { CHART_COLORS } from '@/lib/colors';
import { request } from '@/api/client';

/* ------------------------------------------------------------------ */
/*  Types (snake_case from backend)                                    */
/* ------------------------------------------------------------------ */

interface TirePressureReading {
  id: number;
  vehicle_id: number;
  tpms_pressure_fl: number;
  tpms_pressure_fr: number;
  tpms_pressure_rl: number;
  tpms_pressure_rr: number;
  tpms_hard_warnings: boolean;
  tpms_soft_warnings: boolean;
  created_at: string;
}

interface Vehicle {
  id: number;
  vin: string;
  display_name: string;
}

/* ------------------------------------------------------------------ */
/*  Constants & helpers                                                */
/* ------------------------------------------------------------------ */

const NORMAL_MIN = 2.5;
const NORMAL_MAX = 3.5;
const GAUGE_MAX = 5.0;

const TIRE_POSITIONS = ['fl', 'fr', 'rl', 'rr'] as const;
type TirePosition = (typeof TIRE_POSITIONS)[number];

const TIME_RANGE_OPTIONS = [
  { value: 50, labelKey: 'tirePressure.range7d' },
  { value: 200, labelKey: 'tirePressure.range30d' },
  { value: 500, labelKey: 'tirePressure.range90d' },
  { value: 2000, labelKey: 'tirePressure.rangeAll' },
] as const;

function getTirePressureValue(
  reading: TirePressureReading,
  pos: TirePosition,
): number {
  const map: Record<TirePosition, number> = {
    fl: reading.tpms_pressure_fl,
    fr: reading.tpms_pressure_fr,
    rl: reading.tpms_pressure_rl,
    rr: reading.tpms_pressure_rr,
  };
  return map[pos];
}

type PressureStatus = 'normal' | 'low' | 'high' | 'critical';

function pressureColor(bar: number): string {
  if (bar >= NORMAL_MIN && bar <= NORMAL_MAX) return '#10b981';
  if (bar >= 2.0 && bar <= 4.0) return '#f59e0b';
  return '#ef4444';
}

function pressureStatus(bar: number): PressureStatus {
  if (bar < 2.0) return 'critical';
  if (bar < NORMAL_MIN) return 'low';
  if (bar > 4.0) return 'critical';
  if (bar > NORMAL_MAX) return 'high';
  return 'normal';
}

function statusVariant(
  status: PressureStatus,
): 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'normal':
      return 'success';
    case 'critical':
      return 'danger';
    default:
      return 'warning';
  }
}

/* ------------------------------------------------------------------ */
/*  Chart helpers                                                      */
/* ------------------------------------------------------------------ */

interface ChartDatum {
  time: string;
  fl: number;
  fr: number;
  rl: number;
  rr: number;
}

const LINE_COLORS: Record<TirePosition, string> = {
  fl: CHART_COLORS[0],
  fr: CHART_COLORS[2],
  rl: CHART_COLORS[1],
  rr: CHART_COLORS[3],
};

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

export default function TirePressurePage() {
  const { t } = useTranslation();
  usePageTitle(t('Title'));

  const [vehicleId, setVehicleId] = useState<number | null>(null);
  const [timeRange, setTimeRange] = useState(200);

  /* ---- API queries ---- */

  const { data: vehicles } = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => request<Vehicle[]>('/vehicles'),
  });

  const activeVehicleId = vehicleId ?? vehicles?.[0]?.id ?? null;

  const {
    data: latest,
    isLoading: loadingLatest,
    error: latestError,
  } = useQuery({
    queryKey: ['tire-pressure-latest', activeVehicleId],
    queryFn: () =>
      request<TirePressureReading>(
        `/tire-pressure/latest?vehicle_id=${activeVehicleId}`,
      ),
    enabled: activeVehicleId !== null,
  });

  const { data: history, isLoading: loadingHistory } = useQuery({
    queryKey: ['tire-pressure-history', activeVehicleId, timeRange],
    queryFn: () =>
      request<TirePressureReading[]>(
        `/tire-pressure?vehicle_id=${activeVehicleId}&limit=${timeRange}`,
      ),
    enabled: activeVehicleId !== null,
  });

  /* ---- Derived data ---- */

  const hasWarning = latest?.tpms_hard_warnings || latest?.tpms_soft_warnings;

  const summaryStats = useMemo(() => {
    if (!latest) return null;
    const values = TIRE_POSITIONS.map((p) => getTirePressureValue(latest, p));
    const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
    const min = Math.min(...values);
    const warningCount = values.filter(
      (v) => v < NORMAL_MIN || v > NORMAL_MAX,
    ).length;
    return { avg, min, warningCount };
  }, [latest]);

  const chartData: ChartDatum[] = useMemo(() => {
    if (!history?.length) return [];
    return [...history].reverse().map((r) => ({
      time: formatDateTime(r.created_at),
      fl: r.tpms_pressure_fl,
      fr: r.tpms_pressure_fr,
      rl: r.tpms_pressure_rl,
      rr: r.tpms_pressure_rr,
    }));
  }, [history]);

  /* ---- Table columns ---- */

  const historyColumns: Column<TirePressureReading>[] = useMemo(
    () => [
      {
        key: 'created_at',
        header: t('Time'),
        render: (row: TirePressureReading) => formatDateTime(row.created_at),
        sortable: true,
      },
      ...TIRE_POSITIONS.map(
        (pos): Column<TirePressureReading> => ({
          key: `tpms_pressure_${pos}`,
          header: t(`tirePressure.${pos}`),
          render: (row: TirePressureReading) => {
            const val = getTirePressureValue(row, pos);
            const status = pressureStatus(val);
            return (
              <Badge variant={statusVariant(status)} size="sm">
                {(val ?? 0).toFixed(2)} {t('Bar Unit')}
              </Badge>
            );
          },
          sortable: true,
        }),
      ),
      {
        key: 'warnings',
        header: t('Warnings'),
        render: (row: TirePressureReading) => {
          if (row.tpms_hard_warnings) {
            return (
              <Badge variant="danger" size="sm" dot>
                {t('Hard Warning')}
              </Badge>
            );
          }
          if (row.tpms_soft_warnings) {
            return (
              <Badge variant="warning" size="sm" dot>
                {t('Soft Warning')}
              </Badge>
            );
          }
          return (
            <Badge variant="success" size="sm">
              {t('Ok')}
            </Badge>
          );
        },
      },
    ],
    [t],
  );

  /* ---- Render ---- */

  const isLoading = loadingLatest && !latest;

  return (
    <PageContainer
      title={t('Title')}
      subtitle={t('Subtitle')}
      loading={isLoading}
      error={latestError as Error | null}
      actions={
        vehicles && vehicles.length > 1 ? (
          <Select
            options={vehicles.map((v) => ({
              value: String(v.id),
              label: v.display_name || v.vin,
            }))}
            value={String(activeVehicleId ?? '')}
            onChange={(e) => setVehicleId(Number(e.target.value))}
          />
        ) : undefined
      }
    >
      <FadeIn>
        {/* Warning banner */}
        {hasWarning && (
          <GlassPanel
            className={clsx(
              'mb-6 flex items-center gap-3 px-4 py-3',
              latest?.tpms_hard_warnings
                ? 'border-red-500/40'
                : 'border-amber-500/40',
            )}
          >
            <AlertTriangle
              className={clsx(
                'h-5 w-5 shrink-0',
                latest?.tpms_hard_warnings ? 'text-red-400' : 'text-amber-400',
              )}
            />
            <Badge variant={latest?.tpms_hard_warnings ? 'danger' : 'warning'}>
              {latest?.tpms_hard_warnings
                ? t('Hard Warning Active')
                : t('Soft Warning Active')}
            </Badge>
          </GlassPanel>
        )}

        {/* 4 Tire Pressure Gauges */}
        <GlassPanel className="mb-6 p-5">
          <FadeIn delay={0.1}>
            <div className="mb-3 flex items-center gap-2">
              <Gauge className="h-5 w-5 text-cyan-400" />
              <Badge variant="info" size="sm">
                {t('Current Readings')}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {TIRE_POSITIONS.map((pos) => {
                const value = latest
                  ? getTirePressureValue(latest, pos)
                  : 0;
                const color = pressureColor(value);
                const status = pressureStatus(value);

                return (
                  <GlassPanel
                    key={pos}
                    hover
                    className="flex flex-col items-center gap-3 p-4"
                  >
                    {loadingLatest ? (
                      <Skeleton height={120} className="w-full" />
                    ) : (
                      <>
                        <RadialGauge
                          value={value}
                          max={GAUGE_MAX}
                          label={t(`tirePressure.${pos}`)}
                          unit={t('Bar Unit')}
                          color={color}
                          size={120}
                        />
                        <Badge variant={statusVariant(status)} size="sm">
                          {t(`tirePressure.status.${status}`)}
                        </Badge>
                      </>
                    )}
                  </GlassPanel>
                );
              })}
            </div>
          </FadeIn>
        </GlassPanel>

        {/* Summary Stats */}
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MetricCard
            label={t('Avg Pressure')}
            value={
              summaryStats
                ? `${(summaryStats.avg ?? 0).toFixed(2)} ${t('Bar Unit')}`
                : '—'
            }
            icon={<Activity className="h-5 w-5" />}
            color="cyan"
          />
          <MetricCard
            label={t('Min Pressure')}
            value={
              summaryStats
                ? `${(summaryStats.min ?? 0).toFixed(2)} ${t('Bar Unit')}`
                : '—'
            }
            icon={<TrendingDown className="h-5 w-5" />}
            color="green"
          />
          <MetricCard
            label={t('Warning Count')}
            value={summaryStats?.warningCount ?? 0}
            icon={<AlertTriangle className="h-5 w-5" />}
            color="amber"
          />
          <MetricCard
            label={t('Last Updated')}
            value={latest ? formatDateTime(latest.created_at) : '—'}
            icon={<Clock className="h-5 w-5" />}
            color="purple"
          />
        </div>

        {/* Pressure History Chart */}
        <GlassPanel className="mb-6 p-5">
          <FadeIn delay={0.2}>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Gauge className="h-5 w-5 text-cyan-400" />
                <Badge variant="info" size="sm">
                  {t('Pressure History')}
                </Badge>
              </div>

              <div className="flex gap-1">
                {TIME_RANGE_OPTIONS.map((opt) => (
                  <Button
                    key={opt.value}
                    variant={
                      timeRange === opt.value ? 'secondary' : 'ghost'
                    }
                    size="sm"
                    onClick={() => setTimeRange(opt.value)}
                  >
                    {t(opt.labelKey)}
                  </Button>
                ))}
              </div>
            </div>

            {loadingHistory ? (
              <Skeleton height={300} className="w-full" />
            ) : chartData.length === 0 ? (
              <EmptyState
                icon={<Gauge className="h-8 w-8" />}
                message={t('No History Data')}
              />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--glass-border)"
                    strokeOpacity={0.5}
                  />
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                  />
                  <YAxis
                    domain={[2.0, 4.0]}
                    tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                    tickFormatter={(v: number) => v.toFixed(1)}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {TIRE_POSITIONS.map((pos) => (
                    <Line
                      key={pos}
                      type="monotone"
                      dataKey={pos}
                      name={t(`tirePressure.${pos}`)}
                      stroke={LINE_COLORS[pos]}
                      strokeWidth={2}
                      dot={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </FadeIn>
        </GlassPanel>

        {/* History DataTable */}
        <GlassPanel className="p-5">
          <FadeIn delay={0.3}>
            <div className="mb-4 flex items-center gap-2">
              <Clock className="h-5 w-5 text-purple-400" />
              <Badge variant="info" size="sm">
                {t('History Table')}
              </Badge>
            </div>

            {loadingHistory ? (
              <Skeleton height={200} className="w-full" />
            ) : !history?.length ? (
              <EmptyState
                icon={<Clock className="h-8 w-8" />}
                message={t('No History Data')}
              />
            ) : (
              <DataTable
                columns={historyColumns}
                data={history}
                keyExtractor={(row) => row.id}
                emptyMessage={t('No History Data')}
                compact
              />
            )}
          </FadeIn>
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
