// Inbox auto-categorization AI panel.
//
// Wiring contract:
//   - useAiStream targets POST /ai/alerts/inbox/categorize.
//   - The primary action button is disabled from stream state, never by a
//     literal `disabled` or `disabled={true}`.
//   - tool_result frames are captured in component state; "Apply categories as
//     filter" only calls the parent with proposed rule_ids. The AI panel never
//     persists state directly.
//   - cancel() runs on unmount and whenever the inbox scope changes.
//   - withAiFeature hides the component when AI mode or the feature toggle is off.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { Button } from '@/components/ui'
import type { AiStreamEvent } from '@/hooks/useAiStream'
import { useAiStream } from '@/hooks/useAiStream'

// CategoryBucket is the typed shape of one element in the
// `draft_alert_categories` tool's `categories` array. Mirrors
// internal/ai/tools/inbox_auto_categorization.go CategoryBucket
// — keeping the shape narrow here protects the SPA from blindly
// trusting any field the LLM might emit.
export interface CategoryBucket {
  category: string
  count: number
  rule_ids?: number[]
  sample_titles?: string[]
}

export interface AIInboxAutoCategorizationProps {
  /**
   * Optional vehicle scope. Forwarded as `vehicle_id` in the
   * request body when non-null. Omitted when null/undefined so
   * the LLM categorizes the entire inbox.
   */
  vehicleId?: number | null
  /**
   * Optional severity filter. When non-empty the values are
   * forwarded as `severities` in the request body. Empty array
   * is omitted entirely so the backend's default (all severities)
   * applies.
   */
  severities?: string[]
  /**
   * Optional rule filter. When non-empty the values are forwarded
   * as `rule_ids`. Empty array is omitted.
   */
  ruleIds?: number[]
  /**
   * Optional inbox window in days. Forwarded as `window_days`.
   * Omitted when null/undefined so the backend's default (7 days)
   * applies.
   */
  windowDays?: number | null
  /**
   * Called when the user clicks "Apply categories as filter" on a
   * captured proposal. The parent (InboxBody) merges the rule_id
   * list into the URL-backed NotificationFilterBar state. The AI
   * panel never writes to the API directly — the user simply
   * narrows the deterministic baseline list.
   */
  onApplyCategories: (ruleIds: number[]) => void
}

function InnerSection({
  vehicleId,
  severities,
  ruleIds,
  windowDays,
  onApplyCategories,
}: AIInboxAutoCategorizationProps) {
  const { t } = useTranslation()
  const [proposal, setProposal] = useState<CategoryBucket[] | null>(null)

  // Body is memoised so useAiStream's deps are stable until the
  // scope inputs actually change. We only emit fields that have a
  // value — empty severities / empty ruleIds / null vehicleId are
  // dropped to match the backend handler's optional-field contract.
  const body = useMemo(() => {
    const out: Record<string, unknown> = {}
    if (vehicleId != null) {
      out.vehicle_id = vehicleId
    }
    if (windowDays != null) {
      out.window_days = windowDays
    }
    if (severities && severities.length > 0) {
      out.severities = severities
    }
    if (ruleIds && ruleIds.length > 0) {
      out.rule_ids = ruleIds
    }
    return out
  }, [vehicleId, windowDays, severities, ruleIds])

  const handleEvent = useCallback((ev: AiStreamEvent) => {
    if (ev.type === 'tool_result' && ev.name === 'draft_alert_categories' && ev.ok) {
      const data = ev.data as
        | { status?: string; categories?: unknown }
        | undefined
      if (!data || data.status !== 'ok' || !Array.isArray(data.categories)) {
        return
      }
      const buckets: CategoryBucket[] = []
      for (const raw of data.categories) {
        if (raw == null || typeof raw !== 'object') {
          continue
        }
        const r = raw as Record<string, unknown>
        if (typeof r.category !== 'string' || r.category === '') {
          continue
        }
        if (typeof r.count !== 'number' || r.count < 0) {
          continue
        }
        const bucket: CategoryBucket = {
          category: r.category,
          count: r.count,
        }
        if (Array.isArray(r.rule_ids)) {
          const ids: number[] = []
          for (const v of r.rule_ids) {
            if (typeof v === 'number' && v > 0) {
              ids.push(v)
            }
          }
          if (ids.length > 0) {
            bucket.rule_ids = ids
          }
        }
        if (Array.isArray(r.sample_titles)) {
          const titles: string[] = []
          for (const v of r.sample_titles) {
            if (typeof v === 'string' && v !== '') {
              titles.push(v)
            }
          }
          if (titles.length > 0) {
            bucket.sample_titles = titles
          }
        }
        buckets.push(bucket)
      }
      if (buckets.length > 0) {
        setProposal(buckets)
      }
    }
  }, [])

  // Stable content keys used both as the stream's scopeKey and by the
  // local proposal-clearing cleanup below. Keyed on CONTENT, not
  // array *reference*: parents routinely pass a freshly built array
  // on every render (e.g. `severities={filters.severities}` or
  // `ruleIds={selected.map(...)}`). Depending on the raw arrays would
  // treat every unrelated parent re-render as a scope change. Mirrors
  // the ruleIdsKey pattern in AICrossRuleConflictDetection.
  const severitiesKey = useMemo(
    () => (severities ?? []).join(','),
    [severities],
  )
  const ruleIdsKey = useMemo(() => (ruleIds ?? []).join(','), [ruleIds])

  const stream = useAiStream({
    url: '/ai/alerts/inbox/categorize',
    body,
    onEvent: handleEvent,
    // AI-01: the inbox filter scope (vehicle + window + severities +
    // rule ids) is part of stream identity — changing any of them
    // aborts an in-flight categorization and clears the stream's own
    // completed output in addition to the local `proposal` state
    // cleared below.
    scopeKey: `${vehicleId ?? ''}:${windowDays ?? ''}:${severitiesKey}:${ruleIdsKey}`,
  })

  // Pull cancel out so the cleanup effect's deps stay narrow.
  // The hook returns a stable cancel reference (useCallback with
  // [] deps), so destructuring here keeps the effect dep list
  // tight. Including the whole stream object would re-run the
  // cleanup on every internal state tick of useAiStream and wipe
  // the captured proposal mid-stream.
  const { cancel: cancelStream } = stream

  // Reset the locally-captured proposal whenever the inbox scope
  // changes so a stale proposal from a previous filter cannot bleed
  // into the current view. The stream's own text/activity/usage
  // reset is now handled by useAiStream's scopeKey above;
  // cancelStream() here only covers unmount.
  useEffect(() => {
    return () => {
      cancelStream()
      setProposal(null)
    }
  }, [vehicleId, windowDays, severitiesKey, ruleIdsKey, cancelStream])

  const isBusy = stream.state === 'streaming' || stream.state === 'paused-confirm'

  const handleCategorize = useCallback(() => {
    if (isBusy) {
      return // double-submit no-op
    }
    setProposal(null)
    stream.start()
  }, [isBusy, stream])

  // The "Apply" button gathers every rule_id across every
  // category bucket. Filtering by rule_id list is the canonical
  // baseline narrowing mechanism in NotificationFilterBar.
  const allRuleIds = useMemo(() => {
    if (!proposal || proposal.length === 0) {
      return [] as number[]
    }
    const seen = new Set<number>()
    for (const bucket of proposal) {
      if (!bucket.rule_ids) {
        continue
      }
      for (const id of bucket.rule_ids) {
        seen.add(id)
      }
    }
    return Array.from(seen).sort((a, b) => a - b)
  }, [proposal])

  const handleApply = useCallback(() => {
    if (allRuleIds.length === 0) {
      return
    }
    onApplyCategories(allRuleIds)
  }, [allRuleIds, onApplyCategories])

  const applyDisabled = allRuleIds.length === 0 || isBusy

  return (
    <AIFeatureCard
      title={t(
        'notifications.inbox.aiCategorize.title',
        'Suggest inbox categories',
      )}
      description={t(
        'notifications.inbox.aiCategorize.description',
        'Bucket recent alerts into categories from your inbox history. Descriptive replay only — review before applying.',
      )}
      buttonLabel={t(
        'notifications.inbox.aiCategorize.suggestButton',
        'Suggest categories',
      )}
      badgeLabel={t('notifications.inbox.aiCategorize.badge', 'Helix')}
      canStart={stream.state !== 'paused-confirm'}
      stream={stream}
      onAction={handleCategorize}
      buttonPlacement="below"
      buttonTestId="ai-feature-inbox-auto-categorization-categorize"
    >
      {proposal && proposal.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={applyDisabled}
              aria-disabled={applyDisabled ? 'true' : 'false'}
              onClick={handleApply}
              data-testid="ai-feature-inbox-auto-categorization-apply"
            >
              {t(
                'notifications.inbox.aiCategorize.applyButton',
                'Apply categories as filter',
              )}
            </Button>
          </div>
          <div className="rounded-md border border-emerald-300/30 bg-emerald-300/5 p-3 text-sm text-emerald-300">
            <div className="font-medium">
              {t(
                'notifications.inbox.aiCategorize.previewLabel',
                'Proposed categories (review before applying):',
              )}
            </div>
            <ul className="mt-2 flex flex-wrap gap-2">
              {proposal.map((bucket) => (
                <li
                  key={bucket.category}
                  className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/30 bg-emerald-300/10 px-2.5 py-1 text-xs font-medium text-emerald-300"
                  data-testid={`ai-feature-inbox-auto-categorization-bucket-${bucket.category}`}
                >
                  <span>{bucket.category}</span>
                  <span className="text-emerald-300/70" aria-hidden="true">
                    ·
                  </span>
                  <span>{bucket.count}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </AIFeatureCard>
  )
}
InnerSection.displayName = 'AIInboxAutoCategorizationInner'

export const AIInboxAutoCategorization = withAiFeature(
  'inbox-auto-categorization',
  InnerSection,
)
AIInboxAutoCategorization.displayName = 'AIInboxAutoCategorization'
