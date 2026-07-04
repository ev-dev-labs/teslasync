import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui'
import type { FeedbackCategory } from '@/api/types'

type BadgeVariant = 'danger' | 'info' | 'neutral'

// Category → Badge variant is static: it never depends on props, so it lives at
// module scope to avoid re-allocating the record on every render and to give
// the fail-closed lookup below a single source of truth for known categories.
const CATEGORY_VARIANT: Record<FeedbackCategory, BadgeVariant> = {
  bug: 'danger',
  feature: 'info',
  other: 'neutral',
}

export function CategoryBadge({ category }: { category: FeedbackCategory }) {
  const { t } = useTranslation()
  const label: Record<FeedbackCategory, string> = {
    bug: t('feedback.category.bug', 'Bug report'),
    feature: t('feedback.category.feature', 'Feature request'),
    other: t('feedback.category.other', 'Other / question'),
  }
  // Fail closed to the neutral "other" presentation if the backend ever sends a
  // category outside the known union (e.g. a newer server enum reaching the SPA
  // before the types catch up). Without this guard the chip would render empty
  // and colourless, silently hiding the row's category instead of surfacing it.
  const variant = CATEGORY_VARIANT[category] ?? 'neutral'
  const text = label[category] ?? label.other
  return <Badge variant={variant}>{text}</Badge>
}
