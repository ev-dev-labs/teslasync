import { type ReactNode } from 'react'

/** Timeline item for activity feeds */
export function TimelineItem({ icon, title, subtitle, time, color, isLast }: {
  icon: ReactNode; title: string; subtitle?: string; time: string; color: string; isLast?: boolean
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
