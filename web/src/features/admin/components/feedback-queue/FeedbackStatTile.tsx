import { type ReactNode } from 'react'

import { MetricCard } from '@/components/data-display'
import { Skeleton } from '@/components/feedback'
import { fmtInt } from '@/lib/numberFormat'
import { type NeonColor } from '@/lib/tokens'

interface FeedbackStatTileProps {
  label: string
  icon: ReactNode
  color: NeonColor
  value: number | undefined
  loading: boolean
}

/** A single KPI tile — a `MetricCard`, or a card-shaped `Skeleton` while its
 *  whole-queue count is still loading. */
export function FeedbackStatTile({ label, icon, color, value, loading }: FeedbackStatTileProps) {
  if (loading || value === undefined) {
    return <Skeleton height={74} className="rounded-xl" />
  }
  return <MetricCard label={label} value={fmtInt(value)} icon={icon} color={color} />
}
