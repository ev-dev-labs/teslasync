import { memo } from 'react'
import { fmtNumber } from '../../lib/numberFormat'

interface TooltipPayload { name: string; value: unknown; color?: string; fill?: string; unit?: string }

/**
 * Recharts custom tooltip body. Marked with `role="tooltip"` so screen readers
 * recognise the floating panel as an information popup; Recharts itself
 * positions and toggles visibility based on cursor / focus events.
 */
export function ChartTooltipBase({ active, payload, label }: {
  active?: boolean
  payload?: TooltipPayload[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div
      role="tooltip"
      aria-live="polite"
      className="rounded-xl border px-4 py-3 text-xs shadow-xl backdrop-blur-xl bg-[var(--surface-elevated)] border-[var(--border-subtle)]"
      style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}
    >
      <p className="mb-1.5 font-medium text-[var(--text-secondary)]">{label}</p>
      {payload.map((p, i) => (
        <div key={`${p.name}-${i}`} className="flex items-center gap-2 py-0.5">
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: p.color || p.fill, boxShadow: `0 0 6px ${p.color || p.fill}60` }}
          />
          <span className="text-[var(--text-secondary)]">{p.name}:</span>
          <span className="font-mono font-semibold text-[var(--text-primary)]">
            {typeof p.value === 'number' ? fmtNumber(p.value) : String(p.value ?? '')}
            {p.unit && <span className="ml-0.5 opacity-60">{p.unit}</span>}
          </span>
        </div>
      ))}
    </div>
  )
}

export const ChartTooltip = memo(ChartTooltipBase)
