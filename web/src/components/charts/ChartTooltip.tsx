import { memo, useId, type ReactNode } from 'react'
import { Circle } from '@visx/shape'
import { fmtNumber } from '../../lib/numberFormat'
import { formatDateTime } from '../../lib/dateFormat'
// Canonical series palette. We pull `CHART_COLORS` from `lib/colors` (the exact
// constant `chartUtils` re-exports) rather than from `chartUtils` itself, since
// `chartUtils` still instantiates a recharts `<CartesianGrid>` at module load —
// importing it here would drag recharts back into this now visx-only module.
import { CHART_COLORS } from '../../lib/colors'

interface TooltipPayload {
  name: string
  value: unknown
  color?: string
  fill?: string
  unit?: string
  /** Recharts attaches the dataKey here for line/area/bar series. */
  dataKey?: string | number
}

export interface ChartTooltipProps {
  active?: boolean
  payload?: TooltipPayload[]
  label?: string | number
  /**
   * Optional value formatter. Receives the raw value plus the series name and
   * unit; returns the rendered string. Falls back to {@link fmtNumber} for
   * numbers and `String(...)` for everything else.
   */
  valueFormatter?: (value: unknown, name: string, unit?: string) => ReactNode
  /**
   * Optional label formatter. Defaults to ISO-detection: if `label` parses
   * as a date AND looks like an ISO timestamp, it's rendered via
   * {@link formatDateTime} (locale + browser-tz aware). Otherwise the label is
   * passed through as-is — preserving the existing "HH:MM" string labels in
   * Drive Detail and other pages.
   */
  labelFormatter?: (label: string | number | undefined) => ReactNode
}

/**
 * Heuristic: does the string look like an ISO 8601 timestamp? We require at
 * least `YYYY-MM-DDTHH:MM` so plain date strings like "Apr 4" don't trigger
 * the formatter (those live in formatted-string XAxis labels).
 */
const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && ISO_TS_RE.test(value)
}

function defaultLabelFormatter(label: string | number | undefined): ReactNode {
  if (label == null) return ''
  if (isIsoTimestamp(label)) return formatDateTime(label)
  return String(label)
}

function defaultValueFormatter(
  value: unknown,
  _name: string,
  unit: string | undefined,
): ReactNode {
  const formatted =
    typeof value === 'number' ? fmtNumber(value) : String(value ?? '')
  return (
    <>
      {formatted}
      {unit && <span className="ml-0.5 opacity-60">{unit}</span>}
    </>
  )
}

/**
 * Series swatch drawn with a visx `<Circle>` (SVG/D3 primitive): a solid disc
 * sitting inside a soft radial-gradient halo. Replaces the old CSS box-shadow
 * dot so the marker gets the same SVG-level styling control as the chart's
 * glowing series, and inherits the exact series colour recharts (today) or a
 * visx `TooltipWithBounds` (post chart-migration) hands us via the payload.
 * Decorative only — the adjacent name/value text carries the meaning — so it's
 * `aria-hidden` and never announced twice.
 */
function SeriesSwatch({ color, gradientId }: { color: string; gradientId: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 14 14"
      className="h-3.5 w-3.5 shrink-0 overflow-visible"
    >
      <defs>
        <radialGradient id={gradientId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={color} stopOpacity={0.55} />
          <stop offset="65%" stopColor={color} stopOpacity={0.14} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </radialGradient>
      </defs>
      <Circle cx={7} cy={7} r={7} fill={`url(#${gradientId})`} />
      <Circle cx={7} cy={7} r={4} fill={color} />
    </svg>
  )
}

/**
 * Shared floating tooltip body, rendered as a glassmorphism card. It is a pure
 * presentational content renderer: the host chart owns show/hide + positioning
 * (recharts `<Tooltip content={<ChartTooltip />}>` today, a visx
 * `TooltipWithBounds` after the chart migration), so this stays chart-library
 * agnostic and touch-friendly — no hover-only affordances, `pointer-events-none`
 * so a tap on the chart passes through, and it reflows within the viewport at
 * 375px via `max-w`. `role="tooltip"` marks the floating panel as an
 * information popup for screen readers.
 *
 * Locale-aware (numbers via `fmtNumber`) and TZ-aware (ISO labels via
 * `formatDateTime`). Accepts `valueFormatter` and `labelFormatter` props for
 * chart-specific overrides while staying the single source of truth for tooltip
 * styling app-wide.
 */
export function ChartTooltipBase({
  active,
  payload,
  label,
  valueFormatter = defaultValueFormatter,
  labelFormatter = defaultLabelFormatter,
}: ChartTooltipProps) {
  // Stable, collision-free gradient-id base for the SVG glow swatches. Called
  // before the visibility short-circuit so hook order stays constant.
  const gradientBase = useId()

  // Null-safe: tolerate a missing/undefined payload without ever calling
  // `.length`/`.map` on `undefined`.
  const rows = payload ?? []
  if (!active || rows.length === 0) return null

  return (
    <div
      role="tooltip"
      aria-live="polite"
      className="pointer-events-none max-w-[min(16rem,90vw)] select-none rounded-xl border px-4 py-3 text-xs shadow-[0_8px_32px_rgba(0,0,0,0.3)] backdrop-blur-xl bg-[var(--surface-elevated)] border-[var(--border-subtle)]"
    >
      <p className="mb-1.5 break-words font-medium text-[var(--text-secondary)]">
        {labelFormatter(label)}
      </p>
      {rows.map((p, i) => {
        // Prefer the colour the series carried; fall back to the shared palette
        // (cycled) so a swatch is never blank.
        const swatch = p.color ?? p.fill ?? CHART_COLORS[i % CHART_COLORS.length]
        return (
          <div key={`${p.name}-${i}`} className="flex items-center gap-2 py-0.5">
            <SeriesSwatch color={swatch} gradientId={`${gradientBase}-${i}`} />
            <span className="text-[var(--text-secondary)]">{p.name}:</span>
            <span className="min-w-0 break-words font-mono font-semibold tabular-nums text-[var(--text-primary)]">
              {valueFormatter(p.value, p.name, p.unit)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export const ChartTooltip = memo(ChartTooltipBase)
