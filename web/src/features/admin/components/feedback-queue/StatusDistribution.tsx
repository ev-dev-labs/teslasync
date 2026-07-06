import { useTranslation } from 'react-i18next'

import { Caption, Text } from '@/components/ui'
import { fmtInt, fmtPercent } from '@/lib/numberFormat'
import type { FeedbackStatus } from '@/api/types'

import { STATUS_COLORS, type FeedbackCounts } from './constants'

/** Fixed display order — active work first: new → triaged → closed. */
const ORDER: readonly FeedbackStatus[] = ['new', 'triaged', 'closed']

/** Proportional new / triaged / closed bar + a labelled legend with counts. */
export function StatusDistribution({ counts, total }: { counts: FeedbackCounts; total: number }) {
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
    <div className="space-y-4">
      <div
        role="img"
        aria-label={t(
          'feedback.queue.distAria',
          'Status distribution: {{new}} new, {{triaged}} triaged, {{closed}} closed',
          { new: counts.new ?? 0, triaged: counts.triaged ?? 0, closed: counts.closed ?? 0 },
        )}
        className="flex h-8 w-full overflow-hidden rounded-full bg-[var(--surface-2)]"
      >
        {segments.map((seg) =>
          seg.pct < 0.3 ? null : (
            <div
              key={seg.key}
              className="h-full transition-all"
              style={{ width: `${seg.pct}%`, backgroundColor: seg.color }}
              title={`${seg.label}: ${fmtInt(seg.count)} (${fmtPercent(seg.pct, 0)})`}
            />
          ),
        )}
      </div>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {segments.map((seg) => (
          <li key={seg.key} className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: seg.color }}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1">
              <Text as="span" variant="bodySm" className="block truncate">{seg.label}</Text>
              <Caption>{fmtInt(seg.count)} · {fmtPercent(seg.pct, 0)}</Caption>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
