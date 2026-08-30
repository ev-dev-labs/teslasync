// Alert tuning suggestions.
//
// Streaming contract:
//   - useAiStream targets POST /ai/alerts/rules/{ruleID}/tune/draft
//     (the backend path after stripping the /api/v1 prefix).
//   - The primary action button is disabled via a COMPUTED expression
//     (`stream.state === 'streaming' || stream.state === 'paused-confirm' || !ruleId`),
//     never a literal `disabled` or `disabled={true}`.
//   - tool_result frames carrying a typed AlertRulePatchProposal are
//     captured in component state; clicking "Apply to form" copies
//     the proposed scalars onto the parent form via the onApplyDraft
//     callback. The AI panel NEVER persists state directly — the
//     baseline AlertStudio Save button remains the sole write path
//     (ADR-015 §I3 + §I8).
//   - cancel() runs on unmount AND on ruleId change (dedicated
//     useEffect with explicit deps).
//   - Component is wrapped with withAiFeature so it is ABSENT (returns
//     null) when ai_mode='off' or the per-feature toggle is off
//     (ADR-015 §I5).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { Button } from '@/components/ui'
import type { AiStreamEvent } from '@/hooks/useAiStream'
import { useAiStream } from '@/hooks/useAiStream'

// AlertRuleDraftPatch is the subset of AlertRule scalars the LLM
// is allowed to propose. Mirrors the `proposed` AlertRule fields
// in internal/ai/tools/alert_tuning.go AlertRulePatchProposal —
// keeping it narrow here prevents the Helix panel from over-writing
// fields the user did not consent to changing (e.g. signal_name,
// vehicle scope).
export interface AlertRuleDraftPatch {
  value_num?: number | null
  value_min?: number | null
  value_max?: number | null
  cooldown_min?: number
  severity?: string
  trigger_mode?: string
  op?: string
}

export interface AIAlertTuningSuggestionsProps {
  /**
   * AlertRule.id this draft is tuning. The backend path is
   * `/api/v1/ai/alerts/rules/{ruleID}/tune/draft`; the SPA url
   * here strips the `/api/v1` prefix per useAiStream contract.
   */
  ruleId: number
  /**
   * Optional in-scope vehicle for the tool's firing-history
   * window. Forwarded as `vehicle_id` in the request body when
   * non-null. Omitted when null/undefined.
   */
  vehicleId?: number | null
  /**
   * Called when the user clicks "Apply to form" on a captured
   * proposal. The parent (AlertStudioPage) merges the patch into
   * its editor draft. The AI panel never writes to the API
   * directly — the user clicks the canonical Save button on the
   * editor next.
   */
  onApplyDraft: (patch: AlertRuleDraftPatch) => void
}

function InnerSection({
  ruleId,
  vehicleId,
  onApplyDraft,
}: AIAlertTuningSuggestionsProps) {
  const { t } = useTranslation()
  const [proposal, setProposal] = useState<AlertRuleDraftPatch | null>(null)

  // Body is memoised so useAiStream's deps are stable until ruleId
  // or vehicleId actually change. Sending an empty body when
  // vehicleId is missing matches the backend handler's optional
  // `vehicle_id` contract.
  const body = useMemo(() => {
    if (vehicleId == null) {
      return {}
    }
    return { vehicle_id: vehicleId }
  }, [vehicleId])

  const handleEvent = useCallback((ev: AiStreamEvent) => {
    if (ev.type === 'tool_result' && ev.name === 'draft_alert_rule_patch' && ev.ok) {
      const data = ev.data as
        | { proposed?: Record<string, unknown>; status?: string }
        | undefined
      if (!data || data.status !== 'ok' || !data.proposed) {
        return
      }
      const proposed = data.proposed
      const patch: AlertRuleDraftPatch = {}
      if (typeof proposed.value_num === 'number') {
        patch.value_num = proposed.value_num
      }
      if (typeof proposed.value_min === 'number') {
        patch.value_min = proposed.value_min
      }
      if (typeof proposed.value_max === 'number') {
        patch.value_max = proposed.value_max
      }
      if (typeof proposed.cooldown_min === 'number') {
        patch.cooldown_min = proposed.cooldown_min
      }
      if (typeof proposed.severity === 'string' && proposed.severity !== '') {
        patch.severity = proposed.severity
      }
      if (typeof proposed.trigger_mode === 'string' && proposed.trigger_mode !== '') {
        patch.trigger_mode = proposed.trigger_mode
      }
      if (typeof proposed.op === 'string' && proposed.op !== '') {
        patch.op = proposed.op
      }
      // Guard against an all-invalid `proposed` object yielding an
      // empty patch: surfacing a "Proposed patch" panel with an empty
      // list and a no-op "Apply to form" button is a worse experience
      // than showing nothing. Only capture a proposal once at least
      // one scalar field survived type-validation.
      if (Object.keys(patch).length === 0) {
        return
      }
      setProposal(patch)
    }
  }, [])

  const stream = useAiStream({
    url: `/ai/alerts/rules/${ruleId}/tune/draft`,
    body,
    onEvent: handleEvent,
    // AI-01: rule scope is part of stream identity through the
    // canonical useAiStream scopeKey mechanism — switching the
    // selected rule aborts an in-flight draft and clears the
    // stream's own completed output (text/activity/usage) in
    // addition to the local `proposal` state cleared below.
    scopeKey: ruleId ?? null,
  })

  // Pull cancel out so the cleanup effect's deps stay narrow.
  // The hook returns a stable cancel reference (useCallback with
  // [] deps), so destructuring here keeps the effect dep on
  // ruleId only. Including the whole stream object would re-run
  // the cleanup on every internal state tick of useAiStream and
  // wipe the captured proposal mid-stream.
  const { cancel: cancelStream } = stream

  // Reset the locally-captured proposal on ruleId change/unmount so a
  // stale proposal from a previously-selected rule cannot bleed into
  // the new rule's editor. The stream's own text/activity/usage reset
  // is now handled by useAiStream's scopeKey above; cancelStream()
  // here only covers unmount (scopeKey has no "next" value to compare
  // against once the component is gone).
  useEffect(() => {
    return () => {
      cancelStream()
      setProposal(null)
    }
  }, [ruleId, cancelStream])

  const isBusy = stream.state === 'streaming' || stream.state === 'paused-confirm'

  const handleSuggest = useCallback(() => {
    if (isBusy) {
      return // double-submit no-op
    }
    setProposal(null)
    stream.start()
  }, [isBusy, stream])

  const handleApply = useCallback(() => {
    if (!proposal) {
      return
    }
    onApplyDraft(proposal)
  }, [proposal, onApplyDraft])

  return (
    <AIFeatureCard
      title={t(
        'notifications.alertStudio.aiTuning.title',
        'Suggest lower-noise tuning',
      )}
      description={t(
        'notifications.alertStudio.aiTuning.description',
        'Review recent firings and propose a typed AlertRule patch. Descriptive replay only — review before saving.',
      )}
      buttonLabel={t(
        'notifications.alertStudio.aiTuning.suggestButton',
        'Suggest tuning',
      )}
      badgeLabel={t('notifications.alertStudio.aiTuning.badge', 'Helix')}
      canStart={!!ruleId && stream.state !== 'paused-confirm'}
      stream={stream}
      onAction={handleSuggest}
      buttonPlacement="below"
      buttonTestId="ai-feature-alert-tuning-suggestions-suggest"
    >
      {proposal && (
        <>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={proposal == null || isBusy}
              aria-disabled={proposal == null || isBusy ? 'true' : 'false'}
              onClick={handleApply}
              data-testid="ai-feature-alert-tuning-suggestions-apply"
            >
              {t(
                'notifications.alertStudio.aiTuning.applyButton',
                'Apply to form',
              )}
            </Button>
          </div>
          <div
            role="status"
            data-testid="ai-feature-alert-tuning-suggestions-preview"
            className="rounded-md border border-emerald-300/30 bg-emerald-300/5 p-3 text-sm text-emerald-300"
          >
            <div className="font-medium">
              {t(
                'notifications.alertStudio.aiTuning.previewLabel',
                'Proposed patch (review before saving):',
              )}
            </div>
            <ul className="mt-1 list-inside list-disc text-xs text-[var(--text-secondary)]">
              {proposal.value_num != null && (
                <li>value_num: {proposal.value_num}</li>
              )}
              {proposal.value_min != null && (
                <li>value_min: {proposal.value_min}</li>
              )}
              {proposal.value_max != null && (
                <li>value_max: {proposal.value_max}</li>
              )}
              {proposal.cooldown_min != null && (
                <li>cooldown_min: {proposal.cooldown_min}</li>
              )}
              {proposal.severity && <li>severity: {proposal.severity}</li>}
              {proposal.trigger_mode && (
                <li>trigger_mode: {proposal.trigger_mode}</li>
              )}
              {proposal.op && <li>op: {proposal.op}</li>}
            </ul>
          </div>
        </>
      )}
    </AIFeatureCard>
  )
}
InnerSection.displayName = 'AIAlertTuningSuggestionsInner'

export const AIAlertTuningSuggestions = withAiFeature(
  'alert-tuning-suggestions',
  InnerSection,
)
AIAlertTuningSuggestions.displayName = 'AIAlertTuningSuggestions'
