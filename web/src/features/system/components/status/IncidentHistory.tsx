import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CalendarDays, ChevronRight } from 'lucide-react'
import { useIncidents } from '@/api/hooks/useIncidents'
import { GlassPanel, PanelTitle, Text, Caption, Badge } from '@/components/ui'
import { DateTime } from '@/components/data-display'
import { Skeleton, QueryError } from '@/components/feedback'

export function IncidentHistory() {
  const { t } = useTranslation()
  const { data, isLoading, error, refetch } = useIncidents({ limit: 10 })
  const incidents = data?.incidents ?? []

  return (
    <GlassPanel className="p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-2">
        <CalendarDays className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden />
        <PanelTitle>{t('systemStatus.incidentHistory.title', 'Recent incidents')}</PanelTitle>
      </div>
      <Caption className="mb-4 block">
        {t('systemStatus.incidentHistory.scope', 'Recorded incidents only; no uptime percentage is inferred from missing monitoring data.')}
      </Caption>
      {isLoading && !data ? (
        <div role="status" aria-label={t('systemStatus.incidentHistory.loading', 'Loading incident history')}>
          <Skeleton className="h-16" />
        </div>
      ) : error ? (
        <QueryError error={error} onRetry={() => refetch()} />
      ) : incidents.length === 0 ? (
        <Text as="p" variant="bodySm">
          {t('systemStatus.incidentHistory.empty', 'No incidents recorded. This does not establish historical uptime.')}
        </Text>
      ) : (
        <ul className="divide-y divide-[var(--glass-border)]">
          {incidents.map((incident) => (
            <li key={incident.id}>
              <Link
                to={`/system-status/incidents/${incident.id}`}
                className="flex min-w-0 items-center gap-3 rounded-md py-3 hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
              >
                <div className="min-w-0 flex-1">
                  <Text as="span" variant="bodySm" weight="medium" className="block truncate">
                    {incident.title || t('systemStatus.incidentHistory.untitled', 'Untitled incident')}
                  </Text>
                  <Caption className="block">
                    <DateTime value={incident.started_at} in="utc" />
                    {' · '}{(incident.affected_components ?? []).join(', ') || t('systemStatus.incidentHistory.unspecified', 'Component not specified')}
                  </Caption>
                </div>
                <Badge variant={incident.status === 'resolved' ? 'success' : 'warning'} size="sm">
                  {incident.status}
                </Badge>
                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </GlassPanel>
  )
}
