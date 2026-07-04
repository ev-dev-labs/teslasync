import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui'
import type { FeedbackStatus } from '@/api/types'

type BadgeVariant = 'success' | 'warning' | 'neutral'

// Status → Badge variant is static: it never depends on props, so it lives at
// module scope to avoid re-allocating the record on every render and to give
// the fail-closed lookup below a single source of truth for known statuses.
const STATUS_VARIANT: Record<FeedbackStatus, BadgeVariant> = {
  new: 'warning',
  triaged: 'success',
  closed: 'neutral',
}

export function StatusBadge({ status }: { status: FeedbackStatus }) {
  const { t } = useTranslation()
  const label: Record<FeedbackStatus, string> = {
    new: t('feedback.queue.status.new', 'New'),
    triaged: t('feedback.queue.status.triaged', 'Triaged'),
    closed: t('feedback.queue.status.closed', 'Closed'),
  }
  // Fail closed if the backend ever sends a status outside the known union (e.g.
  // a newer server enum reaching the SPA before the types catch up). Without
  // this guard `variant[status]` / `label[status]` are undefined, so the chip
  // renders empty and colourless — silently hiding the row's status. We keep the
  // neutral variant but surface an explicit "Unknown" label rather than reusing
  // "Closed": an unrecognised (and possibly still-active) status must never be
  // masked as a terminal one.
  const variant = STATUS_VARIANT[status] ?? 'neutral'
  const text = label[status] ?? t('feedback.queue.status.unknown', 'Unknown')
  return <Badge variant={variant}>{text}</Badge>
}
