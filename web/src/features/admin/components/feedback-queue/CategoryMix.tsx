import { useTranslation } from 'react-i18next'

import { MetricBar } from '@/components/data-display'
import { fmtInt, fmtPercent } from '@/lib/numberFormat'
import type { FeedbackCategory } from '@/api/types'

import { CATEGORY_COLORS, type FeedbackCounts } from './constants'

/** Bug / feature / other proportion bars. */
export function CategoryMix({ counts }: { counts: FeedbackCounts }) {
  const { t } = useTranslation()
  const label: Record<FeedbackCategory, string> = {
    bug: t('feedback.category.bug', 'Bug report'),
    feature: t('feedback.category.feature', 'Feature request'),
    other: t('feedback.category.other', 'Other / question'),
  }
  const order: FeedbackCategory[] = ['bug', 'feature', 'other']
  const catTotal = order.reduce((s, k) => s + (counts[k] ?? 0), 0)
  return (
    <div className="space-y-3">
      {order.map((key) => {
        const count = counts[key] ?? 0
        const pct = catTotal > 0 ? (count / catTotal) * 100 : 0
        return (
          <MetricBar
            key={key}
            label={label[key]}
            value={count}
            max={catTotal || 1}
            color={CATEGORY_COLORS[key]}
            sublabel={`${fmtInt(count)} · ${fmtPercent(pct, 0)}`}
          />
        )
      })}
    </div>
  )
}
