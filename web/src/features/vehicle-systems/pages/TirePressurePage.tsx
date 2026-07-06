import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Gauge, AlertTriangle, TrendingDown, Activity, Clock, AlertCircle,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Badge, DataTable, PanelTitle, useSortToggle, type Column } from '@/components/ui';
import { RangePicker, VehicleSelect } from '@/components/forms';
import { MetricCard } from '@/components/data-display';
import {
  RadialGauge, ChartTooltip, CHART_COLORS, AREA_DEFAULTS, axisTickSm,
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from '@/components/charts';
import { Skeleton, EmptyState, AlertBanner, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useRangeState } from '@/hooks/useRangeState';
import { useUnits } from '@/hooks/useUnits';
import { convertPressureFromSI } from '@/lib/unitConversion';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { getErrorMessage } from '@/lib/errorMessage';
import { request } from '@/api/client';
import { AITirePressureTrendReasoning } from '@/components/ai/AITirePressureTrendReasoning';

/* ------------------------------------------------------------------ */
/*  Types (snake_case from backend)                                    */
/* ------------------------------------------------------------------ */

export interface TirePressureReading {
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

/**
 * Check if a TPMS warning JSON string contains any true value.
 *
 * Exported (with the other pure helpers below) so the corner-status /
 * normalisation logic can be unit-tested in isolation without mounting the
 * whole page. The page's public surface is still the default export.
 */
export function hasTpmsWarning(val: string | null | undefined): boolean {
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
// values in Pa; units.ToSI converts both bar and psi inputs to Pa per
// `internal/tesla/units/units.go`.
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
 * codec cannot run `units.ToSI` on TpmsPressure* atomics. The raw codec
 * value (bar for metric vehicles, psi for imperial) lands in `signal.Store`,
 * and the `/tire-pressure/latest` handler echoes it back verbatim. The bug
 * surfaced as gauges showing ~0 with all-critical badges, which reads as
 * "vehicle is broken" rather than "vehicle unit context is missing".
 *
 * Until the source-unit gap is fixed, this helper detects the three
 * plausible source units by value range and normalises to Pa so the page
 * renders accurate readings today.
 *
 * Ranges (typical passenger car tire pressures):
 *   - Pa     : 150_000–500_000   → return as-is
 *   - kPa    : 150–500           → multiply by 1_000
 *   - psi    : 20–60             → multiply by 6_894.757
 *   - bar    : 1.5–5             → multiply by 100_000
 *   - 0/null : missing reading   → return 0
 */
export function normaliseTpmsToPa(raw: number | null | undefined): number {
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return 0;
  if (raw >= 50_000) return raw; // already Pa
  if (raw >= 100) return raw * 1_000; // kPa
  if (raw >= 10) return raw * 6_894.757; // psi
  return raw * 100_000; // bar (covers 0.5..10)
}

export const TIRE_POSITIONS = ['fl', 'fr', 'rl', 'rr'] as const;
export type TirePosition = (typeof TIRE_POSITIONS)[number];

// English fallbacks; the visible labels are resolved through i18n at the
// render boundary via `tireLabel(pos)` so translators can localise each
// corner without touching this map.
const TIRE_LABELS: Record<TirePosition, string> = {
  fl: 'Front Left',
  fr: 'Front Right',
  rl: 'Rear Left',
  rr: 'Rear Right',
};

export type PressureStatus = 'normal' | 'low' | 'high' | 'critical';

// English fallbacks for the four status buckets; resolved via `statusLabel`.
const STATUS_LABELS: Record<PressureStatus, string> = {
  normal: 'Normal',
  low: 'Low',
  high: 'High',
  critical: 'Critical',
};

const PRESET_IDS = ['7d', '30d', '90d', 'mtd', 'ytd', 'all'];

export function getTirePressureValue(
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

export function pressureColor(pa: number): string {
  if (pa >= NORMAL_MIN_PA && pa <= NORMAL_MAX_PA) return '#10b981';
  if (pa >= SOFT_LOW_PA && pa <= SOFT_HIGH_PA) return '#f59e0b';
  return '#ef4444';
}

export function pressureStatus(pa: number): PressureStatus {
  if (pa < SOFT_LOW_PA) return 'critical';
  if (pa < NORMAL_MIN_PA) return 'low';
  if (pa > SOFT_HIGH_PA) return 'critical';
  if (pa > NORMAL_MAX_PA) return 'high';
  return 'normal';
}

export function statusVariant(
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

  // i18n label resolvers — keep the English constant as the fallback so
  // untranslated locales still render a meaningful corner / status name.
  const tireLabel = useCallback(
    (pos: TirePosition) => t(`tirePressure.tire.${pos}`, TIRE_LABELS[pos]),
    [t],
  );
  const statusLabel = useCallback(
    (status: PressureStatus) =>
      t(`tirePressure.status.${status}`, STATUS_LABELS[status]),
    [t],
  );

  // Backend `front_left`/`front_right`/`rear_left`/`rear_right` arrive
  // in Pa (SI). `convertPressureFromSI` expects kPa, so divide by 1000
  // at the boundary.
  const pressureDisplayValue = (pa: number) =>
    convertPressureFromSI(pa / 1000, unitPrefs.pressure);

  const gaugeMax = pressureDisplayValue(GAUGE_MAX_PA);

  // Header VehiclePicker is the source of truth.
  const { vehicleId: activeVehicleId } = useSelectedVehicle();
  const { start, end, setRange } = useRangeState({
    persistKey: 'tire-pressure.range',
    defaultPresetId: '30d',
  });

  /* ---- API queries ---- */

  const latestQuery = useQuery({
    queryKey: ['tire-pressure-latest', activeVehicleId],
    queryFn: () =>
      request<TirePressureReading>(
        `/tire-pressure/latest?vehicle_id=${activeVehicleId}`,
      ),
    enabled: activeVehicleId !== null,
  });
  const {
    data: latest,
    isLoading: loadingLatest,
    error: latestError,
    refetch: refetchLatest,
  } = latestQuery;

  const historyQuery = useQuery({
    queryKey: ['tire-pressure-history', activeVehicleId, start, end],
    queryFn: () =>
      request<TirePressureReading[]>(
        `/tire-pressure?vehicle_id=${activeVehicleId}&start=${start}&end=${end}`,
      ),
    enabled: activeVehicleId !== null,
  });
  const {
    data: history,
    isLoading: loadingHistory,
    error: historyError,
    refetch: refetchHistory,
  } = historyQuery;

  const anyError = [latestError, historyError].find(Boolean);

  /* ---- Derived data ---- */

  const hardWarning = hasTpmsWarning(latest?.tpms_hard_warnings);
  const softWarning = hasTpmsWarning(latest?.tpms_soft_warnings);
  const hasWarning = hardWarning || softWarning;

  const summaryStats = useMemo(() => {
    if (!latest) return null;
    // A corner that never reported normalises to 0 (see normaliseTpmsToPa).
    // Treat those as "no reading", not 0 Pa — otherwise a vehicle that only
    // reports some corners shows a phantom 0-bar minimum and inflated warning
    // count, which reads as "broken" rather than "partial". Aggregate over the
    // corners that actually have a reading; when none do, surface "no data".
    const values = TIRE_POSITIONS.map((p) => getTirePressureValue(latest, p)).filter(
      (v) => v > 0,
    );
    if (values.length === 0) return null;
    const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
    const min = Math.min(...values);
    const warningCount = values.filter(
      (v) => v < NORMAL_MIN_PA || v > NORMAL_MAX_PA,
    ).length;
    return { avg, min, warningCount };
  }, [latest]);

  // Canonical chronological order (oldest first). The /tire-pressure endpoint
  // forwards rows in StateReader.Timeline order (ASC) but the contract doesn't
  // pin that, so we sort defensively here. This becomes the single source of
  // truth for both the chart (renders left=oldest, right=newest) and the
  // newest-first table derivation below.
  const historyAsc = useMemo<TirePressureReading[]>(() => {
    if (!history?.length) return [];
    return [...history].sort((a, b) =>
      (a.created_at ?? '').localeCompare(b.created_at ?? ''),
    );
  }, [history]);

  const chartData: ChartDatum[] = useMemo(() => {
    if (historyAsc.length === 0) return [];
    return historyAsc.map((r) => ({
      time: formatDateTime(r.created_at),
      fl: pressureDisplayValue(normaliseTpmsToPa(r.front_left)),
      fr: pressureDisplayValue(normaliseTpmsToPa(r.front_right)),
      rl: pressureDisplayValue(normaliseTpmsToPa(r.rear_left)),
      rr: pressureDisplayValue(normaliseTpmsToPa(r.rear_right)),
    }));
    // unitPrefs.pressure is the only relevant primitive dep — depending on
    // the closure-captured `pressureDisplayValue` would also work but referencing
    // the primitive keeps the dep list stable for memo invalidation.
  }, [historyAsc, unitPrefs.pressure]);

  // Newest entry in the selected range — used to populate "Last Updated"
  // because /tire-pressure/latest returns only field values (no timestamp).
  // This is the freshness of the visible window, not necessarily global
  // freshness; the label is range-bound by design.
  const lastUpdatedAt = useMemo<string | null>(() => {
    if (historyAsc.length === 0) return null;
    return historyAsc[historyAsc.length - 1].created_at ?? null;
  }, [historyAsc]);

  /* ---- Table sort: newest-first by default, all sortable columns wired ---- */

  // Accessor used by useSortToggle to extract a comparable value per
  // column key. Numeric tire columns sort by their normalised Pa value so
  // the Badge-wrapped renders sort by magnitude, not by Badge label text.
  const sortAccessor = useCallback(
    (row: TirePressureReading, key: string): number | string => {
      switch (key) {
        case 'created_at':
          return row.created_at ?? '';
        case 'fl':
        case 'fr':
        case 'rl':
        case 'rr':
          return getTirePressureValue(row, key);
        default:
          return '';
      }
    },
    [],
  );

  const { sortKey, sortDir, onSort, sortFn } = useSortToggle(
    'created_at',
    'desc',
  );

  const tableData = useMemo(
    () => sortFn(historyAsc, sortAccessor),
    [historyAsc, sortFn, sortAccessor],
  );

  /* ---- Table columns ---- */

  const historyColumns: Column<TirePressureReading>[] = useMemo(
    () => [
      {
        key: 'created_at',
        header: t('tirePressure.col.time', 'Time'),
        render: (row: TirePressureReading) => formatDateTime(row.created_at),
        sortable: true,
      },
      ...TIRE_POSITIONS.map(
        (pos): Column<TirePressureReading> => ({
          key: pos,
          header: `${tireLabel(pos)} (${pressureUnit})`,
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
        header: t('tirePressure.col.warnings', 'Warnings'),
        render: (row: TirePressureReading) => {
          if (hasTpmsWarning(row.tpms_hard_warnings)) {
            return (
              <Badge variant="danger" size="sm" dot>
                {t('tirePressure.warn.hardShort', 'Hard Warning')}
              </Badge>
            );
          }
          if (hasTpmsWarning(row.tpms_soft_warnings)) {
            return (
              <Badge variant="warning" size="sm" dot>
                {t('tirePressure.warn.softShort', 'Soft Warning')}
              </Badge>
            );
          }
          return (
            <Badge variant="success" size="sm">
              {t('tirePressure.warn.ok', 'OK')}
            </Badge>
          );
        },
      },
    ],
    // pressureUnit rebuilds the render closures with the correct display unit
    // when the user flips their pressure preference; between changes the deps
    // are stable so the columns keep their identity.
    [t, tireLabel, pressureUnit],
  );

  /* ---- Render ---- */

  return (
    <PageContainer
      title={t('tirePressure.title', 'Tire Pressure')}
      subtitle={t(
        'tirePressure.subtitle',
        'Monitor tire pressure readings and history',
      )}
      query={[latestQuery, historyQuery]}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <VehicleSelect
            ariaLabel={t('tirePressure.selectVehicle', 'Select vehicle')}
            className="w-40 sm:w-44"
          />
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
        <AlertBanner
          variant="danger"
          icon={<AlertCircle className="h-5 w-5" aria-hidden="true" />}
          title={t('error.loadFailed', 'Failed to load data')}
        >
          {getErrorMessage(anyError)}
        </AlertBanner>
      )}

      {/* AI opt-in narration — renders nothing when the feature is disabled. */}
      <AITirePressureTrendReasoning vehicleId={activeVehicleId ?? undefined} />

      {/* TPMS warning banner — surfaced when the latest reading flags a corner. */}
      {hasWarning && (
        <AlertBanner
          variant={hardWarning ? 'danger' : 'warning'}
          icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
          title={
            hardWarning
              ? t('tirePressure.warn.hardTitle', 'Hard TPMS warning active')
              : t('tirePressure.warn.softTitle', 'Soft TPMS warning active')
          }
        >
          {hardWarning
            ? t(
                'tirePressure.warn.hardBody',
                'One or more tires need immediate attention.',
              )
            : t(
                'tirePressure.warn.softBody',
                'One or more tires are outside the recommended range.',
              )}
        </AlertBanner>
      )}

      {/* 1 — KPI band: full-width responsive metric grid */}
      <FadeIn>
        <section
          aria-label={t('tirePressure.kpis', 'Tire pressure summary')}
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
        >
          <MetricCard
            label={t('tirePressure.avgPressure', 'Avg Pressure')}
            value={
              summaryStats
                ? `${fmtNumber(pressureDisplayValue(summaryStats.avg ?? 0))} ${pressureUnit}`
                : '—'
            }
            icon={<Activity className="h-5 w-5" aria-hidden="true" />}
            color="cyan"
          />
          <MetricCard
            label={t('tirePressure.minPressure', 'Min Pressure')}
            value={
              summaryStats
                ? `${fmtNumber(pressureDisplayValue(summaryStats.min ?? 0))} ${pressureUnit}`
                : '—'
            }
            icon={<TrendingDown className="h-5 w-5" aria-hidden="true" />}
            color="green"
          />
          <MetricCard
            label={t('tirePressure.warningCount', 'Warning Count')}
            value={summaryStats?.warningCount ?? 0}
            icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
            color="amber"
          />
          <MetricCard
            label={t('tirePressure.lastUpdated', 'Last Updated')}
            value={lastUpdatedAt ? formatDateTime(lastUpdatedAt) : '—'}
            icon={<Clock className="h-5 w-5" aria-hidden="true" />}
            color="purple"
          />
        </section>
      </FadeIn>

      {/* 2 — Hero bento: current-reading gauges beside the history chart */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('tirePressure.readings', 'Current readings and trend')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3"
        >
          {/* Current readings — four corner radial gauges */}
          <GlassPanel className="p-4 sm:p-5 xl:col-span-1">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Gauge className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('tirePressure.currentReadings', 'Current Readings')}
            </PanelTitle>

            {loadingLatest && !latest ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-2">
                {TIRE_POSITIONS.map((pos) => (
                  <Skeleton key={pos} height={148} className="w-full" />
                ))}
              </div>
            ) : latestError ? (
              <QueryError
                error={latestError}
                onRetry={() => refetchLatest()}
                resourceName={t('tirePressure.resource', 'Tire pressure')}
              />
            ) : !latest ? (
              <EmptyState /* no-action: transient empty state — surfaces when no live reading exists for the vehicle */
                icon={<Gauge className="h-8 w-8" />}
                message={t(
                  'tirePressure.noReadings',
                  'No current readings available',
                )}
              />
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-2">
                {TIRE_POSITIONS.map((pos) => {
                  const value = getTirePressureValue(latest, pos);
                  const color = pressureColor(value);
                  const status = pressureStatus(value);
                  return (
                    <GlassPanel
                      key={pos}
                      hover
                      className="flex min-w-0 flex-col items-center gap-3 p-3"
                    >
                      <RadialGauge
                        value={pressureDisplayValue(value)}
                        max={gaugeMax}
                        label={tireLabel(pos)}
                        unit={pressureUnit}
                        color={color}
                        size={120}
                      />
                      <Badge variant={statusVariant(status)} size="sm">
                        {statusLabel(status)}
                      </Badge>
                    </GlassPanel>
                  );
                })}
              </div>
            )}
          </GlassPanel>

          {/* Pressure history — hero time-series spanning the remaining width */}
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Gauge className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('tirePressure.pressureHistory', 'Pressure History')}
            </PanelTitle>

            {loadingHistory && !history ? (
              <Skeleton height={260} className="w-full" />
            ) : historyError ? (
              <QueryError
                error={historyError}
                onRetry={() => refetchHistory()}
                resourceName={t('tirePressure.resource', 'Tire pressure')}
              />
            ) : chartData.length === 0 ? (
              <EmptyState /* no-action: transient empty state — surfaces when the selected window has no history */
                icon={<Gauge className="h-8 w-8" />}
                message={t('tirePressure.noHistory', 'No history data')}
              />
            ) : (
              <div className="h-56 sm:h-64 xl:h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--glass-border)"
                      strokeOpacity={0.5}
                    />
                    <XAxis
                      dataKey="time"
                      tick={axisTickSm}
                    />
                    <YAxis
                      domain={['auto', 'auto']}
                      tick={axisTickSm}
                      tickFormatter={(v: number) => fmtNumber(v, 1)}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {TIRE_POSITIONS.map((pos) => (
                      <Line
                        key={pos}
                        {...AREA_DEFAULTS}
                        dataKey={pos}
                        name={tireLabel(pos)}
                        stroke={LINE_COLORS[pos]}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* 3 — Detail band: full-width history table */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('tirePressure.historyTable', 'History Table')}
          </PanelTitle>

          {loadingHistory && !history ? (
            <Skeleton height={220} className="w-full" />
          ) : historyError ? (
            <QueryError
              error={historyError}
              onRetry={() => refetchHistory()}
              resourceName={t('tirePressure.resource', 'Tire pressure')}
            />
          ) : !history?.length ? (
            <EmptyState /* no-action: transient empty state — surfaces when the selected window has no history */
              icon={<Clock className="h-8 w-8" />}
              message={t('tirePressure.noHistory', 'No history data')}
            />
          ) : (
            <DataTable
              tableId="vehicle-systems:tire-pressure-history"
              columns={historyColumns}
              data={tableData}
              keyExtractor={(row) => row.id}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              emptyMessage={t('tirePressure.noHistory', 'No history data')}
              compact
              pagination
            />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
