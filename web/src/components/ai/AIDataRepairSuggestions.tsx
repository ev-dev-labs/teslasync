// The "Draft repair plan" button posts to
// /api/v1/ai/system/data-repair/draft through useAiStream. Keep the
// visible affordance and the SSE wiring together so the button always
// opens a stream against the registered backend route.
//
// AIDataRepairSuggestions is the visible AI surface for the
// /system/data-repair page. It is rendered conditionally via
// withAiFeature('data-repair-suggestions', …) so:
//
//   - When ai_mode='off' it does not render at all.
//   - When ai_mode is 'local'/'cloud' AND the data-repair-suggestions
//     toggle is on, it renders an opt-in section with a "Draft
//     repair plan" button that POSTs to
//     /api/v1/ai/system/data-repair/draft. The SSE response stream
//     accumulates into the shared AiOutputPanel.
//
// The component does NOT replace the deterministic stale-session
// list, per-row repair forms, or close/quarantine/update buttons on
// DataRepairPage. That baseline content remains the canonical
// view visible to every user; this AI section is opt-in propose-
// only suggestion layered alongside.
//
// Render contract:
//   - useAiStream is called unconditionally at the top of the body
//     (Hooks-rules safe).
//   - The Draft button's disabled prop is a COMPUTED expression
//     (`!canDraft`), never a literal `disabled` or
//     `disabled={true}`.
//   - Double-submit protection: stream.start() is a no-op while
//     state === 'streaming' (the hook coalesces; the button is
//     also visually disabled to mirror the state machine).
//   - The streamed text accumulates into AiOutputPanel which
//     renders the SSE delta stream as-it-arrives.
//
// AI safety alignment:
//   - I3 baseline intact: this component never replaces the
//     deterministic stale-session list or repair buttons; it adds
//     an opt-in proposal section alongside.
//   - I5 hidden UI:       the withAiFeature HOC returns null when
//     the feature is not enabled, so the section is entirely
//     absent from the DOM in off mode.
//   - I6 404 routes:      the backend route is guard-wrapped and
//     returns 404 in off mode; useAiStream surfaces that as
//     state='error' for the user, but the component is never
//     rendered in off mode at all because of I5.
//   - I8 propose-only:    the LLM never writes; the typed
//     RepairPlan it proposes is rendered here, and the user must
//     click the canonical Save / Close / Quarantine button on the
//     baseline form below to apply it.

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { useAiStream } from '@/hooks/useAiStream'

// Stable no-op stream event handler. This feature renders the streamed
// proposal through useAiStream's built-in delta accumulator (surfaced
// by AiOutputPanel inside AIFeatureCard), so there is no per-event work
// to do here. Declared at module scope so the reference is stable
// across renders and does not re-arm useAiStream's onEvent effect on
// every render (an inline `() => {}` would allocate a fresh handler
// each render).
const NOOP = (): void => {}

/**
 * InnerSection is the always-rendered body of the AI data repair
 * suggestions card. The surrounding {@link withAiFeature} HOC
 * handles the visibility gate; this component only describes the
 * surface's appearance.
 *
 * Visual contract:
 *   - One GlassPanel sized to sit above the deterministic stale-
 *     session tabs on DataRepairPage.
 *   - Cyan AI badge in the header (matches the chatbot brand
 *     colour).
 *   - A single "Draft repair plan" button that submits a POST to
 *     the registered backend route. There is no user-supplied
 *     question — the suggestion is a one-shot read of the in-
 *     scope stale-session inventory the backend loads itself.
 *   - Draft button is disabled while a stream is open.
 *   - Title attribute carries the long-form explanation so a user
 *     hovering for a tooltip understands the privacy + propose-
 *     only contract — every PII class is redacted to a round-trip
 *     tag, the proposal is grounded in the same deterministic
 *     stale-session inventory the tabs below render, and the LLM
 *     never writes.
 */
export interface AIDataRepairSuggestionsProps {
  vehicleId?: number;
}

function ScopedStreamSection({ vehicleId }: AIDataRepairSuggestionsProps) {
  const { t } = useTranslation()

  // The backend reads the in-scope stale-session inventory itself
  // (it loads stale charging + stale drives via the canonical
  // ChargingRepo.GetStale / DriveRepo.GetStale paths). The body
  // carries only the selected vehicle scope. useMemo keeps the body reference stable
  // so useAiStream's dependency-tracked re-render path doesn't
  // churn.
  const body = useMemo(
    () => (vehicleId == null ? {} : { vehicle_id: vehicleId }),
    [vehicleId],
  )

  const stream = useAiStream({
    url: '/ai/system/data-repair/draft',
    body,
    onEvent: NOOP,
  })

  return (
    <AIFeatureCard
      title={t('dataRepair.aiSuggestions.title', 'Helix repair suggestions')}
      description={t(
        'dataRepair.aiSuggestions.description',
        'Propose a typed repair plan (close, quarantine, or partial-update) for one stale charging session or drive from the inventory below. The LLM never writes — review the proposal here and click the canonical Save / Close / Quarantine button on the matching baseline form to apply it.',
      )}
      buttonLabel={t('dataRepair.aiSuggestions.button', 'Draft repair plan')}
      badgeLabel={t('dataRepair.aiSuggestions.badge', 'Helix')}
      canStart={stream.state !== 'streaming'}
      stream={stream}
    />
  )
}
ScopedStreamSection.displayName = 'AIDataRepairSuggestionsScopedStream'

function InnerSection({ vehicleId }: AIDataRepairSuggestionsProps) {
  // Vehicle scope is part of the stream identity. Remounting aborts an
  // in-flight request and clears completed output before another vehicle's
  // diagnostics are shown.
  return (
    <ScopedStreamSection
      key={vehicleId ?? 'fleet'}
      vehicleId={vehicleId}
    />
  )
}
InnerSection.displayName = 'AIDataRepairSuggestionsInner'

/**
 * AIDataRepairSuggestions renders the LLM data repair suggestion
 * section only when the data-repair-suggestions feature is
 * enabled. The wrapping div from {@link withAiFeature} carries
 * `data-testid="ai-feature-data-repair-suggestions-root"`, which
 * the off-mode invariant test asserts against.
 */
export const AIDataRepairSuggestions = withAiFeature(
  'data-repair-suggestions',
  InnerSection,
)
AIDataRepairSuggestions.displayName = 'AIDataRepairSuggestions'
