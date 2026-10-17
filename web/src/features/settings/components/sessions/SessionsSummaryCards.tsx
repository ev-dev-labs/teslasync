import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { StatMetric } from '@/components/data-display'
import { QueryError } from '@/components/feedback'
import { useDateFormat } from '@/hooks/useDateFormat'
import type { ActiveSession } from '@/api/types'

import { describeDevice } from './deviceLabel'
import { SettingsSummaryBrief } from '../operationalbrief-all/SettingsSummaryBrief'

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
  retained?: boolean
  sourceAvailable?: boolean
}

/**
 * KPI band for the Active Sessions page. Presentational: the page computes the
 * stats and hands them down. The compact Brief retains source context through
 * loading/failure and keeps successful empty lists distinct from missing lists.
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
  retained = false,
  sourceAvailable = true,
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
  const sourceUnavailable = isError || !sourceAvailable
  const metrics: readonly StatMetric[] = [
    { metricId: 'count', occurrenceId: 'sessions-total', rawValue: sourceUnavailable || isLoading ? null : total,
      label: t('account.sessions.kpi.total', 'Active sessions') },
    { metricId: 'text', occurrenceId: 'sessions-current', rawValue: sourceUnavailable || isLoading ? null : currentLabel,
      label: t('account.sessions.kpi.thisDevice', 'This device'), context: currentIp },
    { metricId: 'count', occurrenceId: 'sessions-other', rawValue: sourceUnavailable || isLoading ? null : otherCount,
      label: t('account.sessions.kpi.otherDevices', 'Other devices') },
    { metricId: 'text', occurrenceId: 'sessions-last', rawValue: sourceUnavailable || isLoading ? null : lastActiveLabel,
      label: t('account.sessions.kpi.lastActive', 'Last active'),
      context: lastActive ? formatDateTime(lastActive) : undefined },
  ]

  return (
    <section
      aria-label={t('account.sessions.summaryAria', 'Session summary')}
      aria-busy={isLoading}
    >
      <SettingsSummaryBrief title={t('account.sessions.brief.title', 'Session overview')}
        description={t('account.sessions.brief.description', 'Signed-in devices and their most recent activity. Sign-out controls remain below and in the page header.')}
        source={t('account.sessions.brief.source', 'Account session list')}
        scope={t('account.sessions.brief.scope', 'Current account · latest session list; not a historical activity range')}
        metrics={metrics} loading={isLoading} unavailable={sourceUnavailable} retained={retained}
        testId="sessions-summary" />
      {isError && <QueryError error={displayError} onRetry={onRetry} />}
    </section>
  )
}

export default SessionsSummaryCards
