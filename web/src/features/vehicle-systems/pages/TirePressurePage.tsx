import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Gauge, AlertTriangle, TrendingDown, Activity, Clock, AlertCircle,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Badge, DataTable, type Column } from '@/components/ui';
import { RangePicker, VehicleSelect } from '@/components/forms';
import { useRangeState } from '@/hooks/useRangeState';
import { MetricCard } from '@/components/data-display';
import {
  RadialGauge, ChartTooltip, CHART_COLORS, AREA_DEFAULTS,
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from '@/components/charts';
import { Skeleton, EmptyState, AlertBanner } from '@/components/feedback';
import { getErrorMessage } from '@/lib/errorMessage';
import { FadeIn } from '@/components/motion';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { convertPressureFromSI } from '@/lib/unitConversion';
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

// Thresholds in Pascals (SI). Backend `signal_log` stores TpmsPressure
// values in Pa after Phase-42 normalization (units.ToSI converts both
// bar and psi inputs to Pa per `internal/tesla/units/units.go`).
// 1 bar = 100_000 Pa, 1 psi ≈ 6894.757 Pa.
const NORMAL_MIN_PA = 250_000; // 2.5 bar
const NORMAL_MAX_PA = 350_000; // 3.5 bar
const SOFT_LOW_PA = 200_000; // 2.0 bar
const SOFT_HIGH_PA = 400_000; // 4.0 bar
const GAUGE_MAX_PA = 500_000; // 5.0 bar

/**
 * Interim adapter that coerces a raw TPMS value to Pa.
 *
 * Background: when `vehicle_unit_history` lacks a row for a vehicle, the
 * Phase-42 codec cannot run `units.ToSI` on TpmsPressure* atomics — the
 * raw codec value (bar for metric vehicles, psi for imperial) lands in
 * `signal.Store` and the `/tire-pressure/latest` handler echoes it back
 * verbatim. Pre-Phase-42 the bug surfaced as gauges showing ~0 with all-
 * critical badges, which reads as "vehicle is broken" rather than
 * "vehicle unit context is missing".
 *
 * Until the cross-cutting fix lands (see ui_audit
 * `vd-tire-pressure-units-wrong`, blocked on user decision Option A/B/C
 * — re-seed unit history vs. FE band-aid vs. codec-side SI emission),
 * this helper detects the three plausible source units by value range
 * and normalises to Pa so the page renders accurate readings today.
 *
 * Ranges (typical passenger car tire pressures):
 *   - Pa     : 150_000–500_000   → return as-is
 *   - kPa    : 150–500           → multiply by 1_000
 *   - psi    : 20–60             → multiply by 6_894.757
 *   - bar    : 1.5–5             → multiply by 100_000
 *   - 0/null : missing reading   → return 0
 */
function normaliseTpmsToPa(raw: number | null | undefined): number {
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return 0;
  if (raw >= 50_000) return raw; // already Pa
  if (raw >= 100) return raw * 1_000; // kPa
  if (raw >= 10) return raw * 6_894.757; // psi
  return raw * 100_000; // bar (covers 0.5..10)
}

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

const PRESET_IDS = ['7d', '30d', '90d', 'mtd', 'ytd', 'all'];

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
  return normaliseTpmsToPa(map[pos]);
}

type PressureStatus = 'normal' | 'low' | 'high' | 'critical';

function pressureColor(pa: number): string {
  if (pa >= NORMAL_MIN_PA && pa <= NORMAL_MAX_PA) return '#10b981';
  if (pa >= SOFT_LOW_PA && pa <= SOFT_HIGH_PA) return '#f59e0b';
  return '#ef4444';
}

function pressureStatus(pa: number): PressureStatus {
  if (pa < SOFT_LOW_PA) return 'critical';
  if (pa < NORMAL_MIN_PA) return 'low';
  if (pa > SOFT_HIGH_PA) return 'critical';
  if (pa > NORMAL_MAX_PA) return 'high';
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
  const { unitPrefs } = useUnits();
  const pressureUnit = unitPrefs.pressure;

  // Backend `front_left`/`front_right`/`rear_left`/`rear_right` arrive
  // in Pa (SI). `convertPressureFromSI` expects kPa, so divide by 1000
  // at the boundary (precedent: Phase-43/0022 useDriveDetailData).
  const pressureDisplayValue = (pa: number) =>
    convertPressureFromSI(pa / 1000, unitPrefs.pressure);

  const gaugeMax = pressureDisplayValue(GAUGE_MAX_PA);

  // Phase 40 / Prompt 16: header VehiclePicker is the source of truth.
  const { vehicleId: activeVehicleId } = useSelectedVehicle();
  const { start, end, setRange } = useRangeState({
    persistKey: 'tire-pressure.range',
    defaultPresetId: '30d',
  });

  /* ---- API queries ---- */

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
    queryKey: ['tire-pressure-history', activeVehicleId, start, end],
    queryFn: () =>
      request<TirePressureReading[]>(
        `/tire-pressure?vehicle_id=${activeVehicleId}&start=${start}&end=${end}`,
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
      (v) => v < NORMAL_MIN_PA || v > NORMAL_MAX_PA,
    ).length;
    return { avg, min, warningCount };
  }, [latest]);

  const chartData: ChartDatum[] = useMemo(() => {
    if (!history?.length) return [];
    return [...history].reverse().map((r) => ({
      time: formatDateTime(r.created_at),
      fl: pressureDisplayValue(normaliseTpmsToPa(r.front_left)),
      fr: pressureDisplayValue(normaliseTpmsToPa(r.front_right)),
      rl: pressureDisplayValue(normaliseTpmsToPa(r.rear_left)),
      rr: pressureDisplayValue(normaliseTpmsToPa(r.rear_right)),
    }));
    // unitPrefs.pressure is the only relevant primitive dep — depending on
    // the closure-captured `pressureDisplayValue` would also work but referencing
    // the primitive keeps the dep list stable for memo invalidation.
  }, [history, unitPrefs.pressure]);

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
                {fmtNumber(pressureDisplayValue(val ?? 0))}
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
        <div className="flex flex-wrap items-center justify-end gap-3">
          <VehicleSelect ariaLabel={t('tirePressure.selectVehicle', 'Select vehicle')} className="w-44" />
          <RangePicker
            value={{ start, end }}
            onChange={setRange}
            presetIds={PRESET_IDS}
            align="end"
            triggerTestId="tire-pressure-range"
          />
        </div>
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
                          value={pressureDisplayValue(value)}
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
                ? `${fmtNumber(pressureDisplayValue(summaryStats.avg ?? 0))} ${pressureUnit}`
                : '—'
            }
            icon={<Activity className="h-5 w-5" />}
            color="cyan"
          />
          <MetricCard
            label={t('Min Pressure')}
            value={
              summaryStats
                ? `${fmtNumber(pressureDisplayValue(summaryStats.min ?? 0))} ${pressureUnit}`
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
            <div className="mb-4 flex items-center gap-2">
              <Gauge className="h-5 w-5 text-cyan-400" />
              <Badge variant="info" size="sm">
                {t('Pressure History')}
              </Badge>
            </div>

            {loadingHistory ? (
              <Skeleton height={300} className="w-full" />
            ) : chartData.length === 0 ? (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
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
                    domain={['auto', 'auto']}
                    tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                    tickFormatter={(v: number) => fmtNumber(v, 1)}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {TIRE_POSITIONS.map((pos) => (
                    <Line
                      key={pos}
                      {...AREA_DEFAULTS}
                      dataKey={pos}
                      name={TIRE_LABELS[pos]}
                      stroke={LINE_COLORS[pos]}
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
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                icon={<Clock className="h-8 w-8" />}
                message={t('No History Data')}
              />
            ) : (
              <DataTable
                tableId="vehicle-systems:tire-pressure-history"
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
