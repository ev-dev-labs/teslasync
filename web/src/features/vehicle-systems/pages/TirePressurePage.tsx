import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Gauge, AlertTriangle, TrendingDown, Activity, Clock, AlertCircle,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Badge, Button, Select, DataTable, type Column } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import {
  RadialGauge, ChartTooltip, CHART_COLORS,
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from '@/components/charts';
import { Skeleton, EmptyState, AlertBanner } from '@/components/feedback';
import { getErrorMessage } from '@/lib/errorMessage';
import { FadeIn } from '@/components/motion';

import { useVehicles } from '@/api/hooks/useVehicles';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSettings } from '@/hooks/useSettings';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { request } from '@/api/client';

/* ------------------------------------------------------------------ */
/*  Types (snake_case from backend)                                    */
/* ------------------------------------------------------------------ */

interface TirePressureReading {
  id: number;
  vehicle_id: number;
  front_left: number;
  front_right: number;
  rear_left: number;
  rear_right: number;
  tpms_hard_warnings?: string | null;
  tpms_soft_warnings?: string | null;
  created_at: string;
}

/* ------------------------------------------------------------------ */
/*  Constants & helpers                                                */
/* ------------------------------------------------------------------ */

/** Check if a TPMS warning JSON string contains any true value. */
function hasTpmsWarning(val: string | null | undefined): boolean {
  if (!val) return false;
  try {
    const parsed = JSON.parse(val) as Record<string, boolean>;
    return Object.values(parsed).some(Boolean);
  } catch {
    // Fallback: treat non-empty non-JSON strings as truthy
    return val !== 'false' && val !== '';
  }
}

// Thresholds in Bar (internal unit — DB stores Bar)
const NORMAL_MIN_BAR = 2.5;
const NORMAL_MAX_BAR = 3.5;
const GAUGE_MAX_BAR = 5.0;

const TIRE_POSITIONS = ['fl', 'fr', 'rl', 'rr'] as const;
type TirePosition = (typeof TIRE_POSITIONS)[number];

const TIRE_LABELS: Record<TirePosition, string> = {
  fl: 'Front Left',
  fr: 'Front Right',
  rl: 'Rear Left',
  rr: 'Rear Right',
};

const STATUS_LABELS: Record<PressureStatus, string> = {
  normal: 'Normal',
  low: 'Low',
  high: 'High',
  critical: 'Critical',
};

const TIME_RANGE_OPTIONS = [
  { value: 50, label: '7 Days' },
  { value: 200, label: '30 Days' },
  { value: 500, label: '90 Days' },
  { value: 2000, label: 'All' },
] as const;

function getTirePressureValue(
  reading: TirePressureReading,
  pos: TirePosition,
): number {
  const map: Record<TirePosition, number> = {
    fl: reading.front_left,
    fr: reading.front_right,
    rl: reading.rear_left,
    rr: reading.rear_right,
  };
  return map[pos] ?? 0;
}

type PressureStatus = 'normal' | 'low' | 'high' | 'critical';

function pressureColor(bar: number): string {
  if (bar >= NORMAL_MIN_BAR && bar <= NORMAL_MAX_BAR) return '#10b981';
  if (bar >= 2.0 && bar <= 4.0) return '#f59e0b';
  return '#ef4444';
}

function pressureStatus(bar: number): PressureStatus {
  if (bar < 2.0) return 'critical';
  if (bar < NORMAL_MIN_BAR) return 'low';
  if (bar > 4.0) return 'critical';
  if (bar > NORMAL_MAX_BAR) return 'high';
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
  usePageTitle(t('tirePressure.title', 'Tire Pressure'));
  const { convertPressure, pressureUnit } = useSettings();

  const gaugeMax = convertPressure(GAUGE_MAX_BAR);

  const [vehicleId, setVehicleId] = useState<number | null>(null);
  const [timeRange, setTimeRange] = useState(200);

  /* ---- API queries ---- */

  const { data: vehicles } = useVehicles();

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

  const { data: history, isLoading: loadingHistory, error: historyError } = useQuery({
    queryKey: ['tire-pressure-history', activeVehicleId, timeRange],
    queryFn: () =>
      request<TirePressureReading[]>(
        `/tire-pressure?vehicle_id=${activeVehicleId}&limit=${timeRange}`,
      ),
    enabled: activeVehicleId !== null,
  });

  const anyError = [latestError, historyError].find(Boolean);

  /* ---- Derived data ---- */

  const hasWarning = hasTpmsWarning(latest?.tpms_hard_warnings) || hasTpmsWarning(latest?.tpms_soft_warnings);

  const summaryStats = useMemo(() => {
    if (!latest) return null;
    const values = TIRE_POSITIONS.map((p) => getTirePressureValue(latest, p));
    const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
    const min = Math.min(...values);
    const warningCount = values.filter(
      (v) => v < NORMAL_MIN_BAR || v > NORMAL_MAX_BAR,
    ).length;
    return { avg, min, warningCount };
  }, [latest]);

  const chartData: ChartDatum[] = useMemo(() => {
    if (!history?.length) return [];
    return [...history].reverse().map((r) => ({
      time: formatDateTime(r.created_at),
      fl: convertPressure(r.front_left),
      fr: convertPressure(r.front_right),
      rl: convertPressure(r.rear_left),
      rr: convertPressure(r.rear_right),
    }));
  }, [history, convertPressure]);

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
          key: pos,
          header: `${TIRE_LABELS[pos]} (${pressureUnit})`,
          render: (row: TirePressureReading) => {
            const val = getTirePressureValue(row, pos);
            const status = pressureStatus(val);
            return (
              <Badge variant={statusVariant(status)} size="sm">
                {fmtNumber(convertPressure(val ?? 0))}
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
          if (hasTpmsWarning(row.tpms_hard_warnings)) {
            return (
              <Badge variant="danger" size="sm" dot>
                {t('Hard Warning')}
              </Badge>
            );
          }
          if (hasTpmsWarning(row.tpms_soft_warnings)) {
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
      title={t('tirePressure.title', 'Tire Pressure')}
      subtitle={t('tirePressure.subtitle', 'Monitor tire pressure readings and history')}
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
      {anyError && (
        <AlertBanner variant="danger" icon={<AlertCircle className="h-5 w-5" />}>
          {t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(anyError)}
        </AlertBanner>
      )}

      <FadeIn>
        {/* Warning banner */}
        {hasWarning && (
          <GlassPanel
            className={cn(
              'mb-6 flex items-center gap-3 px-4 py-3',
              hasTpmsWarning(latest?.tpms_hard_warnings)
                ? 'border-red-500/40'
                : 'border-amber-500/40',
            )}
          >
            <AlertTriangle
              className={cn(
                'h-5 w-5 shrink-0',
                hasTpmsWarning(latest?.tpms_hard_warnings) ? 'text-red-400' : 'text-amber-400',
              )}
            />
            <Badge variant={hasTpmsWarning(latest?.tpms_hard_warnings) ? 'danger' : 'warning'}>
              {hasTpmsWarning(latest?.tpms_hard_warnings)
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
                          value={convertPressure(value)}
                          max={gaugeMax}
                          label={TIRE_LABELS[pos]}
                          unit={pressureUnit}
                          color={color}
                          size={120}
                        />
                        <Badge variant={statusVariant(status)} size="sm">
                          {STATUS_LABELS[status]}
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
                ? `${fmtNumber(convertPressure(summaryStats.avg ?? 0))} ${pressureUnit}`
                : '—'
            }
            icon={<Activity className="h-5 w-5" />}
            color="cyan"
          />
          <MetricCard
            label={t('Min Pressure')}
            value={
              summaryStats
                ? `${fmtNumber(convertPressure(summaryStats.min ?? 0))} ${pressureUnit}`
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
                    {t(opt.label)}
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
                    tickFormatter={(v: number) => fmtNumber(v, 1)}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {TIRE_POSITIONS.map((pos) => (
                    <Line
                      key={pos}
                      type="monotone"
                      dataKey={pos}
                      name={TIRE_LABELS[pos]}
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
                pagination
              />
            )}
          </FadeIn>
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
