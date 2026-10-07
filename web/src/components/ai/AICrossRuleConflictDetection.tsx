// Cross-rule conflict detection.
//
// Wiring contract:
//   - useAiStream targets POST /ai/alerts/rules/conflicts
//     (the backend path after stripping the /api/v1 prefix).
//   - The primary action button is disabled via a COMPUTED expression
//     (`stream.state === 'streaming' || stream.state === 'paused-confirm' || ruleIds.length < 2`),
//     never a literal `disabled` or `disabled={true}`.
//   - tool_result frames carrying a typed RuleConflictEnvelope are
//     captured in component state; clicking "Review rule" on a
//     conflict navigates the parent page to the offending rule via
//     the onSelectRule callback. The AI panel NEVER persists state
//     directly — the baseline AlertStudio editor's existing Save
//     button remains the sole write path.
//   - cancel() runs on unmount AND on ruleIds change (dedicated
//     useEffect with explicit deps).
//   - Component is wrapped with withAiFeature so it is ABSENT (returns
//     null) when ai_mode='off' or the per-feature toggle is off.
//
// The surrounding scaffold (header,
// AI badge, action button, AiOutputPanel) to AIFeatureCard for
// visual + behavioural consistency with the other 37 AI features.
// The conflicts list is rendered through AIFeatureCard's `children`
// slot (between the action button and the streaming output panel)
// so the per-row Review buttons and severity chips keep their
// existing layout.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { Button } from '@/components/ui'
import type { AiStreamEvent } from '@/hooks/useAiStream'
import { useAiStream } from '@/hooks/useAiStream'

// RuleConflict mirrors the typed envelope returned by the
// detect_rule_conflicts tool (internal/ai/tools/cross_rule_conflict.go
// RuleConflict). Kept narrow so the Helix panel only renders fields
// it actually uses; future additions to the envelope flow through
// here intentionally.
export interface RuleConflict {
  kind: 'redundant_duplicate' | 'overlapping_threshold' | string
  rule_a_id: number
  rule_b_id: number
  rule_a_name?: string
  rule_b_name?: string
  signal_name?: string
  reason?: string
  severity_mismatch?: boolean
  cooldown_mismatch?: boolean
  trigger_mode_mismatch?: boolean
  subsumes?: boolean
}

export interface AICrossRuleConflictDetectionProps {
  /**
   * AlertRule.id list currently in scope. The backend path is
   * `/api/v1/ai/alerts/rules/conflicts`; the SPA url here strips
   * the `/api/v1` prefix per useAiStream contract. The button is
   * disabled (computed, not literal) when fewer than 2 rules are
   * in scope — you can't have a conflict with one rule.
   */
  ruleIds: number[]
  /**
   * Optional in-scope vehicle. Forwarded as `vehicle_id` in the
   * request body when non-null. Omitted when null/undefined.
   */
  vehicleId?: number | null
  /**
   * Called when the user clicks "Review rule {id}" on a captured
   * conflict. The parent (AlertStudioPage) selects the rule in
   * its sidebar list and scrolls into view. The AI panel never
   * writes to the API directly — the user reviews the offending
   * rule via the canonical baseline editor.
   */
  onSelectRule: (ruleId: number) => void
}

function InnerSection({
  ruleIds,
  vehicleId,
  onSelectRule,
}: AICrossRuleConflictDetectionProps) {
  const { t } = useTranslation()
  const [conflicts, setConflicts] = useState<RuleConflict[] | null>(null)

  // Body is memoised so useAiStream's deps are stable until the
  // ruleIds list or vehicleId actually change. We send vehicle_id
  // only when non-null; rule_ids is always sent so the LLM sees
  // the SAME scope the SPA sees.
  const ruleIdsKey = useMemo(() => (ruleIds ?? []).join(','), [ruleIds])
  const body = useMemo(() => {
    const out: Record<string, unknown> = { rule_ids: ruleIds ?? [] }
    if (vehicleId != null) {
      out.vehicle_id = vehicleId
    }
    return out
  }, [ruleIds, vehicleId])

  const handleEvent = useCallback((ev: AiStreamEvent) => {
    if (ev.type === 'tool_result' && ev.name === 'detect_rule_conflicts' && ev.ok) {
      const data = ev.data as
        | { conflicts?: unknown; status?: string }
        | undefined
      if (!data || !Array.isArray(data.conflicts)) {
        return
      }
      const out: RuleConflict[] = []
      for (const raw of data.conflicts) {
        if (raw == null || typeof raw !== 'object') continue
        const r = raw as Record<string, unknown>
        if (typeof r.rule_a_id !== 'number' || typeof r.rule_b_id !== 'number') continue
        if (typeof r.kind !== 'string') continue
        out.push({
          kind: r.kind as RuleConflict['kind'],
          rule_a_id: r.rule_a_id,
          rule_b_id: r.rule_b_id,
          rule_a_name: typeof r.rule_a_name === 'string' ? r.rule_a_name : undefined,
          rule_b_name: typeof r.rule_b_name === 'string' ? r.rule_b_name : undefined,
          signal_name: typeof r.signal_name === 'string' ? r.signal_name : undefined,
          reason: typeof r.reason === 'string' ? r.reason : undefined,
          severity_mismatch: r.severity_mismatch === true,
          cooldown_mismatch: r.cooldown_mismatch === true,
          trigger_mode_mismatch: r.trigger_mode_mismatch === true,
          subsumes: r.subsumes === true,
        })
      }
      setConflicts(out)
    }
  }, [])

  const stream = useAiStream({
    url: `/ai/alerts/rules/conflicts`,
    body,
    onEvent: handleEvent,
    // AI-01: rule-set + vehicle scope is part of stream identity —
    // switching either aborts an in-flight detection and clears the
    // stream's own completed output in addition to the local
    // `conflicts` state cleared below.
    scopeKey: `${ruleIdsKey}:${vehicleId ?? ''}`,
  })

  // Pull cancel out so the cleanup effect's deps stay narrow.
  const { cancel: cancelStream } = stream

  // Reset the locally-captured conflicts on ruleIds change/unmount so
  // a stale result from a previously-selected rule set cannot bleed
  // into the new scope. The stream's own text/activity/usage reset is
  // now handled by useAiStream's scopeKey above; cancelStream() here
  // only covers unmount.
  useEffect(() => {
    return () => {
      cancelStream()
      setConflicts(null)
    }
  }, [ruleIdsKey, cancelStream])

  // canStart fed to AIFeatureCard. The card disables the button
  // when !canStart || stream.state === 'streaming'; we additionally
  // gate on `paused-confirm` here because the original component
  // treated paused-confirm as "busy" too.
  const canStart =
    (ruleIds?.length ?? 0) >= 2 && stream.state !== 'paused-confirm'

  const handleDetect = useCallback(() => {
    if (stream.state === 'streaming' || stream.state === 'paused-confirm') {
      return // double-submit no-op
    }
    setConflicts(null)
    stream.start()
  }, [stream])

  const handleReview = useCallback(
    (ruleId: number) => {
      onSelectRule(ruleId)
    },
    [onSelectRule],
  )

  const labelForKind = (kind: string): string => {
    if (kind === 'redundant_duplicate') {
      return t(
        'notifications.alertStudio.aiConflicts.kind.redundant_duplicate',
        'Redundant duplicate',
      )
    }
    if (kind === 'overlapping_threshold') {
      return t(
        'notifications.alertStudio.aiConflicts.kind.overlapping_threshold',
        'Overlapping threshold',
      )
    }
    return kind
  }

  // Localised noun for the rule-pair line ("Rule 12 ↔ Rule 34"). Kept as
  // a single lookup instead of interpolating the two ids into one string
  // so the optional name/signal suffixes can compose in JSX without a
  // combinatorial explosion of translation keys.
  const ruleWord = t('notifications.alertStudio.aiConflicts.ruleLabel', 'Rule')

  return (
    <AIFeatureCard
      title={t(
        'notifications.alertStudio.aiConflicts.title',
        'Detect cross-rule conflicts',
      )}
      description={t(
        'notifications.alertStudio.aiConflicts.description',
        'Surface structural overlaps between your alert rule definitions. Review only — Helix never edits, merges, or deletes rules.',
      )}
      buttonLabel={t(
        'notifications.alertStudio.aiConflicts.detectButton',
        'Detect conflicts',
      )}
      badgeLabel={t('notifications.alertStudio.aiConflicts.badge', 'Helix')}
      canStart={canStart}
      stream={stream}
      onAction={handleDetect}
      buttonPlacement="below"
      buttonTestId="ai-feature-cross-rule-conflict-detection-detect"
    >
      {conflicts != null && conflicts.length === 0 && (
        <div
          role="status"
          className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3 text-sm text-[var(--text-secondary)]"
        >
          {t(
            'notifications.alertStudio.aiConflicts.emptyMessage',
            'No structural conflicts found in the current rule set.',
          )}
        </div>
      )}
      {conflicts != null && conflicts.length > 0 && (
        <ul
          className="space-y-2"
          aria-label={t(
            'notifications.alertStudio.aiConflicts.listLabel',
            'Detected rule conflicts',
          )}
          data-testid="ai-feature-cross-rule-conflict-detection-conflicts"
        >
          {conflicts.map((c) => (
            <li
              key={`${c.kind}:${c.rule_a_id}:${c.rule_b_id}`}
              className="rounded-md border border-amber-300/30 bg-amber-300/5 p-3 text-sm text-amber-300"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="font-medium">{labelForKind(c.kind)}</div>
                  <div className="text-xs text-[var(--text-secondary)]">
                    {ruleWord} {c.rule_a_id}
                    {c.rule_a_name ? ` (${c.rule_a_name})` : ''} ↔ {ruleWord}
                    {' '}
                    {c.rule_b_id}
                    {c.rule_b_name ? ` (${c.rule_b_name})` : ''}
                    {c.signal_name ? ` · ${c.signal_name}` : ''}
                  </div>
                  {c.reason && (
                    <div className="text-xs text-[var(--text-secondary)]">{c.reason}</div>
                  )}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {c.subsumes && (
                      <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-2 py-0.5 text-2xs font-medium uppercase tracking-wide text-amber-300">
                        {t(
                          'notifications.alertStudio.aiConflicts.flag.subsumes',
                          'subsumes',
                        )}
                      </span>
                    )}
                    {c.severity_mismatch && (
                      <span className="rounded-full border border-rose-300/30 bg-rose-300/10 px-2 py-0.5 text-2xs font-medium uppercase tracking-wide text-rose-300">
                        {t(
                          'notifications.alertStudio.aiConflicts.flag.severityMismatch',
                          'severity mismatch',
                        )}
                      </span>
                    )}
                    {c.cooldown_mismatch && (
                      <span className="rounded-full border border-rose-300/30 bg-rose-300/10 px-2 py-0.5 text-2xs font-medium uppercase tracking-wide text-rose-300">
                        {t(
                          'notifications.alertStudio.aiConflicts.flag.cooldownMismatch',
                          'cooldown mismatch',
                        )}
                      </span>
                    )}
                    {c.trigger_mode_mismatch && (
                      <span className="rounded-full border border-rose-300/30 bg-rose-300/10 px-2 py-0.5 text-2xs font-medium uppercase tracking-wide text-rose-300">
                        {t(
                          'notifications.alertStudio.aiConflicts.flag.triggerModeMismatch',
                          'trigger mode mismatch',
                        )}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-shrink-0 flex-col gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleReview(c.rule_a_id)}
                    data-testid={`ai-feature-cross-rule-conflict-detection-review-${c.rule_a_id}`}
                  >
                    {t(
                      'notifications.alertStudio.aiConflicts.reviewButton',
                      'Review rule',
                    )}{' '}
                    {c.rule_a_id}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleReview(c.rule_b_id)}
                    data-testid={`ai-feature-cross-rule-conflict-detection-review-${c.rule_b_id}`}
                  >
                    {t(
                      'notifications.alertStudio.aiConflicts.reviewButton',
                      'Review rule',
                    )}{' '}
                    {c.rule_b_id}
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </AIFeatureCard>
  )
}
InnerSection.displayName = 'AICrossRuleConflictDetectionInner'

export const AICrossRuleConflictDetection = withAiFeature(
  'cross-rule-conflict-detection',
  InnerSection,
)
AICrossRuleConflictDetection.displayName = 'AICrossRuleConflictDetection'
