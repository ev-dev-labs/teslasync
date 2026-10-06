/**
 * Chronological (newest-first) list of incident timeline updates. Renders its
 * own empty state so the surrounding panel stays visible when an incident has
 * no updates yet.
 */
import { MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge, Caption } from '@/components/ui'
import { Timeline } from '@/components/data-display'
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
  const oldestAt = items[items.length - 1]?.at
  const newestAt = items[0]?.at

  if (items.length === 0) {
    return (
      // no-action: the trigger surface is the adjacent "Post an update" form in the sibling panel on this page.
      <EmptyState
        icon={<MessageSquare className="h-8 w-8" aria-hidden="true" />}
        message={t('incidentTimeline.noUpdates', 'No updates recorded yet.')}
      />
    )
  }

  return (
    <Timeline
      label={t('incidentTimeline.updatesLabel', 'Incident updates')}
      chronology="newest-first"
      summaryBounds={{
        start: oldestAt && Number.isFinite(Date.parse(oldestAt)) ? fmtAbs(oldestAt) : null,
        end: newestAt && Number.isFinite(Date.parse(newestAt)) ? fmtAbs(newestAt) : null,
      }}
      items={items.map((update) => ({
        time: fmtAbs(update.at),
        title: (
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={STATUS_BADGE[update.status] ?? 'neutral'} size="sm">{statusLabel(update.status)}</Badge>
            {update.author ? <Caption as="span">· {update.author}</Caption> : null}
          </span>
        ),
        subtitle: <span className="block whitespace-pre-wrap break-words">{update.message ?? ''}</span>,
      }))}
    />
  )
}
