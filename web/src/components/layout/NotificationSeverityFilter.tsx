import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'

type Severity = 'info' | 'warn' | 'critical'

interface NotificationSeverityFilterProps {
  value: 'all' | Severity
  onChange: (value: 'all' | Severity) => void
  severities: Severity[]
  previewCount: number
  totalUnread: number
  tones: Record<Severity, { dot: string }>
}

function SeverityFilterChip({
  active,
  onClick,
  label,
  count,
  dotClassName,
  previewCount,
}: {
  active: boolean
  onClick: () => void
  label: string
  count: number
  dotClassName?: string
  previewCount: number
}) {
  const { t } = useTranslation()
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      aria-pressed={active}
      aria-label={t('notifications.bellPopover.filterCountLabel', '{{label}}, {{count}} in latest {{previewCount}}', { label, count, previewCount })}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500',
        active
          ? 'bg-cyan-500/15 text-cyan-200 ring-1 ring-inset ring-cyan-400/40'
          : 'text-[var(--text-secondary)] hover:bg-white/[0.06] hover:text-[var(--text-primary)]',
      )}
    >
      {dotClassName && (
        <span aria-hidden="true" className={cn('inline-block h-1.5 w-1.5 rounded-full', dotClassName)} />
      )}
      <span>{label}</span>
      <span className="tabular-nums text-[var(--text-muted)]">{count}</span>
    </Button>
  )
}

export default function NotificationSeverityFilter({
  value,
  onChange,
  severities,
  previewCount,
  totalUnread,
  tones,
}: NotificationSeverityFilterProps) {
  const { t } = useTranslation()
  const counts: Record<Severity, number> = { info: 0, warn: 0, critical: 0 }
  for (const severity of severities) counts[severity] += 1
  return (
    <div
      role="group"
      aria-label={t('notifications.bellPopover.filterLabel', 'Filter latest notifications by severity')}
      className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--glass-border)] px-4 py-2"
    >
      <SeverityFilterChip
        active={value === 'all'}
        onClick={() => onChange('all')}
        label={t('notifications.bellPopover.filterAll', 'All')}
        count={previewCount}
        previewCount={previewCount}
      />
      {(['critical', 'warn', 'info'] as const).map((severity) => (
        <SeverityFilterChip
          key={severity}
          active={value === severity}
          onClick={() => onChange(severity)}
          label={
            severity === 'critical'
              ? t('notifications.bellPopover.filterCritical', 'Critical')
              : severity === 'warn'
                ? t('notifications.bellPopover.filterWarning', 'Warning')
                : t('notifications.bellPopover.filterInfo', 'Info')
          }
          count={counts[severity]}
          previewCount={previewCount}
          dotClassName={tones[severity].dot}
        />
      ))}
      <span className="ml-auto text-xs text-[var(--text-muted)]">
        {t('notifications.bellPopover.previewScope', 'Preview: {{count}} of {{total}} unread', {
          count: previewCount,
          total: totalUnread,
        })}
      </span>
    </div>
  )
}
