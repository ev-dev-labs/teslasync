import { useTranslation } from 'react-i18next'

import { CompositionRail } from '@/components/data-display'

import type { FeedbackStatus } from '@/api/types'

import { STATUS_COLORS, type FeedbackCounts } from './constants'
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

/** Fixed display order — active work first: new → triaged → closed. */
const ORDER: readonly FeedbackStatus[] = ['new', 'triaged', 'closed']

/** Proportional new / triaged / closed bar + a labelled legend with counts. */
export function StatusDistribution({ counts, total }: { counts: FeedbackCounts; total: number }) {
  const { fmtInt, fmtPercent } = useNumberFormatting();
  const { t } = useTranslation()
  const label: Record<FeedbackStatus, string> = {
    new: t('feedback.queue.status.new', 'New'),
    triaged: t('feedback.queue.status.triaged', 'Triaged'),
    closed: t('feedback.queue.status.closed', 'Closed'),
  }
  const segments = ORDER.map((key) => {
    const count = counts[key] ?? 0
    // Percentage is relative to the caller-supplied status total. Clamp to
    // [0, 100] so a stale/degenerate `total` (smaller than a facet count)
    // can never overflow the flex track or surface a ">100%" legend reading.
    // For a consistent total (the sole caller passes the exact sum) this is a
    // no-op.
    const raw = total > 0 ? (count / total) * 100 : 0
    const pct = Math.min(100, Math.max(0, raw))
    return { key, label: label[key], count, color: STATUS_COLORS[key], pct }
  })

  return (
    <CompositionRail
      size="lg"
      summary={t(
          'feedback.queue.distAria',
          'Status distribution: {{new}} new, {{triaged}} triaged, {{closed}} closed',
          { new: counts.new ?? 0, triaged: counts.triaged ?? 0, closed: counts.closed ?? 0 },
      )}
      segments={segments.map((seg) => ({
        id: seg.key,
        label: seg.label,
        widthPercent: seg.pct,
        color: seg.color,
        hideFromTrack: seg.pct < 0.3,
        detail: (
          <span title={`${seg.label}: ${fmtInt(seg.count)} (${fmtPercent(seg.pct)})`}>
            {fmtInt(seg.count)} · {fmtPercent(seg.pct)}
          </span>
        ),
      }))}
    />
  )
}
