/**
 * Shared chart components and utilities for consistent, theme-aware charts across TeslaSync.
 *
 * Provides reusable tooltip, axis tick styles, gradient definitions, and chart wrapper
 * components that automatically adapt to the active theme and display mode.
 */
import { CartesianGrid } from 'recharts'
import { memo } from 'react'

// ── Neon color palette used across all charts ──
export const NEON_COLORS = ['#00f0ff', '#10b981', '#a855f7', '#f59e0b', '#4f46e5', '#ef4444', '#ec4899', '#14b8a6']

// ── Theme-aware axis tick styles ──
export const axisTick = { fill: 'var(--text-muted)', fontSize: 11 }
export const axisTickSm = { fill: 'var(--text-muted)', fontSize: 10 }

// ── Reusable CartesianGrid with theme-aware stroke ──
export const chartGrid = <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />

// ── Safe number handling ──
export const safe = (v: unknown): number => (typeof v === 'number' && isFinite(v) ? v : 0)
export const fmt = (v: unknown, decimals = 1): string => safe(v).toFixed(decimals)

// ── Chart tooltip with glassmorphism styling ──
interface TooltipPayload { name: string; value: unknown; color?: string; fill?: string; unit?: string }

export function ChartTooltipBase({ active, payload, label }: {
  active?: boolean
  payload?: TooltipPayload[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div
      className="rounded-xl border px-4 py-3 text-xs shadow-xl backdrop-blur-xl"
      style={{
        background: 'var(--surface-2)',
        borderColor: 'var(--glass-border)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
      }}
    >
      <p className="mb-1.5 font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</p>
      {payload.map((p, i) => (
        <div key={`${p.name}-${i}`} className="flex items-center gap-2 py-0.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: p.color || p.fill, boxShadow: `0 0 6px ${p.color || p.fill}60` }}
          />
          <span style={{ color: 'var(--text-secondary)' }}>{p.name}:</span>
          <span className="font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
            {typeof p.value === 'number' ? p.value.toFixed(1) : String(p.value ?? '')}
            {p.unit && <span className="ml-0.5 opacity-60">{p.unit}</span>}
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * SVG gradient definitions for area/bar charts.
 * Place inside a `<defs>` element within the chart component.
 *
 * @example
 * <AreaChart>
 *   <defs>
 *     <ChartGradient id="gradCyan" color="#00f0ff" />
 *   </defs>
 *   <Area fill="url(#gradCyan)" />
 * </AreaChart>
 */
export function ChartGradientBase({ id, color, opacity = 0.3 }: { id: string; color: string; opacity?: number }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={color} stopOpacity={opacity} />
      <stop offset="95%" stopColor={color} stopOpacity={0.02} />
    </linearGradient>
  )
}

/** Default chart animation config for consistent transitions */
export const chartAnimation = {
  animationDuration: 800,
  animationEasing: 'ease-out' as const,
}

/** Common chart margin preset */
export const chartMargin = { top: 10, right: 10, left: 0, bottom: 0 }
export const chartMarginLabeled = { top: 10, right: 20, left: 10, bottom: 5 }

export const ChartTooltip = memo(ChartTooltipBase)
export const ChartGradient = memo(ChartGradientBase)
