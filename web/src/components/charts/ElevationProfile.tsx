import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { ChartContainer } from './ChartContainer';
import { fmt } from './chartUtils';
import { EmptyState } from '@/components/feedback';
import { chartTokens } from '@/lib/tokens';
import { cn } from '@/lib/cn';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ElevationDataPoint {
  index: number;
  distance: number;
  elevation: number;
  speed?: number;
}

interface ElevationProfileProps {
  data: ElevationDataPoint[];
  currentIndex?: number;
  onClickIndex?: (index: number) => void;
  height?: number;
  distanceUnit?: string;
  className?: string;
}

/* ------------------------------------------------------------------ */
/*  Visual constants (unchanged from the recharts original)           */
/* ------------------------------------------------------------------ */

/** Emerald area/line — matches the original `stroke="#10b981"` + gradient. */
const ELEV_COLOR = '#10b981';
/** Cyan playback-position marker — matches the original `<ReferenceLine>`. */
const CURSOR_COLOR = '#00b4d8';

/** Resolve a `var(--token)` expression to a concrete colour for canvas drawing,
 *  falling back when the variable is unset or we're rendering server-side. */
function resolveCssColor(varExpr: string, fallback: string): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return fallback;
  const name = varExpr.replace(/^var\(/, '').replace(/\)$/, '').trim();
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** `#rrggbb` / `#rgb` → `rgba()` with the given alpha, mirroring `areaGradient`. */
function withAlpha(color: string, alpha: number): string {
  if (!color.startsWith('#')) return color;
  let h = color.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6) return color;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/* ------------------------------------------------------------------ */
/*  Canvas engine (uPlot)                                             */
/*                                                                    */
/*  Canvas rendering is why uPlot is the correct engine here: the     */
/*  trip/drive replay drives `currentIndex` at telemetry frequency,   */
/*  and a canvas repaint (`redraw`) is far cheaper than reconciling a  */
/*  recharts SVG tree on every tick. The uPlot instance is built once  */
/*  and only rebuilt on a theme change; data pushes go through         */
/*  `setData` and the moving marker through `redraw` — never a rebuild.*/
/* ------------------------------------------------------------------ */

interface ElevationChartProps {
  data: ElevationDataPoint[];
  currentIndex?: number;
  onClickIndex?: (index: number) => void;
  distanceUnit: string;
  seriesLabel: string;
  emptyMessage: string;
}

function ElevationChart({
  data,
  currentIndex,
  onClickIndex,
  distanceUnit,
  seriesLabel,
  emptyMessage,
}: ElevationChartProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const uRef = useRef<uPlot | null>(null);

  const rows = data ?? [];

  // Latest props reachable from the (rarely rebuilt) uPlot instance and its
  // native listeners, so a live tick never forces a React-driven rebuild.
  const rowsRef = useRef<ElevationDataPoint[]>(rows);
  rowsRef.current = rows;
  const onClickIndexRef = useRef<((index: number) => void) | undefined>(onClickIndex);
  onClickIndexRef.current = onClickIndex;
  const currentIndexRef = useRef<number | undefined>(currentIndex);
  currentIndexRef.current = currentIndex;

  // x = uniform sample index (matching the original recharts category axis);
  // y = elevation in metres. Distance is surfaced as the x tick + tooltip
  // header, read from `rowsRef`, so a unit change refreshes labels via setData.
  const model = useMemo<uPlot.AlignedData>(() => {
    const xs = rows.map((_row, i) => i);
    const ys = rows.map((r) => (typeof r?.elevation === 'number' && Number.isFinite(r.elevation) ? r.elevation : null));
    return [xs, ys] as uPlot.AlignedData;
  }, [rows]);
  const dataRef = useRef<uPlot.AlignedData>(model);
  dataRef.current = model;

  // React tooltip state — updated on hover / tap only, never on a data tick.
  const [cursor, setCursor] = useState<{ idx: number; left: number } | null>(null);

  // Canvas colours are baked from CSS variables at build time, so a light/dark
  // toggle needs a rebuild to re-read them. Bump a tick on <html> mutations.
  const [themeTick, setThemeTick] = useState(0);
  useEffect(() => {
    if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
    const obs = new MutationObserver(() => setThemeTick((n) => n + 1));
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'style'],
    });
    return () => obs.disconnect();
  }, []);

  // ── create / rebuild uPlot ──
  // Loaded on demand so it stays out of the main bundle and so importing this
  // component in a non-DOM/test environment never triggers uPlot's
  // module-level pixel-ratio setup (which needs `matchMedia`).
  useEffect(() => {
    if (!hostRef.current) return;
    let instance: uPlot | null = null;
    let cancelled = false;

    void import('uplot').then(({ default: UPlot }) => {
      const host = hostRef.current;
      if (cancelled || !host) return;
      // Canvas drawing needs Path2D; degrade gracefully where it is
      // unavailable (SSR / legacy / jsdom) instead of throwing during draw.
      if (typeof Path2D === 'undefined') return;

      const rect = host.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width || 1));
      const heightPx = Math.max(1, Math.round(rect.height || 1));

      const axisColor = resolveCssColor(chartTokens.axisStroke, '#94a3b8');
      const gridColor = resolveCssColor(chartTokens.gridStroke, 'rgba(148,163,184,0.2)');
      const axisFont = '11px ui-sans-serif, system-ui, -apple-system, sans-serif';

      const distanceAt = (i: number): number => {
        const rws = rowsRef.current;
        if (rws.length === 0) return i;
        const row = rws[Math.max(0, Math.min(rws.length - 1, Math.round(i)))];
        return row ? row.distance : i;
      };

      const elevSeries: uPlot.Series = {
        label: seriesLabel,
        stroke: ELEV_COLOR,
        width: 2,
        spanGaps: true,
        points: { show: false },
        paths: UPlot.paths.spline?.(),
        fill: (u: uPlot) => {
          const grad = u.ctx.createLinearGradient(0, u.bbox.top, 0, u.bbox.top + u.bbox.height);
          grad.addColorStop(0, withAlpha(ELEV_COLOR, 0.4));
          grad.addColorStop(0.95, withAlpha(ELEV_COLOR, 0.02));
          return grad;
        },
      };

      const opts: uPlot.Options = {
        width,
        height: heightPx,
        scales: { x: { time: false } },
        legend: { show: false },
        cursor: {
          x: true,
          y: false,
          points: { size: 6 },
          drag: { x: false, y: false },
        },
        axes: [
          {
            stroke: axisColor,
            font: axisFont,
            grid: { show: true, stroke: gridColor, width: 1, dash: [3, 3] },
            ticks: { show: true, stroke: gridColor, width: 1, size: 4 },
            values: (_u: uPlot, splits: number[]) => splits.map((s) => fmt(distanceAt(s), 1)),
          },
          {
            stroke: axisColor,
            font: axisFont,
            size: 48,
            grid: { show: true, stroke: gridColor, width: 1, dash: [3, 3] },
            ticks: { show: false },
            values: (_u: uPlot, splits: number[]) => splits.map((v) => fmt(v, 0)),
          },
        ],
        series: [{}, elevSeries],
        padding: [8, 8, 0, 0],
        hooks: {
          setCursor: [
            (u) => {
              const idx = u.cursor.idx ?? null;
              if (idx == null) {
                setCursor(null);
                return;
              }
              const xval = (u.data[0] as ArrayLike<number>)[idx];
              if (xval == null) {
                setCursor(null);
                return;
              }
              const dpr = window.devicePixelRatio || 1;
              setCursor({ idx, left: u.bbox.left / dpr + u.valToPos(xval, 'x') });
            },
          ],
          draw: [
            (u) => {
              // Vertical dashed playback marker at `currentIndex` — the uPlot
              // equivalent of the original `<ReferenceLine>`. Drawn in device
              // pixels (valToPos(..,true) / bbox), so widths are dpr-scaled.
              const idx = currentIndexRef.current;
              if (idx == null || idx < 0 || idx >= rowsRef.current.length) return;
              const dpr = window.devicePixelRatio || 1;
              const x = u.valToPos(idx, 'x', true);
              const { top, height: h } = u.bbox;
              const ctx = u.ctx;
              ctx.save();
              ctx.beginPath();
              ctx.strokeStyle = CURSOR_COLOR;
              ctx.lineWidth = 2 * dpr;
              ctx.setLineDash([4 * dpr, 2 * dpr]);
              ctx.moveTo(x, top);
              ctx.lineTo(x, top + h);
              ctx.stroke();
              ctx.restore();
            },
          ],
        },
      };

      try {
        instance = new UPlot(opts, dataRef.current, host);
      } catch {
        // Canvas / Path2D drawing unsupported here — degrade to the a11y
        // envelope instead of surfacing an unhandled rejection.
        return;
      }
      uRef.current = instance;
    });

    return () => {
      cancelled = true;
      instance?.destroy();
      if (uRef.current === instance) uRef.current = null;
    };
    // Rebuild only on theme change; data / size / marker / visibility are
    // handled by the dedicated effects below so live ticks never tear down
    // the canvas.
  }, [themeTick, seriesLabel]);

  // ── push new data without rebuilding (the live-tick hot path) ──
  // `setData` always redraws, which also refreshes the distance-derived x tick
  // labels after a unit change even when the index/elevation arrays are equal.
  useEffect(() => {
    uRef.current?.setData(model);
  }, [model]);

  // ── move the playback marker with a cheap canvas repaint (no rebuild) ──
  useEffect(() => {
    uRef.current?.redraw();
  }, [currentIndex]);

  // ── responsive: observe the host and resize imperatively (no React churn) ──
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      const width = Math.max(1, Math.round(cr.width));
      const h = Math.max(1, Math.round(cr.height));
      const u = uRef.current;
      if (u && (u.width !== width || u.height !== h)) u.setSize({ width, height: h });
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  // ── touch + click ──
  // Touch maps a tap / drag onto uPlot's cursor so the tooltip activates on
  // phones (uPlot's built-in cursor is pointer-driven). Click selects the
  // hovered sample, mirroring the original `onClick` → `activeTooltipIndex`.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onTouch = (e: TouchEvent) => {
      const u = uRef.current;
      const touch = e.touches[0];
      if (!u || !touch) return;
      const r = u.rect;
      u.setCursor({ left: touch.clientX - r.left, top: touch.clientY - r.top });
    };
    const onClick = () => {
      const u = uRef.current;
      const cb = onClickIndexRef.current;
      if (!u || !cb) return;
      const idx = u.cursor.idx ?? null;
      const rws = rowsRef.current;
      if (idx != null && idx >= 0 && idx < rws.length) cb(rws[idx].index);
    };
    host.addEventListener('touchstart', onTouch, { passive: true });
    host.addEventListener('touchmove', onTouch, { passive: true });
    host.addEventListener('click', onClick);
    return () => {
      host.removeEventListener('touchstart', onTouch);
      host.removeEventListener('touchmove', onTouch);
      host.removeEventListener('click', onClick);
    };
  }, []);

  if (rows.length === 0) {
    return (
      <EmptyState /* no-action: chart cannot meaningfully recover without data — show prose only */
        message={emptyMessage}
      />
    );
  }

  const activeIdx = cursor?.idx ?? null;
  const activeRow = activeIdx != null ? rows[activeIdx] : undefined;

  return (
    <div className={cn('flex h-full w-full flex-col', onClickIndex && 'cursor-pointer')}>
      <div ref={hostRef} className="relative min-h-0 w-full flex-1">
        {/* Y-axis unit (metres) — vertical, left edge. Mirrors the recharts
            `label={{ value: 'm', angle: -90, position: 'insideLeft' }}`. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 -rotate-90 text-[10px] text-[var(--text-muted)]"
        >
          m
        </span>
        {/* X-axis unit (distance) — bottom-right, matching the recharts
            `label={{ value: distanceUnit, position: 'insideBottomRight' }}`. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 right-1 text-[10px] text-[var(--text-muted)]"
        >
          {distanceUnit}
        </span>
        {activeRow && activeIdx != null && (
          <div
            role="tooltip"
            aria-live="polite"
            className="pointer-events-none absolute top-1 z-10 max-w-[80%] -translate-x-1/2 rounded-xl border px-3 py-2 text-xs shadow-xl backdrop-blur-xl bg-[var(--surface-elevated)] border-[var(--border-subtle)]"
            style={{ left: `${cursor?.left ?? 0}px`, boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}
          >
            <p className="mb-1 font-medium text-[var(--text-secondary)]">
              {`${fmt(activeRow.distance, 2)} ${distanceUnit}`}
            </p>
            <div className="flex items-center gap-2 py-0.5">
              <span
                aria-hidden="true"
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: ELEV_COLOR, boxShadow: `0 0 6px ${withAlpha(ELEV_COLOR, 0.4)}` }}
              />
              <span className="text-[var(--text-secondary)]">{seriesLabel}:</span>
              <span className="font-mono font-semibold text-[var(--text-primary)]">
                {`${fmt(activeRow.elevation, 0)} m`}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ElevationProfile({
  data,
  currentIndex,
  onClickIndex,
  height = 200,
  distanceUnit = 'km',
  className,
}: ElevationProfileProps) {
  const { t } = useTranslation();

  const rows = data ?? [];

  const elevGain = useMemo(() => {
    let gain = 0;
    let loss = 0;
    for (let i = 1; i < rows.length; i++) {
      const diff = (rows[i]?.elevation ?? 0) - (rows[i - 1]?.elevation ?? 0);
      if (diff > 0) gain += diff;
      else loss += Math.abs(diff);
    }
    return { gain: Math.round(gain), loss: Math.round(loss) };
  }, [rows]);

  const noDataMessage = t('replay.elevation.noData', 'No elevation data available');

  if (rows.length === 0) {
    return (
      // chart-a11y:no-table empty state — there is no series to tabulate yet
      <ChartContainer
        title={t('replay.elevation.title', 'Elevation Profile')}
        ariaLabel={t('replay.elevation.aria', 'Elevation profile chart — no data available yet')}
        height={height}
        className={className}
      >
        <EmptyState /* no-action: chart cannot meaningfully recover without data — show prose only */
          message={noDataMessage}
        />
      </ChartContainer>
    );
  }

  return (
    // chart-a11y:no-table dense per-sample elevation series along the route — would be unusable as a table for SR users
    <ChartContainer
      title={t('replay.elevation.title', 'Elevation Profile')}
      subtitle={`↑ ${elevGain.gain}m  ↓ ${elevGain.loss}m`}
      ariaLabel={t('replay.elevation.aria', 'Elevation profile chart along the route, with total gain and loss in meters')}
      height={height}
      className={className}
    >
      <ElevationChart
        data={rows}
        currentIndex={currentIndex}
        onClickIndex={onClickIndex}
        distanceUnit={distanceUnit}
        seriesLabel={t('replay.elevation.label', 'Elevation')}
        emptyMessage={noDataMessage}
      />
    </ChartContainer>
  );
}
