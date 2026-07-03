import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui'
import type { FeedbackStatus } from '@/api/types'

export function StatusBadge({ status }: { status: FeedbackStatus }) {
  const { t } = useTranslation()
  const variant: Record<FeedbackStatus, 'success' | 'warning' | 'neutral'> = {
    new: 'warning',
    triaged: 'success',
    closed: 'neutral',
  }
  const label: Record<FeedbackStatus, string> = {
    new: t('feedback.queue.status.new', 'New'),
    triaged: t('feedback.queue.status.triaged', 'Triaged'),
    closed: t('feedback.queue.status.closed', 'Closed'),
  }
  return <Badge variant={variant[status]}>{label[status]}</Badge>
}
