import type { FeedbackCategory, FeedbackStatus } from '@/api/types'
import { COLOR, DATA_VISUAL_COLORS, CHART_NEUTRAL } from '@/lib/colors'

/**
 * Segment colours for the status-distribution bar + category-mix bars.
 *
 * Toned hues that echo each Badge variant; consumed as dynamic (non-var)
 * inline fills so they stay out of the static-CSS-var guardian check.
 *
 * These MUST stay 6-digit hex (`#rrggbb`): `MetricBar` (reached via
 * `CategoryMix`) appends an alpha channel by string concatenation
 * (`` `${color}99` ``), which only produces a valid colour when the base is
 * six hex digits. Frozen so the shared palette can't be mutated in place by a
 * consumer that reads from it.
 */
export const STATUS_COLORS: Record<FeedbackStatus, string> = Object.freeze({
  new: COLOR.WARN,
  triaged: COLOR.GOOD,
  closed: CHART_NEUTRAL,
})

export const CATEGORY_COLORS: Record<FeedbackCategory, string> = Object.freeze({
  bug: COLOR.BAD,
  feature: DATA_VISUAL_COLORS.info,
  other: DATA_VISUAL_COLORS.purple,
})

/** Whole-queue facet counts (status + category). A value may be `undefined`
 *  while its count query is still loading. */
export type FeedbackCounts = Partial<Record<FeedbackStatus | FeedbackCategory, number | undefined>>
