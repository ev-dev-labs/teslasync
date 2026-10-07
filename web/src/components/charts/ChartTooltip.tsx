import { memo, type ReactNode } from 'react'
import { fmtNumber } from '../../lib/numberFormat'
import { formatDateTime } from '../../lib/dateFormat'

interface TooltipPayload {
  name?: string | number
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
    * Recharts injects its `formatter` prop into custom tooltip content. Accept
    * that standard shape so `<Tooltip formatter={...}
    * content={<ChartTooltip />}>` retains the caller's value and series-name
    * formatting instead of silently falling back to the shared default.
    */
   formatter?: (
     value: unknown,
     name: string,
     entry: TooltipPayload,
     index: number,
     payload: TooltipPayload[],
   ) => ReactNode | [ReactNode, ReactNode]
  /**
   * Optional label formatter. Defaults to ISO-detection: if `label` parses
   * as a date AND looks like an ISO timestamp, it's rendered via
   * {@link formatDateTime} (locale + browser-tz aware). Otherwise the label is
   * passed through as-is — preserving the existing "HH:MM" string labels in
   * Drive Detail and other pages.
   */
  labelFormatter?: (
    label: string | number | undefined,
    payload?: TooltipPayload[],
  ) => ReactNode
  /** IANA timezone for ISO timestamp labels (defaults to the browser zone). */
  timezone?: string
  /** Fraction digits for the default numeric formatter (0–20, defaults to 1). */
  precision?: number
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

function defaultLabelFormatter(
  label: string | number | undefined,
  timezone?: string,
): ReactNode {
  if (label == null) return ''
  if (isIsoTimestamp(label)) {
    // Intl throws RangeError for an invalid IANA zone. Mirror dateFormat's
    // invalid-zone convention: keep the timestamp usable in the browser zone.
    try {
      return formatDateTime(label, timezone ? { tz: timezone } : undefined)
    } catch {
      return formatDateTime(label)
    }
  }
  return String(label)
}

function defaultValueFormatter(
  value: unknown,
  _name: string,
  unit: string | undefined,
  precision: number | undefined,
): ReactNode {
  const formatted =
    typeof value === 'number'
      ? precision == null
        ? fmtNumber(value)
        : fmtNumber(value, Math.max(0, Math.min(20, precision)))
      : value == null
        ? '—'
        : String(value)
  return (
    <>
      {formatted}
      {unit && <span className="ml-0.5 opacity-60">{unit}</span>}
    </>
  )
}

/**
 * Recharts custom tooltip body. Marked with `role="tooltip"` so screen readers
 * recognise the floating panel as an information popup; recharts itself
 * positions and toggles visibility based on cursor / focus events.
 *
 * now locale-aware (numbers via `fmtNumber`) and
 * TZ-aware (ISO labels via `formatDateTime`). Accepts `valueFormatter` and
 * `labelFormatter` props for chart-specific overrides while staying the single
 * source of truth for tooltip styling app-wide.
 */
export function ChartTooltipBase({
  active,
  payload,
  label,
  valueFormatter,
  formatter,
  labelFormatter,
  timezone,
  precision,
}: ChartTooltipProps) {
  if (!active || !payload?.length) return null
  const displayLabel = labelFormatter
    ? labelFormatter(label, payload)
    : defaultLabelFormatter(label, timezone)

  return (
    <div
      role="tooltip"
      aria-live="polite"
      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-4 py-3 text-xs shadow-[0_8px_32px_rgba(0,0,0,0.3)] backdrop-blur-xl"
    >
      <p className="mb-1.5 font-medium text-[var(--text-secondary)]">
        {displayLabel}
      </p>
      {payload.map((p, i) => {
        const defaultName = String(p.name ?? p.dataKey ?? '')
        let displayName: ReactNode = defaultName
        let displayValue: ReactNode

        if (valueFormatter) {
          displayValue = valueFormatter(p.value, defaultName, p.unit)
        } else if (formatter) {
          const formatted = formatter(p.value, defaultName, p, i, payload)
          if (Array.isArray(formatted) && formatted.length === 2) {
            displayValue = formatted[0]
            displayName = formatted[1]
          } else {
            displayValue = formatted
          }
        } else {
          displayValue = defaultValueFormatter(p.value, defaultName, p.unit, precision)
        }

        return (
          <div key={`${defaultName}-${i}`} className="flex items-center gap-2 py-0.5">
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: p.color || p.fill }}
            />
            <span className="text-[var(--text-secondary)]">{displayName}:</span>
            <span className="font-mono font-semibold text-[var(--text-primary)]">
              {displayValue}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export const ChartTooltip = memo(ChartTooltipBase)
