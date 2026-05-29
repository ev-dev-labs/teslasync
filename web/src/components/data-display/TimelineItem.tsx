import { type ReactNode } from 'react'
import { Link } from 'react-router-dom'

/** Timeline item for activity feeds. When `href` is provided, the entire row
 *  becomes a navigable link for alert drill-through. */
export function TimelineItem({ icon, title, subtitle, time, color, isLast, href }: {
  icon: ReactNode; title: string; subtitle?: string; time: string; color: string; isLast?: boolean; href?: string
}) {
  const body = (
    <>
      <div className="flex flex-col items-center">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg shrink-0"
          style={{ backgroundColor: `${color}15`, color }}
        >
          {icon}
        </div>
        {!isLast && <div className="w-px flex-1 bg-[var(--surface-2)] mt-1" />}
      </div>
      <div className="pb-4 min-w-0 flex-1">
        <p className="text-sm font-medium text-[var(--text-primary)] truncate">{title}</p>
        {subtitle && <p className="text-xs text-[var(--text-muted)] mt-0.5">{subtitle}</p>}
        <p className="text-[10px] text-gray-600 mt-1">{time}</p>
      </div>
    </>
  )
  if (href) {
    return (
      <Link
        to={href}
        className="flex gap-3 -mx-1 px-1 rounded-md hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400/60 transition-colors"
      >
        {body}
      </Link>
    )
  }
  return <div className="flex gap-3">{body}</div>
}
