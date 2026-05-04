import { motion } from 'framer-motion'
import { fmtNumber } from '../../lib/numberFormat'

/** Animated bar showing a metric filling up */
export function MetricBar({ value, max, color, label, sublabel }: {
  value: number; max: number; color: string; label: string; sublabel?: string
}) {
  const pct = Math.min((value / max) * 100, 100)
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-[var(--text-secondary)]">{label}</span>
        <span className="text-xs font-mono" style={{ color }}>{sublabel || fmtNumber(value)}</span>
      </div>
      <div className="h-2 rounded-full bg-[var(--surface-2)] overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
          style={{ background: `linear-gradient(90deg, ${color}99, ${color})`, boxShadow: `0 0 8px ${color}40` }}
        />
      </div>
    </div>
  )
}
