import { memo } from 'react'
import { fmtNumber } from '../../lib/numberFormat'

interface TooltipPayload { name: string; value: unknown; color?: string; fill?: string; unit?: string }

export function ChartTooltipBase({ active, payload, label }: {
  active?: boolean
  payload?: TooltipPayload[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div
      className="rounded-xl border px-4 py-3 text-xs shadow-xl backdrop-blur-xl bg-white/[0.03] border-white/[0.06]"
      style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}
    >
      <p className="mb-1.5 font-medium text-white/60">{label}</p>
      {payload.map((p, i) => (
        <div key={`${p.name}-${i}`} className="flex items-center gap-2 py-0.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: p.color || p.fill, boxShadow: `0 0 6px ${p.color || p.fill}60` }}
          />
          <span className="text-white/60">{p.name}:</span>
          <span className="font-mono font-semibold text-white/90">
            {typeof p.value === 'number' ? fmtNumber(p.value) : String(p.value ?? '')}
            {p.unit && <span className="ml-0.5 opacity-60">{p.unit}</span>}
          </span>
        </div>
      ))}
    </div>
  )
}

export const ChartTooltip = memo(ChartTooltipBase)
