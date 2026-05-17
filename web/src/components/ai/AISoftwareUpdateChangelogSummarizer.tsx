// Phase-50 / 0051 — M3 software update changelog summarizer.
// Phase-50 / W1 inline wiring (per slice prompt 0051) — wired the
// "Summarize updates" button to
// POST /api/v1/ai/software-updates/summarize via the canonical
// useAiStream hook. The slice methodology forbids shipping the
// visual affordance without end-to-end SSE wiring; this component
// lands both in one commit so the on-mode wiring test
// (TestSoftwareUpdateChangelogSummarizerAIOnWiredCallsRoute) can
// prove the button actually opens an SSE stream against the
// registered backend route.
//
// AISoftwareUpdateChangelogSummarizer is the visible AI surface
// for the SoftwareUpdatesPage (/software-updates and the alias
// /vehicle-systems/software). It is rendered conditionally via
// withAiFeature('software-update-changelog-summarizer', …) so:
//
//   - When ai_mode='off' it does not render at all (ADR-015 §I5 + §I6).
//   - When ai_mode is 'local'/'cloud' AND the
//     software-update-changelog-summarizer toggle is on, it
//     renders an opt-in section with a "Summarize updates" button
//     that POSTs to /api/v1/ai/software-updates/summarize. The SSE
//     response stream accumulates into the shared AiOutputPanel
//     inside AIFeatureCard.
//
// The component does NOT replace the deterministic update history
// (timeline, version chips, raw release-note links). Those
// baseline panels remain the canonical view for every user; this
// AI section is opt-in read-only narration layered alongside.
//
// Render contract (P11/P12 — Wired-or-absent, No-placeholder-buttons):
//   - useAiStream is called unconditionally at the top of the body
//     (Hooks-rules safe).
//   - The button's disabled prop is a COMPUTED expression
//     (`!haveInputs || stream.state === 'streaming'` via the
//     `canStart` prop on AIFeatureCard), never a literal
//     `disabled` or `disabled={true}`.
//   - Double-submit protection: stream.start() is a no-op while
//     state === 'streaming' (the hook coalesces; the button is
//     also visually disabled to mirror the state machine).
//   - The streamed text accumulates into AiOutputPanel which
//     renders the SSE delta stream as-it-arrives.
//
// HX (Helix UX) contract:
//   - The surface renders through the shared AIFeatureCard
//     scaffold — NOT a bespoke GlassPanel + Button + AiOutputPanel
//     composition.
//   - The per-feature verb "Summarize updates" is passed via
//     `buttonLabel`. The card composes the accessible name as
//     "Ask Helix · Summarize updates".
//   - User-visible i18n keys say "Helix", not "AI" (per the HX
//     addendum).
//
// ADR-015 alignment:
//   - I3 baseline intact: this component never replaces the
//     deterministic update timeline; it adds an opt-in narrative
//     section alongside.
//   - I5 hidden UI:       the withAiFeature HOC returns null when
//     the feature is not enabled, so the section is entirely
//     absent from the DOM in off mode.
//   - I6 404 routes:      the backend route is guard-wrapped and
//     returns 404 in off mode; useAiStream surfaces that as
//     state='error' for the user, but the component is never
//     rendered in off mode at all because of I5.

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { useAiStream } from '@/hooks/useAiStream'

interface InnerSectionProps {
  /**
   * vehicleId surfaced by the parent SoftwareUpdatesPage. Optional
   * because the active-vehicle context may be unresolved at first
   * paint; when absent we still render the section (the gate has
   * already passed) but the action button stays disabled because
   * the backend call needs a vehicle in scope.
   *
   * Typed as `number | undefined` to match
   * `useSelectedVehicle().vehicleId` (which is `number | null`)
   * once the page has narrowed away the null.
   */
  vehicleId?: number
}

/**
 * InnerSection is the always-rendered body of the AI
 * software-update-changelog-summarizer card. The surrounding
 * {@link withAiFeature} HOC handles the visibility gate; this
 * component only describes the surface's appearance.
 *
 * Visual contract:
 *   - One AIFeatureCard sized to sit above the deterministic
 *     update timeline on SoftwareUpdatesPage.
 *   - Helix brand badge in the header (matches the chatbot brand
 *     colour).
 *   - "Summarize updates" button is disabled while a stream is
 *     open OR when no vehicleId is available from the
 *     active-vehicle context.
 *   - Description carries the long-form explanation so a user
 *     reading the panel hint understands the privacy contract +
 *     the limiting assumptions inherited from the deterministic
 *     reader. The narrator never invents firmware version
 *     numbers — it only summarizes the update cadence and quotes
 *     release-note chunks the retrieval layer surfaces.
 */
function InnerSection({ vehicleId }: InnerSectionProps) {
  const { t } = useTranslation()
  // The handler-side parser validates vehicle_id > 0; we mirror
  // that here to keep the button disabled when the parent has not
  // yet resolved the active vehicle. The hook is called
  // unconditionally with the current body so the dependency graph
  // stays stable regardless of vehicleId resolution.
  const numericVehicleId =
    typeof vehicleId === 'number' && Number.isFinite(vehicleId) ? vehicleId : 0
  const body = useMemo(
    () => ({ vehicle_id: numericVehicleId }),
    [numericVehicleId],
  )
  const stream = useAiStream({
    url: '/ai/software-updates/summarize',
    body,
    onEvent: () => {},
  })
  const haveInputs = numericVehicleId > 0
  return (
    <AIFeatureCard
      title={t(
        'softwareUpdates.aiNarration.title',
        'Summarize my software update history',
      )}
      description={t(
        'softwareUpdates.aiNarration.description',
        'Ask Helix to walk through your firmware update history — the current version, the install cadence, and the headline release-note themes. The narrator quotes only the deterministic update events your vehicle reported plus public Tesla release notes for the versions you have installed; it never invents firmware versions or claims features your installed build does not have.',
      )}
      buttonLabel={t(
        'softwareUpdates.aiNarration.button',
        'Summarize updates',
      )}
      badgeLabel={t('softwareUpdates.aiNarration.badge', 'Helix')}
      emptyHint={
        haveInputs
          ? undefined
          : t(
              'softwareUpdates.aiNarration.noVehicleHint',
              'Pick a vehicle above to enable Helix.',
            )
      }
      canStart={haveInputs}
      stream={stream}
    />
  )
}
InnerSection.displayName = 'AISoftwareUpdateChangelogSummarizerInner'

/**
 * AISoftwareUpdateChangelogSummarizer renders the LLM update
 * summarizer section only when the
 * software-update-changelog-summarizer feature is enabled. The
 * wrapping div from {@link withAiFeature} carries
 * `data-testid="ai-feature-software-update-changelog-summarizer-root"`,
 * which the off-mode invariant test asserts against.
 */
export const AISoftwareUpdateChangelogSummarizer = withAiFeature(
  'software-update-changelog-summarizer',
  InnerSection,
)
AISoftwareUpdateChangelogSummarizer.displayName =
  'AISoftwareUpdateChangelogSummarizer'
