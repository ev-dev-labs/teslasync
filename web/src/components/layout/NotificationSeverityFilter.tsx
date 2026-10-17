import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { typography } from '@/lib/tokens'

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
        'inline-flex h-auto min-h-11 min-w-11 max-w-full items-center gap-1.5 whitespace-normal rounded-pill px-2.5 py-1 md:min-h-9 md:min-w-0',
        typography.size.xs,
        typography.weight.medium,
        active
          ? 'bg-[var(--control-bg)] text-[var(--text-primary)] ring-1 ring-inset ring-[var(--border-strong)] forced-colors:bg-[Highlight] forced-colors:text-[HighlightText]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-primary)]',
      )}
    >
      {dotClassName && (
        <span aria-hidden="true" className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', dotClassName)} />
      )}
      <span className="min-w-0 break-words">{label}</span>
      <span className={cn('shrink-0 tabular-nums forced-colors:text-[ButtonText]', active && 'forced-colors:text-[HighlightText]', typography.color.muted)}>{count}</span>
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
      className="flex min-w-0 shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--border-default)] px-4 py-2"
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
      <span className={cn('ms-auto min-w-0 break-words', typography.role.caption)}>
        {t('notifications.bellPopover.previewScope', 'Preview: {{count}} of {{total}} unread', {
          count: previewCount,
          total: totalUnread,
        })}
      </span>
    </div>
  )
}
