import type { FeedbackCategory, FeedbackStatus } from '@/api/types'

/** Segment colors for the status-distribution bar + category-mix bars.
 *  Toned hues that match each Badge variant; used as dynamic (non-var) inline
 *  fills so they stay out of the static-CSS-var guardian check. */
export const STATUS_COLORS: Record<FeedbackStatus, string> = {
  new: '#f59e0b',
  triaged: '#10b981',
  closed: '#64748b',
}

export const CATEGORY_COLORS: Record<FeedbackCategory, string> = {
  bug: '#f43f5e',
  feature: '#22d3ee',
  other: '#a78bfa',
}

/** Whole-queue facet counts (status + category). A value may be `undefined`
 *  while its count query is still loading. */
export type FeedbackCounts = Partial<Record<FeedbackStatus | FeedbackCategory, number | undefined>>
