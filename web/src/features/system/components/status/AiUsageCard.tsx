/**
 * AiUsageCard — operator-grade per-call AI spend & volume detail card.
 *
 * Phase-50 / 0004 — F3 AI Call Log + Usage Card.
 *
 * Mirrors the visual contract of `TeslaApiUsageCard` by feeding the
 * shared `<UsageCard>` primitive in components/data-display. The
 * interesting difference is the data source: instead of a Tesla
 * Fleet API counter, this card reads the per-call audit log written
 * by the `WithAudit` provider decorator in F3.
 *
 * Off-mode behaviour (ADR-015 §I4):
 *
 *   - When `ai_mode === 'off'` the component returns `null`, so the
 *     `data-ai-feature` marker never enters the DOM. We hand-roll the
 *     gate (instead of using `withAiFeature('__usage__')`) because
 *     `__usage__` is a server-side meta feature: it is gated only on
 *     `ai_mode != 'off'` and intentionally has no per-feature toggle.
 *     The `useAiEnabled` hook (which `withAiFeature` wraps) requires
 *     `settings.ai_features['__usage__'] === true`, which would never
 *     flip on. The inline gate keeps the F0 invariant (no AI surfaces
 *     in off mode) while honouring the special-case spec.
 *
 *   - The data-ai-feature="__usage__" + data-testid="ai-feature-usage"
 *     attributes are still emitted when the gate is open so the
 *     existing off-mode invariant tests can locate the surface.
 */

import { useMemo } from 'react'
import { Activity, Clock, Cpu, Zap } from 'lucide-react'
import { useSettings } from '@/hooks/useSettings'
import { useFormatting } from '@/hooks/useFormatting'
import {
  UsageCard,
  type UsageCardBand,
  type UsageCardDetail,
  type UsageCardIntent,
  type UsageCardTopList,
  type UsageCardTopListItem,
} from '@/components/data-display'
import {
  useAiUsageToday,
  useAiUsageByFeature,
  useAiUsageRecent,
  type AiUsageRecentRow,
} from '@/api/hooks/useAiUsage'
import { fmtInt } from '@/lib/numberFormat'

/** Feature ID this card represents. Keep in sync with registry. */
export const AI_USAGE_FEATURE_ID = '__usage__' as const
const AI_USAGE_TEST_ID = 'ai-feature-usage'

function fmtCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return fmtInt(n)
}

function microCentsToDollars(mc: number | null | undefined): number {
  if (mc == null || !Number.isFinite(mc)) return 0
  // 1 cent = 10_000 micro-cents → 1 dollar = 1_000_000 micro-cents.
  return mc / 1_000_000
}

function formatRelativeTime(iso: string, now: number): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  const ageMs = now - t
  if (ageMs < 60_000) return `${Math.max(0, Math.round(ageMs / 1000))}s ago`
  if (ageMs < 3_600_000) return `${Math.round(ageMs / 60_000)}m ago`
  if (ageMs < 86_400_000) return `${Math.round(ageMs / 3_600_000)}h ago`
  return `${Math.round(ageMs / 86_400_000)}d ago`
}

function summarizeRecentRow(row: AiUsageRecentRow, now: number): string {
  const tokens = row.input_tokens + row.output_tokens
  const tokenStr = tokens > 0 ? `${fmtInt(tokens)} tok` : '0 tok'
  return `${row.feature_id} · ${row.model} · ${tokenStr} · ${formatRelativeTime(row.started_at, now)}`
}

/**
 * Inner component — assumes the gate has already opened. Keeps the
 * gate logic out of the data-fetching path so unit tests can render
 * this directly without mocking the settings hook.
 */
export function AiUsageCardInner() {
  const { formatCurrency } = useFormatting()
  const todayQuery = useAiUsageToday()
  const byFeatureQuery = useAiUsageByFeature()
  const recentQuery = useAiUsageRecent(10)

  const isLoading =
    todayQuery.isLoading || byFeatureQuery.isLoading || recentQuery.isLoading
  const today = todayQuery.data
  const byFeature = byFeatureQuery.data?.rows ?? []
  const recent = recentQuery.data?.rows ?? []

  // Stable "now" for relative-time labels in this render. Recomputed
  // every time React re-renders on a query-cache update, which is
  // sufficient — these labels are coarse (seconds / minutes / hours).
  const now = useMemo(() => Date.now(), [today, byFeature, recent])

  if (isLoading && !today) {
    return (
      <div
        data-ai-feature={AI_USAGE_FEATURE_ID}
        data-testid={AI_USAGE_TEST_ID}
      >
        <UsageCard emptyMessage="Loading Helix usage…" />
      </div>
    )
  }

  if (!today || today.call_count === 0) {
    return (
      <div
        data-ai-feature={AI_USAGE_FEATURE_ID}
        data-testid={AI_USAGE_TEST_ID}
      >
        <UsageCard emptyMessage="No Helix calls yet — turn on a feature to start." />
      </div>
    )
  }

  const totalTokens = today.input_tokens + today.output_tokens
  const todayCost = microCentsToDollars(today.cost_micro_cents)

  const errorIntent: UsageCardIntent =
    today.error_count > 0 && today.call_count > 0
      ? today.error_count / today.call_count >= 0.05
        ? 'danger'
        : 'warn'
      : 'normal'

  const bands: UsageCardBand[] = [
    {
      icon: <Activity className="h-3.5 w-3.5" />,
      label: 'Today',
      value: (
        <>
          {fmtCount(today.call_count)}{' '}
          <span className="text-xs font-normal text-[var(--text-muted)]">calls</span>
        </>
      ),
      sub: `${fmtCount(today.error_count)} error${today.error_count === 1 ? '' : 's'}`,
      intent: errorIntent,
    },
    {
      icon: <Cpu className="h-3.5 w-3.5" />,
      label: 'Tokens',
      value: (
        <>
          {fmtCount(totalTokens)}{' '}
          <span className="text-xs font-normal text-[var(--text-muted)]">total</span>
        </>
      ),
      sub: `${fmtCount(today.input_tokens)} in · ${fmtCount(today.output_tokens)} out`,
    },
    {
      icon: <Clock className="h-3.5 w-3.5" />,
      label: 'Cost / latency',
      value: formatCurrency(todayCost),
      sub: `${Math.round(today.avg_latency_ms)} ms avg`,
    },
  ]

  const details: UsageCardDetail[] = [
    {
      label: 'Avg latency',
      value: `${Math.round(today.avg_latency_ms)} ms`,
    },
    {
      label: 'Errors',
      value: fmtCount(today.error_count),
      intent: today.error_count > 0 ? 'danger' : 'normal',
    },
    {
      label: 'Input tokens',
      value: fmtCount(today.input_tokens),
    },
    {
      label: 'Output tokens',
      value: fmtCount(today.output_tokens),
    },
  ]

  const topLists: UsageCardTopList[] = []

  if (byFeature.length > 0) {
    const topFeatures = [...byFeature]
      .sort((a, b) => b.call_count - a.call_count)
      .slice(0, 5)
    topLists.push({
      key: 'features',
      icon: <Zap className="h-3.5 w-3.5" />,
      title: 'By feature (7 days)',
      items: topFeatures.map<UsageCardTopListItem>((f) => ({
        key: f.feature_id,
        label: f.feature_id,
        value: fmtCount(f.call_count),
      })),
    })
  }

  if (recent.length > 0) {
    topLists.push({
      key: 'recent',
      icon: <Clock className="h-3.5 w-3.5" />,
      title: 'Recent calls',
      items: recent.slice(0, 5).map<UsageCardTopListItem>((r) => ({
        key: String(r.id),
        label: summarizeRecentRow(r, now),
        value: r.error ? '✗' : '✓',
      })),
    })
  }

  return (
    <div data-ai-feature={AI_USAGE_FEATURE_ID} data-testid={AI_USAGE_TEST_ID}>
      <UsageCard bands={bands} details={details} topLists={topLists} />
    </div>
  )
}

/**
 * Public wrapper — gates rendering on `ai_mode != 'off'`. Returns
 * `null` (and therefore emits no AI marker) when AI is fully off,
 * preserving ADR-015 §I4.
 */
export function AiUsageCard() {
  const { settings } = useSettings()
  if (!settings) return null
  if (settings.ai_mode === undefined || settings.ai_mode === 'off') return null
  return <AiUsageCardInner />
}
