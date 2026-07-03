import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui'
import type { FeedbackCategory } from '@/api/types'

export function CategoryBadge({ category }: { category: FeedbackCategory }) {
  const { t } = useTranslation()
  const variant: Record<FeedbackCategory, 'danger' | 'info' | 'neutral'> = {
    bug: 'danger',
    feature: 'info',
    other: 'neutral',
  }
  const label: Record<FeedbackCategory, string> = {
    bug: t('feedback.category.bug', 'Bug report'),
    feature: t('feedback.category.feature', 'Feature request'),
    other: t('feedback.category.other', 'Other / question'),
  }
  return <Badge variant={variant[category]}>{label[category]}</Badge>
}
