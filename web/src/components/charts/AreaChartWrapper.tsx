import { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { cn } from '@/lib/cn';

interface SeriesConfig {
  key: string;
  label: string;
  color: string;
}

interface AreaChartWrapperProps {
  data: Record<string, unknown>[];
  xKey: string;
  series: SeriesConfig[];
  height?: number;
  xFormatter?: (value: string) => string;
  yFormatter?: (value: number) => string;
  className?: string;
}

/** Minimal structural view of a latest-value ref, so the tooltip helper stays
 *  decoupled from React's evolving `MutableRefObject` / `RefObject` typings. */
type Latest<T> = { current: T };

const AXIS_FONT = '11px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/**
 * Parse `#rgb` / `#rrggbb` into an `rgba()` string at the requested alpha.
 * Non-hex inputs fall back to the raw color (alpha > 0) or `transparent`
 * (alpha <= 0) so a canvas gradient stop is never handed an invalid value.
 */
function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return alpha <= 0 ? 'transparent' : color;
  const hex = m[1];
  const expand = hex.length === 3 ? hex.replace(/(.)/g, '$1$1') : hex;
  const r = parseInt(expand.slice(0, 2), 16);
  const g = parseInt(expand.slice(2, 4), 16);
  const b = parseInt(expand.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Read a themeable CSS custom property off a live element. Used as the source
 * for canvas axis/grid strokes so they track light/dark mode automatically on
 * every redraw — canvas can't reference `var(--…)` directly. Cheap: only runs
 * on axis/grid draws, never on the per-telemetry-tick `setData` fast path.
 */
function readVar(el: HTMLElement | null, name: string, fallback: string): string {
  if (!el) return fallback;
  const value = getComputedStyle(el).getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * uPlot plugin rendering the hover tooltip as a DOM overlay (canvas itself can
 * draw no HTML). Reproduces the app's shared tooltip look — a theme-aware
 * frosted panel with a header label plus one `● name: value` row per series —
 * and wires touch so a tap/scrub activates it on mobile, not just hover.
 */
function createTooltipPlugin(refs: {
  getCursorColor: () => string;
  series: Latest<SeriesConfig[]>;
  xLabels: Latest<unknown[]>;
  xFormatter: Latest<((value: string) => string) | undefined>;
  yFormatter: Latest<((value: number) => string) | undefined>;
}): uPlot.Plugin {
  let el: HTMLDivElement | null = null;
  let headerEl: HTMLDivElement | null = null;
  let rowsEl: HTMLDivElement | null = null;
  let overEl: HTMLDivElement | null = null;
  let onTouch: ((event: TouchEvent) => void) | null = null;
  let onTouchEnd: (() => void) | null = null;

  const hide = () => {
    if (el) el.style.display = 'none';
  };

  return {
    hooks: {
      init: (u) => {
        overEl = u.over;

        el = document.createElement('div');
        el.setAttribute('role', 'tooltip');
        el.setAttribute('aria-live', 'polite');
        el.className =
          'rounded-xl border px-4 py-3 text-xs shadow-xl backdrop-blur-xl ' +
          'bg-[var(--surface-elevated)] border-[var(--border-subtle)]';
        el.style.position = 'absolute';
        el.style.zIndex = '20';
        el.style.pointerEvents = 'none';
        el.style.whiteSpace = 'nowrap';
        el.style.display = 'none';
        el.style.boxShadow = '0 8px 32px rgba(0,0,0,0.3)';

        headerEl = document.createElement('div');
        headerEl.className = 'mb-1.5 font-medium text-[var(--text-secondary)]';
        rowsEl = document.createElement('div');

        el.appendChild(headerEl);
        el.appendChild(rowsEl);
        u.over.appendChild(el);

        // Recolor the default cursor crosshair to a theme-aware muted dash.
        const xLine = u.over.querySelector('.u-cursor-x');
        if (xLine instanceof HTMLElement) {
          xLine.style.borderRight = `1px dashed ${refs.getCursorColor()}`;
        }

        // uPlot 1.6 only binds mouse events; browsers synthesize a single
        // mouse event per tap but not during a touch-drag. Bind touch so a
        // tap AND a scrub both drive the cursor on mobile. Passive so vertical
        // page scrolling over the chart is never hijacked. touchend/touchcancel
        // reset the cursor so the tooltip dismisses on finger-lift (touch never
        // triggers uPlot's mouseleave), giving a clear dismissal affordance.
        onTouch = (event: TouchEvent) => {
          const touch = event.touches[0] ?? event.changedTouches[0];
          if (!touch) return;
          const rect = u.over.getBoundingClientRect();
          u.setCursor({ left: touch.clientX - rect.left, top: touch.clientY - rect.top });
        };
        onTouchEnd = () => u.setCursor({ left: -10, top: -10 });
        u.over.addEventListener('touchstart', onTouch, { passive: true });
        u.over.addEventListener('touchmove', onTouch, { passive: true });
        u.over.addEventListener('touchend', onTouchEnd, { passive: true });
        u.over.addEventListener('touchcancel', onTouchEnd, { passive: true });
      },

      setCursor: (u) => {
        if (!el || !headerEl || !rowsEl) return;

        const idx = u.cursor.idx;
        const left = u.cursor.left ?? -10;
        const top = u.cursor.top ?? -10;
        if (idx == null || left < 0 || top < 0) {
          hide();
          return;
        }

        const seriesList = refs.series.current;
        const labels = refs.xLabels.current;
        const xFmt = refs.xFormatter.current;
        const yFmt = refs.yFormatter.current;

        const rawLabel = labels[idx];
        const labelStr = rawLabel == null ? '' : String(rawLabel);
        headerEl.textContent = xFmt ? xFmt(labelStr) : labelStr;

        rowsEl.replaceChildren();
        for (let s = 0; s < seriesList.length; s++) {
          const cfg = seriesList[s];
          if (!cfg) continue;
          const column = u.data[s + 1];
          const raw = column ? column[idx] : null;
          const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;

          const row = document.createElement('div');
          row.className = 'flex items-center gap-2 py-0.5';

          const dot = document.createElement('span');
          dot.setAttribute('aria-hidden', 'true');
          dot.className = 'inline-block h-2.5 w-2.5 rounded-full';
          dot.style.backgroundColor = cfg.color;
          dot.style.boxShadow = `0 0 6px ${withAlpha(cfg.color, 0.375)}`;

          const name = document.createElement('span');
          name.className = 'text-[var(--text-secondary)]';
          // Fall back to the series key (not a dash) when a label is absent,
          // preserving the original tooltip's `label ?? key` series identity.
          name.textContent = `${cfg.label || cfg.key}:`;

          const val = document.createElement('span');
          val.className = 'font-mono font-semibold text-[var(--text-primary)]';
          if (value == null) val.textContent = '—';
          else val.textContent = yFmt ? yFmt(value) : String(value);

          row.appendChild(dot);
          row.appendChild(name);
          row.appendChild(val);
          rowsEl.appendChild(row);
        }

        el.style.display = 'block';
        const overW = u.over.clientWidth;
        const overH = u.over.clientHeight;
        const tw = el.offsetWidth;
        const th = el.offsetHeight;
        let x = left - tw / 2;
        x = Math.max(4, Math.min(x, overW - tw - 4));
        let y = top - th - 12;
        if (y < 4) y = top + 12;
        y = Math.max(4, Math.min(y, overH - th - 4));
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
      },

      destroy: () => {
        if (overEl && onTouch) {
          overEl.removeEventListener('touchstart', onTouch);
          overEl.removeEventListener('touchmove', onTouch);
        }
        if (overEl && onTouchEnd) {
          overEl.removeEventListener('touchend', onTouchEnd);
          overEl.removeEventListener('touchcancel', onTouchEnd);
        }
        el?.remove();
        el = null;
        headerEl = null;
        rowsEl = null;
        overEl = null;
        onTouch = null;
        onTouchEnd = null;
      },
    },
  };
}

/**
 * Area / line chart wrapper — the most-used chart in the app. Rendered with
 * uPlot (canvas) rather than an SVG chart lib because it backs high-frequency
 * live SSE telemetry: new data is pushed via `setData` on every tick, so the
 * chart never re-mounts or reconciles a DOM tree per update. The external prop
 * API is unchanged so all existing call-sites keep working untouched.
 *
 * Category-style x-axis (evenly spaced by index, formatted through
 * `xFormatter`) mirrors Recharts' default categorical axis; the y-axis fills to
 * the plot floor with the same 0.3 → 0 vertical gradient the SVG version used.
 * Grid, axis, and tooltip colors resolve from theme CSS variables so light mode
 * keeps working. Fully responsive: a ResizeObserver drives `setSize`, and the
 * tooltip activates on tap/scrub for touch devices.
 */
export const AreaChartWrapper = forwardRef<HTMLDivElement, AreaChartWrapperProps>(
  function AreaChartWrapper(
    { data, xKey, series, height = 300, xFormatter, yFormatter, className },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const plotRef = useRef<HTMLDivElement | null>(null);
    const uplotRef = useRef<uPlot | null>(null);

    const [width, setWidth] = useState(0);

    // Latest-value refs read by imperative uPlot callbacks. Kept current every
    // render so formatter/label changes never force a chart rebuild.
    const seriesRef = useRef<SeriesConfig[]>(series ?? []);
    const xLabelsRef = useRef<unknown[]>([]);
    const xFmtRef = useRef<typeof xFormatter>(xFormatter);
    const yFmtRef = useRef<typeof yFormatter>(yFormatter);
    const widthRef = useRef(0);
    const heightRef = useRef(height);

    // Cache of theme-resolved canvas colors. Populated by refreshColors() at
    // (re)build time and on theme toggles, then read cheaply by uPlot's axis /
    // grid stroke callbacks — never re-resolved on the per-tick draw path.
    const colorsRef = useRef({
      axis: '#8a95a6',
      grid: 'rgba(255,255,255,0.06)',
      cursor: '#8a95a6',
    });
    const refreshColors = useCallback(() => {
      const el = containerRef.current;
      colorsRef.current = {
        axis: readVar(el, '--text-muted', '#8a95a6'),
        grid: readVar(el, '--border-subtle', 'rgba(255,255,255,0.06)'),
        cursor: readVar(el, '--text-muted', '#8a95a6'),
      };
    }, []);

    const xLabels = useMemo(
      () => (data ?? []).map((row) => (row == null ? undefined : row[xKey])),
      [data, xKey],
    );

    const uData = useMemo<uPlot.AlignedData>(() => {
      const rows = data ?? [];
      const xs = rows.map((_row, i) => i);
      const ys = (series ?? []).map((s) =>
        rows.map((row) => {
          const v = row?.[s.key];
          return typeof v === 'number' && Number.isFinite(v) ? v : null;
        }),
      );
      return [xs, ...ys];
    }, [data, series]);
    const uDataRef = useRef(uData);

    // Rebuild the uPlot instance only when structure (series keys/colors)
    // changes — never on data, size, or formatter changes.
    const seriesSig = useMemo(
      () => JSON.stringify((series ?? []).map((s) => [s.key, s.color])),
      [series],
    );

    // Assign latest-value refs during render (safe: not read for this render's
    // output). uPlot callbacks always see current props via these.
    seriesRef.current = series ?? [];
    xLabelsRef.current = xLabels;
    xFmtRef.current = xFormatter;
    yFmtRef.current = yFormatter;
    uDataRef.current = uData;
    widthRef.current = width;
    heightRef.current = height;

    const setContainer = useCallback(
      (node: HTMLDivElement | null) => {
        containerRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) (ref as { current: HTMLDivElement | null }).current = node;
      },
      [ref],
    );

    // Measure the container and keep uPlot sized to it (responsive down to
    // mobile widths). Observing the outer box — not uPlot's own canvas —
    // avoids a resize feedback loop.
    useLayoutEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const measure = (w: number) => {
        const next = Math.max(0, Math.floor(w));
        widthRef.current = next;
        setWidth((prev) => (prev === next ? prev : next));
      };
      const ro = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry) measure(entry.contentRect.width);
      });
      ro.observe(el);
      measure(el.getBoundingClientRect().width);
      return () => ro.disconnect();
    }, []);

    // Create / destroy the uPlot instance. Recreated on structural changes
    // (seriesSig) or when width first becomes positive.
    const hasWidth = width > 0;
    useLayoutEffect(() => {
      const mount = plotRef.current;
      if (!mount || !hasWidth) return;

      const currentSeries = seriesRef.current;
      // `uPlot.paths.spline` is the Fritsch-Carlson monotone cubic builder
      // (uPlot source: `paths.spline = monotoneCubic`) — the same monotonicity-
      // preserving interpolation as Recharts `type="monotone"`, so the line and
      // fill never overshoot below data minima. Public, non-deprecated API.
      const spline = uPlot.paths.spline;
      const pathBuilder = spline ? spline() : undefined;

      // Resolve theme colors once per (re)build; the stroke callbacks below read
      // this cache, so uPlot's per-redraw axis/grid drawing (which fires on
      // every live `setData`) never calls getComputedStyle on the hot path.
      refreshColors();
      const gridStroke = () => colorsRef.current.grid;
      const axisStroke = () => colorsRef.current.axis;

      const uSeries: uPlot.Series[] = [
        {},
        ...currentSeries.map((s): uPlot.Series => ({
          label: s.label,
          scale: 'y',
          stroke: s.color,
          width: 2,
          spanGaps: false,
          points: { show: false },
          paths: pathBuilder,
          fill: (self: uPlot) => {
            const { top, height: bboxH } = self.bbox;
            const grad = self.ctx.createLinearGradient(0, top, 0, top + bboxH);
            grad.addColorStop(0, withAlpha(s.color, 0.3));
            grad.addColorStop(1, withAlpha(s.color, 0));
            return grad;
          },
        })),
      ];

      const options: uPlot.Options = {
        width: widthRef.current || 1,
        height: heightRef.current,
        padding: [8, 10, 0, 0],
        legend: { show: false },
        cursor: {
          x: true,
          y: false,
          points: { show: true },
          drag: { x: false, y: false, setScale: false },
        },
        scales: { x: { time: false } },
        series: uSeries,
        axes: [
          {
            scale: 'x',
            stroke: axisStroke,
            font: AXIS_FONT,
            gap: 6,
            size: 30,
            ticks: { show: false },
            border: { show: false },
            grid: { show: true, stroke: gridStroke, width: 1, dash: [3, 3] },
            splits: (self, _axisIdx, scaleMin, scaleMax) => {
              const n = xLabelsRef.current.length;
              if (n === 0) return [];
              const lo = Math.max(0, Math.ceil(scaleMin));
              const hi = Math.min(n - 1, Math.floor(scaleMax));
              if (hi < lo) return [];
              const span = hi - lo + 1;
              const maxTicks = Math.max(2, Math.floor(self.width / 72));
              const step = Math.max(1, Math.ceil(span / maxTicks));
              const out: number[] = [];
              for (let i = lo; i <= hi; i += step) out.push(i);
              return out;
            },
            values: (_self, splits) =>
              splits.map((v) => {
                const raw = xLabelsRef.current[v];
                const str = raw == null ? '' : String(raw);
                const fmt = xFmtRef.current;
                return fmt ? fmt(str) : str;
              }),
          },
          {
            scale: 'y',
            stroke: axisStroke,
            font: AXIS_FONT,
            gap: 6,
            ticks: { show: false },
            border: { show: false },
            grid: { show: true, stroke: gridStroke, width: 1, dash: [3, 3] },
            values: (_self, splits) =>
              splits.map((v) => {
                const fmt = yFmtRef.current;
                return fmt ? fmt(v) : uPlot.fmtNum(v);
              }),
          },
        ],
        plugins: [
          createTooltipPlugin({
            getCursorColor: () => colorsRef.current.cursor,
            series: seriesRef,
            xLabels: xLabelsRef,
            xFormatter: xFmtRef,
            yFormatter: yFmtRef,
          }),
        ],
      };

      const instance = new uPlot(options, uDataRef.current, mount);
      uplotRef.current = instance;
      return () => {
        instance.destroy();
        uplotRef.current = null;
      };
    }, [hasWidth, seriesSig]);

    // Push new data without re-creating the chart — the live-telemetry fast
    // path. `setData` recomputes scales and redraws in place.
    useEffect(() => {
      uplotRef.current?.setData(uData);
    }, [uData]);

    // Track container size / height changes.
    useLayoutEffect(() => {
      const instance = uplotRef.current;
      if (instance && width > 0) instance.setSize({ width, height });
    }, [width, height]);

    // Re-resolve theme colors when the app theme toggles (a class/attribute on
    // <html>) and repaint, so canvas axes/grid/cursor stay theme-aware without
    // polling getComputedStyle on every redraw.
    useEffect(() => {
      const observer = new MutationObserver(() => {
        refreshColors();
        const instance = uplotRef.current;
        if (!instance) return;
        const xLine = instance.over.querySelector('.u-cursor-x');
        if (xLine instanceof HTMLElement) {
          xLine.style.borderRight = `1px dashed ${colorsRef.current.cursor}`;
        }
        instance.redraw();
      });
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'data-theme', 'style'],
      });
      return () => observer.disconnect();
    }, [refreshColors]);

    const ariaLabel = (series ?? [])
      .map((s) => s?.label)
      .filter((label): label is string => Boolean(label))
      .join(', ');

    return (
      <div
        ref={setContainer}
        className={cn('w-full', className)}
        role={ariaLabel ? 'img' : undefined}
        aria-label={ariaLabel || undefined}
      >
        <div ref={plotRef} className="w-full" style={{ height }} />
      </div>
    );
  },
);
