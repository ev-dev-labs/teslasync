import { motion } from '@/components/motion'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { fmtNumber } from '../../lib/numberFormat'

/**
 * Animated bar showing a metric filling up.
 *
 * `sublabel` policy: a string (including the EMPTY string "") is rendered
 * verbatim. Use the empty string to explicitly suppress the textual
 * readout beside the bar when the same value is already displayed
 * elsewhere (e.g. in a sibling row above the bar). When `sublabel` is
 * `undefined` (omitted), the formatted value is shown — that's the
 * common case for standalone bars. We use `??` rather than `||` so an
 * intentional empty string isn't silently treated as "show the value"
 * (which previously rendered a stray "0.00" in the Throttle Behavior
 * panel of /driving).
 */
export function MetricBar({ value, max, color, label, sublabel }: {
  value: number; max: number; color: string; label: string; sublabel?: string
}) {
  const { reduce } = useMotionPreference()
  const safeValue = Number.isFinite(value) ? value : 0
  const safeMax = Number.isFinite(max) && max > 0 ? max : 0
  const pct = safeMax > 0 ? Math.min(Math.max((safeValue / safeMax) * 100, 0), 100) : 0
  const boundedValue = safeMax > 0 ? Math.min(Math.max(safeValue, 0), safeMax) : 0
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={boundedValue}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-[var(--text-secondary)]">{label}</span>
        <span className="font-mono text-sm" style={{ color }}>{sublabel ?? fmtNumber(safeValue)}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-pill bg-[var(--surface-2)]">
        <motion.div
          className="h-full rounded-pill"
          initial={reduce ? false : { width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: reduce ? 0 : 1, ease: [0.16, 1, 0.3, 1] }}
          style={{ background: `linear-gradient(90deg, ${color}99, ${color})` }}
        />
      </div>
    </div>
  )
}
