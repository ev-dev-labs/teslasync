import { type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { MetricCard } from '@/components/data-display'
import { Skeleton } from '@/components/feedback'
import { isFiniteNumber } from '@/lib/numberFormat'
import { type NeonColor } from '@/lib/tokens'
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface FeedbackStatTileProps {
  label: string
  icon: ReactNode
  color: NeonColor
  value: number | undefined
  loading: boolean
  /** Source resolved without a usable count; not an indefinitely busy load. */
  unknown?: boolean
}

/** A single KPI tile — a `MetricCard`, or a card-shaped `Skeleton` while its
 *  whole-queue count is still loading.
 *
 *  The placeholder is a labelled `role="status"` live region (mirroring the
 *  sibling `BridgeStatus`) so assistive tech announces the in-flight load
 *  instead of meeting a silent, unlabelled pulsing box. The guard uses
 *  `isFiniteNumber` rather than a bare `=== undefined` check so a
 *  `null`/`NaN`/`Infinity` slipping through untyped API data resolves to the
 *  placeholder instead of a fabricated "0" — while a genuine `0` count (which
 * is falsy but valid) still renders its card. Explicit unknown source outcomes
 * keep the metric label with an em dash instead of an indefinitely busy load. */
export function FeedbackStatTile({ label, icon, color, value, loading, unknown = false }: FeedbackStatTileProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation()
  if (loading || (!unknown && !isFiniteNumber(value))) {
    return (
      <div role="status" aria-busy="true" aria-label={t('common.loading', 'Loading…')}>
        <Skeleton height={74} className="rounded-xl" />
      </div>
    )
  }
  return <MetricCard label={label} value={isFiniteNumber(value) ? fmtInt(value) : '—'} icon={icon} color={color} />
}
