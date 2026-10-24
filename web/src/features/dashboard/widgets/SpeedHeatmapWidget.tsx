import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Grid3X3 } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { EmbeddedChart } from '@/components/charts';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { request } from '@/api/client';
import { useTimezone } from '@/lib/timezone';

import { convertSpeedFromSI, type SpeedUnitPref } from '@/lib/unitConversion';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber } from './shared';
import { safeArray } from '@/lib/safeArray';
import { useDataState } from '@/hooks/useDataState';
import type { WidgetProps } from './types';
import type { Drive } from '@/api/types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { zonedDateParts } from '@/lib/dateFormat';
import { formatHourName, formatWeekdayName } from '@/lib/dateConvert';

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
export function buildHeatmap(
  drives: Drive[],
  speedUnit: SpeedUnitPref,
  timezone?: string,
): HeatCell[][] {
  // Accumulator: [day][hour] → { total, count }
  const acc: { total: number; count: number }[][] = Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => ({ total: 0, count: 0 })),
  );

  for (const d of drives) {
    if (!d.start_ts) continue;
    const speed = d.avg_speed_mps;
    // `speed < 0` alone lets a NaN through (`NaN < 0` is false) which would
    // poison the cell average and produce a NaN colour later — require finite.
    if (speed == null || !Number.isFinite(speed) || speed < 0) continue;

    const dt = new Date(d.start_ts);
    // A malformed `start_ts` yields an Invalid Date whose getDay()/getHours()
    // are NaN; indexing acc[NaN][NaN] would throw and crash the whole widget.
    if (Number.isNaN(dt.getTime())) continue;

    let day: number;
    let hour: number;
    if (timezone) {
      const parts = zonedDateParts(dt, timezone);
      if (!parts) continue;
      day = parts.weekday === 0 ? 6 : parts.weekday - 1;
      hour = parts.hour;
    } else {
      // Local wall-clock fallback for direct helper callers/tests.
      const jsDay = dt.getDay();
      day = jsDay === 0 ? 6 : jsDay - 1;
      hour = dt.getHours();
    }

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

export function speedToColor(speed: number, maxSpeed: number): string {
  if (!Number.isFinite(speed) || !Number.isFinite(maxSpeed) || speed <= 0 || maxSpeed <= 0) {
    return 'rgba(255,255,255,0.03)';
  }
  const t = Math.max(0, Math.min(speed / maxSpeed, 1));
  const opacity = 0.06 + 0.94 * t;
  return `color-mix(in srgb, var(--accent) ${Math.round(opacity * 100)}%, var(--surface-2))`;
}


export default function SpeedHeatmapWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t, i18n } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { unitPrefs } = useUnits();
  const timezone = useTimezone('vehicle');

  const { data: drives, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['drives', id, 'speed-heatmap'],
    queryFn: () => request<Drive[]>(`/drives?vehicle_id=${id}`),
    enabled: id > 0,
    staleTime: 120_000,
  });

  const grid = useMemo(
    () => buildHeatmap(safeArray(drives), unitPrefs.speed, timezone),
    [drives, unitPrefs.speed, timezone],
  );
  const trust = useDataState({
    data: drives, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch,
  }, { provenance: 'historical' });

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
  const cellData = useMemo(() => grid.flatMap((row) => row.map((cell) => ({
    day: cell.day,
    hour: cell.hour,
    avgSpeed: cell.count > 0 ? cell.avgSpeed : null,
    count: cell.count,
  }))), [grid]);

  // Compact: show peak speed metric
  if (isCompact) {
    return (
      <WidgetShell title={t('widget.speedHeatmap.title', 'Speed heatmap')} dataState={trust.hasData ? trust : undefined} loading={isLoading} error={trust.fatalError?.message ?? null} updatedAt={dataUpdatedAt} isFetching={isFetching} isStale={isStale} isError={isError} onRefresh={() => refetch()}>
        <WidgetBigNumber
          value={totalDrives > 0 ? fmtNumber(maxSpeed) : null}
          unit={unitPrefs.speed}
          label={t('widget.speedHeatmap.peak', 'Peak')}
          align="center"
          animated={false}
        />
      </WidgetShell>
    );
  }

  const dayLabelsFull = Array.from({ length: 7 }, (_, day) =>
    formatWeekdayName(
      new Date(Date.UTC(2024, 0, 1 + day, 12)),
      { locale: i18n?.language ?? 'en-US', tz: timezone ?? 'UTC', weekdayStyle: 'short' },
    ),
  );
  const dayLabels = isWide
    ? dayLabelsFull
    : dayLabelsFull.map((label) => label.slice(0, 1));

  return (
    <WidgetShell
      title={t('widget.speedHeatmap.title', 'Speed heatmap')}
      icon={<Grid3X3 aria-hidden="true" className="h-3.5 w-3.5" />}
      loading={isLoading}
      dataState={trust.hasData ? trust : undefined}
      error={trust.fatalError?.message ?? null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {totalDrives > 0 ? (
        <div className="flex min-h-36 h-full flex-col">
          <EmbeddedChart
            title={t('widget.speedHeatmap.title', 'Speed heatmap')}
            ariaLabel={t('widget.speedHeatmap.gridLabel', 'Average speed by day of week and hour of day')}
            chartKey="dashboard-speed-heatmap"
            className="min-h-36 h-full"
            data={cellData}
            dataColumns={[
              { key: 'day', label: t('widget.speedHeatmap.day', 'Day'), format: (value) => dayLabelsFull[Number(value)] ?? '—' },
              { key: 'hour', label: t('widget.speedHeatmap.hour', 'Hour'), format: (value) => `${value}:00` },
              { key: 'avgSpeed', label: `${t('widget.speedHeatmap.averageSpeed', 'Average speed')} (${unitPrefs.speed})`, format: (value) => value == null ? '—' : fmtNumber(Number(value)) },
              { key: 'count', label: t('widget.speedHeatmap.driveCount', 'Drive count'), format: (value) => fmtInt(Number(value)) },
            ]}
          >
          <div className="flex-1 min-h-28">
            <HeatmapGrid
              grid={grid}
              maxSpeed={maxSpeed}
              dayLabels={dayLabels}
              isWide={isWide}
              speedUnit={unitPrefs.speed}
              t={t}
              locale={i18n?.language ?? 'en-US'}
            />
          </div>
          </EmbeddedChart>
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
  t: (key: string, fallback: string, options?: Record<string, unknown>) => string;
  locale: string;
}

function HeatmapGrid({ grid, maxSpeed, dayLabels, isWide, speedUnit, t, locale }: HeatmapGridProps) {
  const { fmtNumber } = useNumberFormatting();
  const leftMargin = isWide ? 30 : 14;
  const topMargin = 14;
  const hourLabel = (hour: number) => formatHourName(hour, {
    locale,
    showMinutes: true,
  });
  const hourLabels = isWide
    ? [
        { hour: 0, label: hourLabel(0) },
        { hour: 6, label: hourLabel(6) },
        { hour: 12, label: hourLabel(12) },
        { hour: 18, label: hourLabel(18) },
        { hour: 23, label: hourLabel(23) },
      ]
    : [
        { hour: 0, label: hourLabel(0) },
        { hour: 6, label: hourLabel(6) },
        { hour: 12, label: hourLabel(12) },
        { hour: 18, label: hourLabel(18) },
      ];

  return (
    <svg
      viewBox={`0 0 ${leftMargin + COLS * 10 + 2} ${topMargin + ROWS * 12 + 2}`}
      className="w-full h-full"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={t('widget.speedHeatmap.gridLabel', 'Average speed by day of week and hour of day')}
    >
      {/* Hour labels along top */}
      {hourLabels.map(({ hour, label }) => (
        <text
          key={`h-${hour}`}
          x={leftMargin + hour * 10 + 5}
          y={topMargin - 3}
          textAnchor="middle"
          className="fill-[var(--text-secondary)]"
          fontSize={6}
        >
          {label}
        </text>
      ))}

      {/* Day labels along left */}
      {dayLabels.map((label, i) => (
        <text
          key={`d-${i}`}
          x={leftMargin - 2}
          y={topMargin + i * 12 + 8}
          textAnchor="end"
          className="fill-[var(--text-secondary)]"
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
            fill={cell.count === 0 ? 'var(--surface-2)' : speedToColor(cell.avgSpeed || Number.EPSILON, maxSpeed || 1)}
          >
            <title>
              {dayLabels[day]} {cell.hour}:00 – {cell.count > 0
                ? `${fmtNumber(cell.avgSpeed)} ${speedUnit} (${t(
                    cell.count === 1 ? 'widget.speedHeatmap.drive_one' : 'widget.speedHeatmap.drive_other',
                    cell.count === 1 ? '{{count}} drive' : '{{count}} drives',
                    { count: cell.count },
                  )})`
                : t('widget.speedHeatmap.noData', 'No data')}
            </title>
          </rect>
        )),
      )}
    </svg>
  );
}
