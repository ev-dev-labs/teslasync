import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import { GlassPanel } from '@/components/ui'

interface InfoTileProps {
  icon: React.ElementType
  label: string
  // Nullish values are tolerated: callers frequently pass computed values
  // (e.g. a formatter over a `*float64` that decoded to null) that can be
  // undefined at runtime even though the union looks total. Rendering an
  // em-dash placeholder keeps the tile from showing a blank body / a literal
  // "undefined" in the truncation tooltip.
  value: string | number | boolean | null | undefined
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
  const { t } = useTranslation()
  const display =
    typeof value === 'boolean'
      ? value
        ? t('common.yes', 'Yes')
        : t('common.no', 'No')
      : (value ?? '—')
  return (
    <GlassPanel className="p-4 overflow-hidden">
      <div className="flex items-center gap-2 text-[var(--text-muted)] text-xs mb-1.5 min-w-0">
        {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
        <span className="truncate">{label}</span>
      </div>
      <p className={cn('text-lg font-semibold truncate', color)} title={String(display)}>
        {display}
      </p>
      {sub ? <p className="text-2xs text-[var(--text-muted)] mt-0.5">{sub}</p> : null}
    </GlassPanel>
  )
}
