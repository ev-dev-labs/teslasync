import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { MonitorSmartphone, ShieldCheck, Globe, Clock } from 'lucide-react'

import { MetricCard } from '@/components/data-display'
import { Skeleton, QueryError } from '@/components/feedback'
import { useDateFormat } from '@/hooks/useDateFormat'
import type { ActiveSession } from '@/api/types'

import { describeDevice } from './deviceLabel'

interface SessionsSummaryCardsProps {
  total: number
  /** The current-device session, if any — drives the "This device" card. */
  current: ActiveSession | null
  otherCount: number
  /** Most-recent activity across all sessions (ISO string) or null. */
  lastActive: string | null
  isLoading: boolean
  isError: boolean
  error?: unknown
  onRetry?: () => void
}

/**
 * KPI band for the Active Sessions page. Presentational: the page computes the
 * stats and hands them down. Renders four metric cards (or matching skeletons
 * while the list query is in flight) so the layout never jumps.
 */
export function SessionsSummaryCards({
  total,
  current,
  otherCount,
  lastActive,
  isLoading,
  isError,
  error,
  onRetry,
}: SessionsSummaryCardsProps) {
  const { t } = useTranslation('settings')
  const { formatRelativeTime, formatDateTime } = useDateFormat()

  const currentLabel = current
    ? describeDevice(current.user_agent)
    : t('account.sessions.unknownDevice', 'Unknown device')
  const currentIp = current?.ip || undefined
  const lastActiveLabel = lastActive
    ? formatRelativeTime(lastActive)
    : t('account.sessions.kpi.never', 'Never')

  // QueryError renders `null` for a falsy error, so an `isError` flag paired
  // with a nullish `error` would collapse to a blank panel. Fall back to a
  // generic error so the error state always shows recovery copy + Retry.
  const displayError = useMemo(
    () => error ?? new Error('Session list unavailable'),
    [error],
  )

  return (
    <section
      aria-label={t('account.sessions.summaryAria', 'Session summary')}
      aria-busy={isLoading}
    >
      {isError ? (
        <QueryError error={displayError} onRetry={onRetry} />
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {isLoading
            ? Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} height={76} className="rounded-xl" />
              ))
            : (
              <>
                <MetricCard
                  label={t('account.sessions.kpi.total', 'Active sessions')}
                  value={total}
                  icon={<MonitorSmartphone className="h-5 w-5" aria-hidden="true" />}
                  color="cyan"
                />
                <MetricCard
                  label={t('account.sessions.kpi.thisDevice', 'This device')}
                  value={currentLabel}
                  subtitle={currentIp}
                  icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
                  color="green"
                />
                <MetricCard
                  label={t('account.sessions.kpi.otherDevices', 'Other devices')}
                  value={otherCount}
                  icon={<Globe className="h-5 w-5" aria-hidden="true" />}
                  color="amber"
                />
                <MetricCard
                  label={t('account.sessions.kpi.lastActive', 'Last active')}
                  value={lastActiveLabel}
                  subtitle={lastActive ? formatDateTime(lastActive) : undefined}
                  icon={<Clock className="h-5 w-5" aria-hidden="true" />}
                  color="blue"
                />
              </>
            )}
        </div>
      )}
    </section>
  )
}

export default SessionsSummaryCards
