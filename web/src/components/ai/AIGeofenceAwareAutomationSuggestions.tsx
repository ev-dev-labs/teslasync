// Geofence-aware automation suggestions.
//
// AI streaming contract:
//   - useAiStream targets POST /ai/geofences/automations/draft (the
//     backend path after stripping the /api/v1 prefix). vehicle_id +
//     prompt flow through the JSON body, not the URL — the backend
//     route has no path parameter.
//   - The primary action button is disabled via a COMPUTED expression
//     (`stream.state === 'streaming' || stream.state === 'paused-confirm'
//     || (vehicleId ?? 0) <= 0 || prompt.trim().length === 0`),
//     never a literal `disabled` or `disabled={true}`.
//   - tool_result frames carrying a typed Automation envelope are
//     captured in component state; clicking "Apply to form" copies
//     the proposed graph (name + description + triggers + conditions
//     + actions) into the parent's form state via the onApplyDraft
//     callback. The AI panel NEVER persists state directly — the
//     baseline AutomationBuilder Save button remains the sole write
//     path (ADR-015 §I3 + §I8 propose-only contract).
//   - cancel() runs on unmount AND on vehicleId change (dedicated
//     useEffect with explicit deps).
//   - Component is wrapped with withAiFeature so it is ABSENT
//     (returns null) when ai_mode='off' or the per-feature toggle
//     is off (ADR-015 §I5 hidden UI).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { Button, Textarea } from '@/components/ui'
import type { AutomationFullInput } from '@/api/hooks/useAutomations'
import type { AiStreamEvent } from '@/hooks/useAiStream'
import { useAiStream } from '@/hooks/useAiStream'

// AutomationDraft mirrors the typed envelope returned by the
// draft_automation_graph tool
// (internal/ai/tools/automation_builder.go automationGraphDraftOutput).
// The Draft field carries the canonical wire-shaped Automation
// payload (the same JSON the POST /api/v1/automations handler
// accepts), which we narrowly parse into AutomationFullInput before
// surfacing it as an "Apply to form" action. Status drives the apply
// button's enabled state.
export interface AutomationDraft {
  draft: AutomationFullInput
  status: 'ok' | 'invalid' | string
  validation_error?: string
}

export interface AIGeofenceAwareAutomationSuggestionsProps {
  /**
   * The vehicle the proposed automation will apply to. The backend
   * reads vehicle_id from the JSON body of
   * POST /ai/geofences/automations/draft; the SPA url here strips
   * the /api/v1 prefix per useAiStream contract. The Suggest button
   * is disabled (computed, not literal) when the id is non-positive
   * — defensive against a stale parent prop.
   */
  vehicleId?: number
  /**
   * Called when the user clicks "Apply to form" on a captured
   * proposal. The parent (AutomationBuilderPage) copies the
   * proposed graph into the canonical baseline AutomationBuilder
   * form state. The AI panel never writes to the API directly —
   * the user reviews and saves via the canonical baseline
   * POST /api/v1/automations write path.
   */
  onApplyDraft: (draft: AutomationFullInput) => void
}

/**
 * normalizeAutomationInput defensively coerces the typed envelope
 * the LLM produces into the AutomationFullInput shape the parent's
 * formToPayload helper expects. Anything we cannot positively prove
 * from the wire shape is rejected (return null) so a malformed draft
 * never silently corrupts the user's form state.
 *
 * The typed shape is enforced server-side by the
 * draft_automation_graph tool (which calls
 * decodeAutomationInputDTO before returning); this client-side
 * narrowing is defence-in-depth against an unexpected provider
 * response.
 *
 * Exported for the unit test — production code reaches it only via the
 * `tool_result` handler below.
 */
export function normalizeAutomationInput(value: unknown): AutomationFullInput | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const v = value as Record<string, unknown>
  if (
    typeof v.name !== 'string' ||
    typeof v.vehicle_id !== 'number' ||
    typeof v.enabled !== 'boolean' ||
    !Array.isArray(v.triggers) ||
    !Array.isArray(v.conditions) ||
    !Array.isArray(v.actions)
  ) {
    return null
  }
  return {
    name: v.name,
    description: typeof v.description === 'string' ? v.description : '',
    vehicle_id: v.vehicle_id,
    enabled: v.enabled,
    triggers: v.triggers as AutomationFullInput['triggers'],
    conditions: v.conditions as AutomationFullInput['conditions'],
    actions: v.actions as AutomationFullInput['actions'],
  }
}

function InnerSection({
  vehicleId,
  onApplyDraft,
}: AIGeofenceAwareAutomationSuggestionsProps) {
  const { t } = useTranslation()
  const [prompt, setPrompt] = useState('')
  const [draft, setDraft] = useState<AutomationDraft | null>(null)

  // The body carries the vehicle scope + free-form prompt the
  // backend route expects. Memoised so useAiStream's deps stay
  // stable across rerenders.
  const body = useMemo<Record<string, unknown>>(
    () => ({ vehicle_id: vehicleId ?? 0, prompt }),
    [vehicleId, prompt],
  )

  const handleEvent = useCallback((ev: AiStreamEvent) => {
    if (
      ev.type === 'tool_result' &&
      ev.name === 'draft_automation_graph' &&
      ev.ok
    ) {
      // The dispatcher unwraps the tool envelope into the data
      // payload; the draft lives at data.draft per the Go tool's
      // *automationGraphDraftOutput shape.
      const wrapper = ev.data as
        | {
            draft?: unknown
            status?: unknown
            validation_error?: unknown
          }
        | undefined
      const inner = normalizeAutomationInput(wrapper?.draft)
      if (!inner || typeof wrapper?.status !== 'string') {
        return
      }
      setDraft({
        draft: inner,
        status: wrapper.status as AutomationDraft['status'],
        validation_error:
          typeof wrapper.validation_error === 'string'
            ? wrapper.validation_error
            : undefined,
      })
    }
  }, [])

  const stream = useAiStream({
    url: '/ai/geofences/automations/draft',
    body,
    onEvent: handleEvent,
  })

  // Pull cancel out so the cleanup effect's deps stay narrow.
  const { cancel: cancelStream } = stream

  // Cancel + reset on vehicleId change so a stale stream from a
  // previously-selected vehicle cannot bleed a proposal into the
  // new scope.
  useEffect(() => {
    return () => {
      cancelStream()
      setDraft(null)
    }
  }, [vehicleId, cancelStream])

  const isBusy = stream.state === 'streaming' || stream.state === 'paused-confirm'

  const handleSuggest = useCallback(() => {
    if (isBusy) {
      return // double-submit no-op
    }
    setDraft(null)
    stream.start()
  }, [isBusy, stream])

  const handleApply = useCallback(() => {
    if (draft && draft.status === 'ok') {
      onApplyDraft(draft.draft)
    }
  }, [draft, onApplyDraft])

  return (
    <AIFeatureCard
      title={t(
        'automations.builder.aiGeofenceAware.title',
        'Suggest a geofence-aware automation',
      )}
      description={t(
        'automations.builder.aiGeofenceAware.description',
        'Describe an automation that uses one of your existing geofences. Helix proposes a typed graph anchored to a place_id you already have — review and apply to the form below before saving.',
      )}
      buttonLabel={t(
        'automations.builder.aiGeofenceAware.suggestButton',
        'Suggest automation',
      )}
      badgeLabel={t('automations.builder.aiGeofenceAware.badge', 'Helix')}
      canStart={
        (vehicleId ?? 0) > 0 &&
        prompt.trim().length > 0 &&
        stream.state !== 'paused-confirm'
      }
      stream={stream}
      onAction={handleSuggest}
      buttonTestId="ai-feature-geofence-aware-automation-suggestions-suggest"
      inputSlot={
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          aria-label={t(
            'automations.builder.aiGeofenceAware.promptAria',
            'Describe the geofence-aware automation to draft',
          )}
          placeholder={t(
            'automations.builder.aiGeofenceAware.placeholder',
            'e.g. when I arrive home on a weekday after sunset, turn on cabin overheat protection',
          )}
          rows={3}
          data-testid="ai-feature-geofence-aware-automation-suggestions-prompt"
        />
      }
    >
      {draft && (
        <div
          className="rounded-md border border-cyan-300/30 bg-cyan-300/5 p-3 text-sm"
          data-testid="ai-feature-geofence-aware-automation-suggestions-draft"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-wide text-cyan-300">
                {t(
                  'automations.builder.aiGeofenceAware.proposalLabel',
                  'Proposed automation',
                )}
              </div>
              <div className="font-medium text-[var(--text-primary)]">
                {draft.draft.name || t(
                  'automations.builder.aiGeofenceAware.unnamed',
                  '(unnamed)',
                )}
              </div>
              {draft.draft.description && (
                <div className="text-xs text-[var(--text-secondary)]">
                  {draft.draft.description}
                </div>
              )}
              <div className="text-xs text-[var(--text-secondary)]">
                {t('automations.builder.aiGeofenceAware.triggersLabel', 'Triggers')}:{' '}
                <span className="text-[var(--text-secondary)]">{draft.draft.triggers.length}</span>
                {' · '}
                {t('automations.builder.aiGeofenceAware.conditionsLabel', 'Conditions')}:{' '}
                <span className="text-[var(--text-secondary)]">{draft.draft.conditions.length}</span>
                {' · '}
                {t('automations.builder.aiGeofenceAware.actionsLabel', 'Actions')}:{' '}
                <span className="text-[var(--text-secondary)]">{draft.draft.actions.length}</span>
              </div>
              {draft.validation_error && (
                <div className="text-xs text-[var(--text-secondary)]">
                  {draft.validation_error}
                </div>
              )}
              {draft.status !== 'ok' && (
                <div className="text-xs text-rose-300">
                  {t(
                    'automations.builder.aiGeofenceAware.rejectedLabel',
                    'Proposal rejected by validator',
                  )}
                </div>
              )}
            </div>
            <div className="flex flex-shrink-0 flex-col gap-1.5">
              <Button
                variant="outline"
                size="sm"
                disabled={draft.status !== 'ok'}
                aria-disabled={draft.status !== 'ok' ? 'true' : 'false'}
                onClick={handleApply}
                data-testid="ai-feature-geofence-aware-automation-suggestions-apply"
              >
                {t(
                  'automations.builder.aiGeofenceAware.applyButton',
                  'Apply to form',
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </AIFeatureCard>
  )
}
InnerSection.displayName = 'AIGeofenceAwareAutomationSuggestionsInner'

export const AIGeofenceAwareAutomationSuggestions = withAiFeature(
  'geofence-aware-automation-suggestions',
  InnerSection,
)
AIGeofenceAwareAutomationSuggestions.displayName = 'AIGeofenceAwareAutomationSuggestions'
