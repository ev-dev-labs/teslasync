// Phase-50 / 0031 — T1 Preheat and precool recommender.
// Phase-50 / W1 inline wiring (per slice prompt 0031) — wired the
// Draft button to POST /api/v1/ai/climate/schedule/draft via the
// canonical useAiStream hook. The slice methodology forbids
// shipping the visual affordance without end-to-end SSE wiring; this
// component lands both in one commit so the on-mode wiring test
// (TestPreheatPrecoolRecommenderAIOnWiredCallsRoute) can prove the
// button actually opens an SSE stream against the registered
// backend route.
//
// AIPreheatPrecoolRecommender is the visible AI surface for the
// ClimateControlPage. It is rendered conditionally via
// withAiFeature('preheat-precool-recommender', …) so:
//
//   - When ai_mode='off' it does not render at all (ADR-015 §I5 + §I6).
//   - When ai_mode is 'local'/'cloud' AND the
//     preheat-precool-recommender toggle is on, it renders an opt-in
//     section with a Draft button that POSTs to
//     /api/v1/ai/climate/schedule/draft. The SSE response stream
//     accumulates into the shared AiOutputPanel and the user is
//     directed to click the existing canonical climate-controls
//     Apply button to persist (the schedule is PROPOSE-only —
//     Helix never persists).
//
// The component does NOT replace the deterministic HVAC banner,
// the climate status cards, the climate efficiency panel, the
// climate history table, the seat-heater controls, or any other
// content rendered by ClimateControlPage. That baseline content
// remains the canonical view visible to every user; this AI
// section is opt-in propose-only narration layered alongside.
//
// Render contract (P11/P12 — Wired-or-absent, No-placeholder-buttons):
//   - useAiStream is called unconditionally at the top of the body
//     (Hooks-rules safe).
//   - The Draft button's disabled prop is a COMPUTED expression
//     (`!canGenerate`), never a literal `disabled` or
//     `disabled={true}`.
//   - Double-submit protection: stream.start() is a no-op while
//     state === 'streaming' (the hook coalesces; the button is
//     also visually disabled to mirror the state machine).
//   - The streamed text accumulates into AiOutputPanel which
//     renders the SSE delta stream as-it-arrives.
//
// ADR-015 alignment:
//   - I3 baseline intact: this component never replaces the
//     deterministic climate-control panels; it adds an opt-in
//     propose-only section alongside.
//   - I5 hidden UI:       the withAiFeature HOC returns null when
//     the feature is not enabled, so the section is entirely
//     absent from the DOM in off mode.
//   - I6 404 routes:      the backend route is guard-wrapped and
//     returns 404 in off mode; useAiStream surfaces that as
//     state='error' for the user, but the component is never
//     rendered in off mode at all because of I5.
//   - I8 propose-only:    Helix never persists a schedule; the
//     narration explicitly directs the user to click the
//     canonical Apply button on the climate controls below.

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { useAiStream } from '@/hooks/useAiStream'

interface InnerSectionProps {
  /**
   * vehicleId surfaced by the parent ClimateControlPage. Optional
   * because the active-vehicle context may be unresolved at first
   * paint; when absent we still render the section (the gate has
   * already passed) but the Draft button stays disabled because
   * the backend call needs a vehicle in scope.
   */
  vehicleId?: string | number
  /**
   * Latest known cabin temperature in Celsius. Optional; when
   * absent the Draft button stays disabled because the
   * deterministic departure heuristic needs a starting cabin
   * temperature to compute the warm-up / cool-down window.
   */
  currentCabinTempC?: number | null
  /**
   * Latest known outside temperature in Celsius. Optional; when
   * absent the Draft button stays disabled because the
   * deterministic departure heuristic uses the outside temperature
   * to bound the warm-up / cool-down rate.
   */
  outsideTempC?: number | null
  /**
   * Target cabin temperature in Celsius. Defaults to 21°C (a
   * comfortable cabin) when not supplied. Bounded to [10, 32]°C
   * by the backend parser; out-of-range values keep the Draft
   * button enabled but the backend will reject with 400.
   */
  targetCabinTempC?: number | null
  /**
   * Latest departure timestamp in ISO 8601 / RFC3339. Required
   * for the AI draft to be useful — the deterministic departure
   * heuristic needs an end boundary. When absent the parent should
   * either compute a sensible default (e.g. the user's typical
   * departure time tomorrow) or leave the button disabled.
   */
  departBy?: string | null
}

/**
 * InnerSection is the always-rendered body of the AI preheat /
 * precool recommender card. The surrounding {@link withAiFeature}
 * HOC handles the visibility gate; this component only describes
 * the surface's appearance.
 *
 * Visual contract:
 *   - One GlassPanel sized to sit above the deterministic
 *     ClimateControlPage status cards.
 *   - Cyan AI badge in the header (matches the chatbot brand
 *     colour).
 *   - Draft button is disabled while a stream is open OR when no
 *     vehicleId / cabin temperature / outside temperature /
 *     depart_by is available from the parent page.
 *   - Title attribute carries the long-form explanation so a user
 *     hovering for a tooltip understands the privacy contract — only
 *     the vehicle name may be narrated; the temperatures and
 *     timestamps are the same the page below shows. The recommender
 *     never persists a schedule — it only proposes one and the user
 *     must click the existing manual climate controls Apply button
 *     to save it.
 */
function InnerSection({
  vehicleId,
  currentCabinTempC,
  outsideTempC,
  targetCabinTempC,
  departBy,
}: InnerSectionProps) {
  const { t } = useTranslation()
  const numericVehicleId =
    typeof vehicleId === 'number' ? vehicleId : Number(vehicleId)
  // The handler-side parser validates vehicle_id > 0 and
  // depart_by present + RFC3339; we mirror those preconditions
  // here to keep the button disabled when the parent has not yet
  // resolved them. The hook is called unconditionally with the
  // current body so the dependency graph stays stable regardless
  // of resolution.
  const target =
    typeof targetCabinTempC === 'number' && Number.isFinite(targetCabinTempC)
      ? targetCabinTempC
      : 21
  const body = useMemo(() => {
    return {
      vehicle_id: Number.isFinite(numericVehicleId) ? numericVehicleId : 0,
      depart_by: typeof departBy === 'string' ? departBy : '',
      current_cabin_temp_c:
        typeof currentCabinTempC === 'number' &&
        Number.isFinite(currentCabinTempC)
          ? currentCabinTempC
          : 0,
      outside_temp_c:
        typeof outsideTempC === 'number' && Number.isFinite(outsideTempC)
          ? outsideTempC
          : 0,
      target_cabin_temp_c: target,
    }
  }, [numericVehicleId, departBy, currentCabinTempC, outsideTempC, target])
  const stream = useAiStream({
    url: '/ai/climate/schedule/draft',
    body,
    onEvent: () => {},
  })
  const haveVehicle = Number.isFinite(numericVehicleId) && numericVehicleId > 0
  const haveDepart = typeof departBy === 'string' && departBy.length > 0
  const haveCabin =
    typeof currentCabinTempC === 'number' && Number.isFinite(currentCabinTempC)
  const haveOutside =
    typeof outsideTempC === 'number' && Number.isFinite(outsideTempC)
  const haveInputs = haveVehicle && haveDepart && haveCabin && haveOutside
    return (
    <AIFeatureCard
      title={t(
                  'climate.aiPreheatPrecool.title',
                  'Suggest a preheat or precool schedule',
                )}
      description={t(
                'climate.aiPreheatPrecool.description',
                'Ask Helix to draft a preheat or precool window grounded in the deterministic departure heuristic \u2014 start time, end time, mode (preheat | precool), and target cabin temperature. The temperatures are the same the panels below show; Helix never persists a schedule. Review the proposal and click Apply on the climate controls below to save it.',
              )}
      buttonLabel={t(
                  'climate.aiPreheatPrecool.generateButton',
                  'Draft schedule',
                )}
      badgeLabel={t('climate.aiPreheatPrecool.badge', 'Helix')}
      canStart={haveInputs}
      stream={stream}
    />
  )
}
InnerSection.displayName = 'AIPreheatPrecoolRecommenderInner'

/**
 * AIPreheatPrecoolRecommender renders the LLM preheat / precool
 * recommender section only when the preheat-precool-recommender
 * feature is enabled. The wrapping div from {@link withAiFeature}
 * carries `data-testid="ai-feature-preheat-precool-recommender-root"`,
 * which the off-mode invariant test asserts against.
 */
export const AIPreheatPrecoolRecommender = withAiFeature(
  'preheat-precool-recommender',
  InnerSection,
)
AIPreheatPrecoolRecommender.displayName = 'AIPreheatPrecoolRecommender'
