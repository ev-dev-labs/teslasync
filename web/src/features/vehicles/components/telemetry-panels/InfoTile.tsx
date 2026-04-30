import { cn } from '@/lib/cn'
import { GlassPanel } from '@/components/ui'

interface InfoTileProps {
  icon: React.ElementType
  label: string
  value: string | number | boolean
  color?: string
  sub?: string
}

export function InfoTile({
  icon: Icon,
  label,
  value,
  color = 'text-[var(--text-primary)]',
  sub,
}: InfoTileProps) {
  const display = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value
  return (
    <GlassPanel className="p-4 overflow-hidden">
      <div className="flex items-center gap-2 text-[var(--text-muted)] text-xs mb-1.5 min-w-0">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      <p className={cn('text-lg font-semibold truncate', color)} title={String(display)}>
        {display}
      </p>
      {sub && <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{sub}</p>}
    </GlassPanel>
  )
}
