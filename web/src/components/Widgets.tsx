import { useEffect, useRef, useState } from 'react'
import { motion, useInView } from 'framer-motion'

interface AnimatedNumberProps {
  value: number
  duration?: number
  decimals?: number
  prefix?: string
  suffix?: string
  className?: string
}

/** Animates a number from 0 to the target value with eased interpolation. */
export function AnimatedNumber({ value, duration = 1.2, decimals = 0, prefix = '', suffix = '', className = '' }: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true })
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    if (!inView) return
    const start = 0
    const end = value
    const startTime = performance.now()

    function step(now: number) {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / (duration * 1000), 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(start + (end - start) * eased)
      if (progress < 1) requestAnimationFrame(step)
    }

    requestAnimationFrame(step)
  }, [value, duration, inView])

  return (
    <span ref={ref} className={className}>
      {prefix}{display.toFixed(decimals)}{suffix}
    </span>
  )
}

/** Animated bar showing a metric filling up */
export function MetricBar({ value, max, color, label, sublabel }: {
  value: number; max: number; color: string; label: string; sublabel?: string
}) {
  const pct = Math.min((value / max) * 100, 100)
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-gray-300">{label}</span>
        <span className="text-xs font-mono" style={{ color }}>{value.toFixed(1)}{sublabel && <span className="text-[var(--text-muted)] ml-0.5">{sublabel}</span>}</span>
      </div>
      <div className="h-2 rounded-full bg-white/5 overflow-hidden">
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

/** Timeline item for activity feeds */
export function TimelineItem({ icon, title, subtitle, time, color, isLast }: {
  icon: React.ReactNode; title: string; subtitle?: string; time: string; color: string; isLast?: boolean
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg shrink-0"
          style={{ backgroundColor: `${color}15`, color }}
        >
          {icon}
        </div>
        {!isLast && <div className="w-px flex-1 bg-white/5 mt-1" />}
      </div>
      <div className="pb-4 min-w-0 flex-1">
        <p className="text-sm font-medium text-[var(--text-primary)] truncate">{title}</p>
        {subtitle && <p className="text-xs text-[var(--text-muted)] mt-0.5">{subtitle}</p>}
        <p className="text-[10px] text-gray-600 mt-1">{time}</p>
      </div>
    </div>
  )
}

/** Radial gauge for dashboard hero metrics */
export function RadialGauge({ value, max, label, unit, color, size = 120 }: {
  value: number; max: number; label: string; unit: string; color: string; size?: number
}) {
  const pct = Math.min((value / max) * 100, 100)
  const r = (size - 16) / 2
  const circ = 2 * Math.PI * r * 0.75 // 270 degree arc
  const offset = circ - (pct / 100) * circ
  const startAngle = 135 // degrees
  const gap = 8
  const gradId = `rg-${color.replace('#', '')}`

  return (
    <div className="relative inline-flex flex-col items-center" style={{ width: size, height: size + 18 }}>
      <svg width={size} height={size} className="overflow-visible">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={1} />
            <stop offset="100%" stopColor={color} stopOpacity={0.4} />
          </linearGradient>
        </defs>
        {/* Background arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.04)"
          strokeWidth={gap}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * 0.25}
          transform={`rotate(${startAngle} ${size / 2} ${size / 2})`}
        />
        {/* Value arc */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={gap}
          strokeLinecap="round"
          strokeDasharray={circ}
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: offset + circ * 0.25 }}
          transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
          transform={`rotate(${startAngle} ${size / 2} ${size / 2})`}
          style={{ filter: `drop-shadow(0 0 6px ${color}60)` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold text-[var(--text-primary)]">{Math.round(value)}</span>
        <span className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider">{unit}</span>
      </div>
      <span className="text-[10px] font-medium text-[var(--text-secondary)] mt-1">{label}</span>
    </div>
  )
}

/** Tag/pill for status display */
export function StatusPill({ children, color, pulse }: {
  children: React.ReactNode; color: string; pulse?: boolean
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold border"
      style={{
        backgroundColor: `${color}10`,
        borderColor: `${color}30`,
        color,
      }}
    >
      {pulse && (
        <span className="relative flex h-2 w-2">
          <span
            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
            style={{ backgroundColor: color }}
          />
          <span
            className="relative inline-flex h-2 w-2 rounded-full"
            style={{ backgroundColor: color }}
          />
        </span>
      )}
      {children}
    </span>
  )
}

/** Mini sparkline chart with gradient fill */
export function MiniChart({ data, color, height = 40, width = 120 }: {
  data: number[]; color: string; height?: number; width?: number
}) {
  if (data.length < 2) return null
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1
  const points = data.map((v, i) =>
    `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * (height - 4) - 2}`
  )
  const pathStr = points.join(' ')
  const areaStr = `0,${height} ${pathStr} ${width},${height}`
  const gradId = `mc-${color.replace('#', '')}-${Math.random().toString(36).slice(2, 6)}`

  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polyline points={areaStr} fill={`url(#${gradId})`} stroke="none">
        <animate attributeName="opacity" from="0" to="1" dur="0.6s" fill="freeze" />
      </polyline>
      <polyline
        points={pathStr}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        style={{ filter: `drop-shadow(0 0 3px ${color})` }}
      >
        <animate attributeName="stroke-dashoffset" from="500" to="0" dur="1s" fill="freeze" />
        <animate attributeName="stroke-dasharray" from="500" to="500" dur="0.01s" fill="freeze" />
      </polyline>
      {/* Current value dot */}
      <circle
        cx={width}
        cy={height - ((data[data.length - 1] - min) / range) * (height - 4) - 2}
        r={3}
        fill={color}
        style={{ filter: `drop-shadow(0 0 4px ${color})` }}
      >
        <animate attributeName="opacity" from="0" to="1" dur="0.8s" begin="0.4s" fill="freeze" />
      </circle>
    </svg>
  )
}
