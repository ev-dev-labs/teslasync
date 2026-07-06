import { type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { MetricCard } from '@/components/data-display'
import { Skeleton } from '@/components/feedback'
import { fmtInt, isFiniteNumber } from '@/lib/numberFormat'
import { type NeonColor } from '@/lib/tokens'

interface FeedbackStatTileProps {
  label: string
  icon: ReactNode
  color: NeonColor
  value: number | undefined
  loading: boolean
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
 *  is falsy but valid) still renders its card. */
export function FeedbackStatTile({ label, icon, color, value, loading }: FeedbackStatTileProps) {
  const { t } = useTranslation()
  if (loading || !isFiniteNumber(value)) {
    return (
      <div role="status" aria-busy="true" aria-label={t('common.loading', 'Loading…')}>
        <Skeleton height={74} className="rounded-xl" />
      </div>
    )
  }
  return <MetricCard label={label} value={fmtInt(value)} icon={icon} color={color} />
}
