import { useTranslation } from 'react-i18next'

import { MetricBar } from '@/components/data-display'
import { fmtInt, fmtPercent } from '@/lib/numberFormat'
import type { FeedbackCategory } from '@/api/types'

import { CATEGORY_COLORS, type FeedbackCounts } from './constants'

/** Fixed display order — bug first (most actionable), then feature, then other. */
const ORDER: readonly FeedbackCategory[] = ['bug', 'feature', 'other']

/** Bug / feature / other proportion bars. */
export function CategoryMix({ counts }: { counts: FeedbackCounts }) {
  const { t } = useTranslation()
  const label: Record<FeedbackCategory, string> = {
    bug: t('feedback.category.bug', 'Bug report'),
    feature: t('feedback.category.feature', 'Feature request'),
    other: t('feedback.category.other', 'Other / question'),
  }
  // Percentages are relative to the CATEGORY total only — the same
  // `FeedbackCounts` bag also carries status facets that must not dilute it.
  const catTotal = ORDER.reduce((sum, key) => sum + (counts[key] ?? 0), 0)
  return (
    <div
      className="space-y-3"
      role="list"
      aria-label={t('feedback.category.mixLabel', 'Feedback category mix')}
    >
      {ORDER.map((key) => {
        const count = counts[key] ?? 0
        const pct = catTotal > 0 ? (count / catTotal) * 100 : 0
        return (
          <div key={key} role="listitem">
            <MetricBar
              label={label[key]}
              value={count}
              max={catTotal || 1}
              color={CATEGORY_COLORS[key]}
              sublabel={`${fmtInt(count)} · ${fmtPercent(pct, 0)}`}
            />
          </div>
        )
      })}
    </div>
  )
}
