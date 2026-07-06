import type { ReactNode } from 'react'
import { GlassPanel } from '@/components/ui'
import { cn } from '@/lib/cn'
import { ICON_COLOR_MAP } from './constants'

interface ToolCardProps {
  icon: React.ElementType
  color: string
  title: string
  description: string
  children: ReactNode
}

export function ToolCard({ icon: Icon, color, title, description, children }: ToolCardProps) {
  return (
    <GlassPanel className="p-5">
      <div className="mb-4 flex items-start gap-3">
        <div
          aria-hidden="true"
          className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', ICON_COLOR_MAP[color] ?? ICON_COLOR_MAP.cyan)}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
          <p className="text-xs text-[var(--text-secondary)]">{description}</p>
        </div>
      </div>
      {children}
    </GlassPanel>
  )
}
