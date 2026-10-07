import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Grid3X3 } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { request } from '@/api/client';
import { fmtNumber } from '@/lib/numberFormat';
import { convertSpeedFromSI, type SpeedUnitPref } from '@/lib/unitConversion';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import type { Drive } from '@/api/types';

/** 7 rows (Mon–Sun) × 24 cols (0h–23h) */
const ROWS = 7;
const COLS = 24;

export interface HeatCell {
  day: number;   // 0=Mon … 6=Sun
  hour: number;  // 0–23
  avgSpeed: number;
  count: number;
}

/** Build a 7×24 grid of average speeds from drive start times. */
export function buildHeatmap(drives: Drive[], speedUnit: SpeedUnitPref): HeatCell[][] {
  // Accumulator: [day][hour] → { total, count }
  const acc: { total: number; count: number }[][] = Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => ({ total: 0, count: 0 })),
  );

  for (const d of drives) {
    if (!d.start_ts) continue;
    const speed = d.avg_speed_mps ?? d.max_speed_mps;
    // `speed <= 0` alone lets a NaN through (`NaN <= 0` is false) which would
    // poison the cell average and produce a NaN colour later — require finite.
    if (speed == null || !Number.isFinite(speed) || speed <= 0) continue;

    const dt = new Date(d.start_ts);
    // A malformed `start_ts` yields an Invalid Date whose getDay()/getHours()
    // are NaN; indexing acc[NaN][NaN] would throw and crash the whole widget.
    if (Number.isNaN(dt.getTime())) continue;

    // JS getDay: 0=Sun … 6=Sat → remap to 0=Mon … 6=Sun
    const jsDay = dt.getDay();
    const day = jsDay === 0 ? 6 : jsDay - 1;
    const hour = dt.getHours();

    acc[day][hour].total += speed;
    acc[day][hour].count += 1;
  }

  return acc.map((row, day) =>
    row.map((cell, hour) => ({
      day,
      hour,
      avgSpeed: cell.count > 0 ? convertSpeedFromSI(cell.total / cell.count, speedUnit) : 0,
      count: cell.count,
    })),
  );
}

/** Interpolate between two hex colours. t ∈ [0, 1] */
export function lerpColor(a: [number, number, number], b: [number, number, number], t: number): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

// 4-stop gradient: empty → cool teal → warm amber → hot red
const COLOR_STOPS: [number, number, number][] = [
  [20, 184, 166],   // teal-500
  [6, 182, 212],    // cyan-500
  [245, 158, 11],   // amber-500
  [239, 68, 68],    // red-500
];

export function speedToColor(speed: number, maxSpeed: number): string {
  // Guard non-finite inputs too: a NaN would slip past `<= 0` and then index
  // COLOR_STOPS[NaN] → undefined → crash inside lerpColor.
  if (!Number.isFinite(speed) || !Number.isFinite(maxSpeed) || speed <= 0 || maxSpeed <= 0) {
    return 'rgba(255,255,255,0.03)';
  }
  const t = Math.min(speed / maxSpeed, 1);
  // Map t to a position across 3 segments (4 stops)
  const segCount = COLOR_STOPS.length - 1;
  const seg = Math.min(Math.floor(t * segCount), segCount - 1);
  const localT = (t * segCount) - seg;
  return lerpColor(COLOR_STOPS[seg], COLOR_STOPS[seg + 1], localT);
}

const DAY_LABELS_SHORT = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const DAY_LABELS_FULL = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function SpeedHeatmapWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { unitPrefs } = useUnits();

  const { data: drives, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['drives', id, 'speed-heatmap'],
    queryFn: () => request<Drive[]>(`/drives?vehicle_id=${id}&limit=200`),
    enabled: id > 0,
    staleTime: 120_000,
  });

  const grid = useMemo(() => buildHeatmap(drives ?? [], unitPrefs.speed), [drives, unitPrefs.speed]);

  const maxSpeed = useMemo(() => {
    let max = 0;
    for (const row of grid) {
      for (const cell of row) {
        if (cell.avgSpeed > max) max = cell.avgSpeed;
      }
    }
    return max;
  }, [grid]);

  const totalDrives = useMemo(() => {
    let total = 0;
    for (const row of grid) {
      for (const cell of row) {
        total += cell.count;
      }
    }
    return total;
  }, [grid]);

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  // Compact: show peak speed metric
  if (isCompact) {
    return (
      <WidgetShell loading={isLoading} error={error ? String(error) : null} updatedAt={dataUpdatedAt} isFetching={isFetching} isStale={isStale} isError={isError} onRefresh={() => refetch()}>
        <div className="h-full flex flex-col items-center justify-center gap-0.5">
          <span className="text-2xl font-bold text-[var(--text-primary)]">
            {maxSpeed > 0 ? fmtNumber(maxSpeed, 0) : '—'}
          </span>
          <span className="text-2xs text-[var(--text-muted)] uppercase tracking-wider">
            {t('widget.speedHeatmap.peak', 'Peak')} {unitPrefs.speed}
          </span>
        </div>
      </WidgetShell>
    );
  }

  const dayLabels = isWide ? DAY_LABELS_FULL : DAY_LABELS_SHORT;

  return (
    <WidgetShell
      title={t('widget.speedHeatmap.title', 'Speed Heatmap')}
      icon={<Grid3X3 aria-hidden="true" className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      error={error ? String(error) : null}
      noPadding
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {totalDrives > 0 ? (
        <div className="h-full w-full flex flex-col min-h-0 px-3 pb-2">
          {/* Summary */}
          <div className="flex items-center gap-3 pb-1 flex-shrink-0">
            <span className="text-xs text-[var(--text-secondary)]">
              {t('widget.speedHeatmap.drives', '{{count}} drives', { count: totalDrives })}
            </span>
            <span className="text-xs text-[var(--text-muted)]">·</span>
            <span className="text-xs text-[var(--text-secondary)]">
              {t('widget.speedHeatmap.peakSpeed', 'Peak avg {{speed}} {{unit}}', {
                speed: fmtNumber(maxSpeed, 0),
                unit: unitPrefs.speed,
              })}
            </span>
          </div>

          {/* SVG Heatmap */}
          <div className="flex-1 min-h-0">
            <HeatmapGrid
              grid={grid}
              maxSpeed={maxSpeed}
              dayLabels={dayLabels}
              isWide={isWide}
              speedUnit={unitPrefs.speed}
              t={t}
            />
          </div>

          {/* Legend */}
          <div className="flex items-center justify-between pt-1 flex-shrink-0">
            <span className="text-2xs text-[var(--text-muted)]">
              {t('widget.speedHeatmap.slow', 'Slow')}
            </span>
            <div className="flex gap-px">
              {[0, 0.25, 0.5, 0.75, 1].map((stop) => (
                <div
                  key={stop}
                  className="h-2 w-4 rounded-sm"
                  style={{ background: speedToColor(stop * (maxSpeed || 1), maxSpeed || 1) }}
                />
              ))}
            </div>
            <span className="text-2xs text-[var(--text-muted)]">
              {t('widget.speedHeatmap.fast', 'Fast')}
            </span>
          </div>
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Grid3X3 aria-hidden="true" className="h-5 w-5" />}
          message={t('widget.speedHeatmap.empty', 'No drive data yet')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}

/* ── SVG Heatmap Grid ── */

interface HeatmapGridProps {
  grid: HeatCell[][];
  maxSpeed: number;
  dayLabels: string[];
  isWide: boolean;
  speedUnit: string;
  t: (key: string, fallback: string) => string;
}

function HeatmapGrid({ grid, maxSpeed, dayLabels, isWide, speedUnit, t }: HeatmapGridProps) {
  const leftMargin = isWide ? 30 : 14;
  const topMargin = 14;
  const hourLabels = isWide
    ? [0, 3, 6, 9, 12, 15, 18, 21]
    : [0, 6, 12, 18];

  return (
    <svg
      viewBox={`0 0 ${leftMargin + COLS * 10 + 2} ${topMargin + ROWS * 12 + 2}`}
      className="w-full h-full"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={t('widget.speedHeatmap.gridLabel', 'Average speed by day of week and hour of day')}
    >
      {/* Hour labels along top */}
      {hourLabels.map((h) => (
        <text
          key={`h-${h}`}
          x={leftMargin + h * 10 + 5}
          y={topMargin - 3}
          textAnchor="middle"
          className="fill-white/30"
          fontSize={6}
        >
          {h}
        </text>
      ))}

      {/* Day labels along left */}
      {dayLabels.map((label, i) => (
        <text
          key={`d-${i}`}
          x={leftMargin - 2}
          y={topMargin + i * 12 + 8}
          textAnchor="end"
          className="fill-white/40"
          fontSize={6}
        >
          {label}
        </text>
      ))}

      {/* Cells */}
      {grid.map((row, day) =>
        row.map((cell) => (
          <rect
            key={`${day}-${cell.hour}`}
            x={leftMargin + cell.hour * 10}
            y={topMargin + day * 12}
            width={9}
            height={11}
            rx={1.5}
            fill={speedToColor(cell.avgSpeed, maxSpeed)}
          >
            <title>
              {dayLabels[day]} {cell.hour}:00 – {cell.count > 0
                ? `${fmtNumber(cell.avgSpeed, 0)} ${speedUnit} (${cell.count} ${t('widget.speedHeatmap.drivesSuffix', 'drives')})`
                : t('widget.speedHeatmap.noData', 'No data')}
            </title>
          </rect>
        )),
      )}
    </svg>
  );
}
