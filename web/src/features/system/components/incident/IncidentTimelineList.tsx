/**
 * Chronological (newest-first) list of incident timeline updates. Renders its
 * own empty state so the surrounding panel stays visible when an incident has
 * no updates yet.
 */
import { MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge, Text, Caption } from '@/components/ui'
import { EmptyState } from '@/components/feedback'
import { useDateFormat } from '@/hooks/useDateFormat'
import { type IncidentUpdateEntry } from '@/api/hooks/useIncidents'
import { STATUS_BADGE, useIncidentStatusLabel } from './incidentPresentation'

interface IncidentTimelineListProps {
  /** Already reversed (newest-first) update entries. */
  updates: IncidentUpdateEntry[]
}

export function IncidentTimelineList({ updates }: IncidentTimelineListProps) {
  const { t } = useTranslation()
  const { formatDateTime: fmtAbs } = useDateFormat()
  const statusLabel = useIncidentStatusLabel()

  // Defensive: the sole caller memoises a reversed array, but a null/undefined
  // prop (bad data, direct misuse) must degrade to the empty state, never crash
  // on `.length`/`.map`.
  const items = updates ?? []

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<MessageSquare className="h-8 w-8" aria-hidden="true" />}
        message={t('incidentTimeline.noUpdates', 'No updates recorded yet.')}
      />
    )
  }

  return (
    <ul className="space-y-3" aria-label={t('incidentTimeline.updatesLabel', 'Incident updates')}>
      {items.map((u, idx) => (
        <li key={`${u.at}-${idx}`} className="flex gap-3 border-l-2 border-[var(--border-subtle)] pl-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={STATUS_BADGE[u.status] ?? 'neutral'} size="sm">{statusLabel(u.status)}</Badge>
              <Caption>{fmtAbs(u.at)}</Caption>
              {u.author ? <Caption>· {u.author}</Caption> : null}
            </div>
            <Text as="p" variant="body" className="mt-1 whitespace-pre-wrap">{u.message ?? ''}</Text>
          </div>
        </li>
      ))}
    </ul>
  )
}
