import { ReferenceLine } from 'recharts';
import { severityTokens, normalizeSeverity, type Severity } from '@/lib/tokens';

/**
 * TimeMarker — vertical reference line on a time-series chart marking the
 * timestamp of an alert (or any other point-in-time event).
 *
 * Used by pages that opt in to alert drill-through (`useAlertContext()`):
 * when the user clicks an alert and lands on
 * `/battery?t=...` the matching chart shows a vertical marker at that time.
 *
 * Since recharts renders `ReferenceLine` based on the chart's `dataKey`
 * (which is often a pre-formatted string label, not an ISO timestamp), the
 * caller is responsible for converting the alert timestamp to whatever
 * x-coordinate value the chart uses. Pass the resulting value as `x`.
 *
 * Important: recharts requires `ReferenceLine` to be a direct child of the
 * chart component (LineChart/AreaChart/ComposedChart/...) — passing other
 * components in between breaks chart layout. This wrapper just spreads the
 * underlying ReferenceLine props with sensible defaults.
 */
export interface TimeMarkerProps {
  /** Value matching the chart's x-axis dataKey for the alert moment.
   *  When `null` / `undefined` the marker is not rendered. */
  x: string | number | null | undefined;
  /** Severity of the underlying alert. Drives the marker color. Defaults to "warn". */
  severity?: Severity | string | null;
  /** Optional label rendered next to the marker. Defaults to "Alert". */
  label?: string;
  /** Override the dash pattern; default is solid. */
  strokeDasharray?: string;
  /** Override the stroke width; default 2. */
  strokeWidth?: number;
  /** Recharts ifOverflow behavior. Defaults to "extendDomain" so the marker
   *  is still visible when the alert timestamp falls slightly outside the
   *  current chart window. */
  ifOverflow?: 'discard' | 'hidden' | 'visible' | 'extendDomain';
  /** Recharts yAxisId for charts that have multiple Y axes. */
  yAxisId?: string | number;
}

const SEVERITY_STROKE: Record<Severity, string> = {
  info: '#0ea5e9',
  warn: '#f59e0b',
  critical: '#ef4444',
  success: '#10b981',
};

export function TimeMarker({
  x,
  severity,
  label = 'Alert',
  strokeDasharray,
  strokeWidth = 2,
  ifOverflow = 'extendDomain',
  yAxisId,
}: TimeMarkerProps) {
  // A null/undefined/empty `x` means "no alert moment to mark". A non-finite
  // numeric `x` has no valid chart coordinate either — a failed
  // `Number(timestamp)` parse yields NaN and a bad domain calc yields
  // ±Infinity; both would position the ReferenceLine at an undefined spot, so
  // render nothing rather than hand recharts a broken coordinate.
  if (x == null || x === '' || (typeof x === 'number' && !Number.isFinite(x))) {
    return null;
  }
  const sev = normalizeSeverity(severity ?? 'warn');
  const stroke = SEVERITY_STROKE[sev] ?? SEVERITY_STROKE.warn;
  return (
    <ReferenceLine
      x={x}
      yAxisId={yAxisId}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeDasharray={strokeDasharray}
      ifOverflow={ifOverflow}
      label={{
        value: label,
        position: 'top',
        fill: stroke,
        fontSize: 10,
      }}
    />
  );
}

// Re-export severityTokens to make it easier for charts to color-coordinate
// other elements (e.g. background tints) with the marker.
export { severityTokens };
