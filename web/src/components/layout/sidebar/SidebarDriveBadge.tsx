import { useTranslation } from 'react-i18next'
import { useDrives, useDriveScore } from '@/api/hooks/useDriving'
import { calendarRangeToInstants, civilDateInTimeZone } from '@/lib/dateRange'
import { SidebarCountChip } from './SidebarRow'

interface SidebarDriveBadgeProps {
  kind: 'today' | 'score'
  vehicleId: string
}

export function SidebarDriveBadge({ kind, vehicleId }: SidebarDriveBadgeProps) {
  const { t } = useTranslation()
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const today = civilDateInTimeZone(new Date(), timezone)
  const { startInstant, endInstantExclusive } = calendarRangeToInstants({
    startDate: today,
    endDate: today,
    timezone,
  })
  const drives = useDrives(kind === 'today' ? vehicleId : undefined, {
    start: startInstant,
    end: endInstantExclusive,
    limit: 1000,
  })
  const score = useDriveScore(kind === 'score' ? vehicleId : undefined)

  if (kind === 'today') {
    const count = drives.data?.length
    if (count == null || count === 0 || count >= 1000) return null
    return (
      <span className="shrink-0">
        <SidebarCountChip
          value={count}
          label={t('nav.drivesToday', { count, defaultValue: '{{count}} drives today' })}
          suffix={t('nav.today', 'today')}
        />
      </span>
    )
  }

  const value = score.data?.overall
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) return null
  const rounded = Math.round(value)
  return (
    <span className="shrink-0">
      <SidebarCountChip
        value={rounded}
        label={t('nav.currentDriveScore', { score: rounded, defaultValue: 'Drive score {{score}}' })}
        uncapped
        className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      />
    </span>
  )
}
