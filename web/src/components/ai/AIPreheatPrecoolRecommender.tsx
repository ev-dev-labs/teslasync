// Preheat and precool recommender.
//
// The Draft button posts to /api/v1/ai/climate/schedule/draft via
// useAiStream; the on-mode wiring test proves the button opens an
// SSE stream against the registered backend route.
//
// AIPreheatPrecoolRecommender is the visible AI surface for the
// ClimateControlPage. It is rendered conditionally via
// withAiFeature('preheat-precool-recommender', …) so:
//
//   - When ai_mode='off' it does not render at all.
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
// Render contract:
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
// AI-mode alignment:
//   - Baseline intact: this component never replaces the
//     deterministic climate-control panels; it adds an opt-in
//     propose-only section alongside.
//   - Hidden UI:          the withAiFeature HOC returns null when
//     the feature is not enabled, so the section is entirely
//     absent from the DOM in off mode.
//   - Off-mode routes:    the backend route is guard-wrapped and
//     returns 404 in off mode; useAiStream surfaces that as
//     state='error' for the user, but the component is never
//     rendered in off mode at all because of I5.
//   - Propose-only:       Helix never persists a schedule; the
//     narration explicitly directs the user to click the
//     canonical Apply button on the climate controls below.

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { useAiStream } from '@/hooks/useAiStream'

// The recommender consumes the accumulated delta text through
// AiOutputPanel and never reacts to individual stream frames, so
// onEvent is a stable no-op. Hoisting it to module scope keeps the
// reference identical across renders, which avoids re-running
// useAiStream's onEvent ref-sync effect on every parent re-render.
const noopStreamEvent = (): void => {}

// DEFAULT_TARGET_CABIN_TEMP_C is the comfortable cabin temperature the
// deterministic departure heuristic assumes when the parent has not
// supplied an explicit target. The backend parser bounds the target to
// [10, 32]°C; 21°C sits comfortably inside that window.
const DEFAULT_TARGET_CABIN_TEMP_C = 21

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
 *   - While the Draft button is disabled for want of inputs, an
 *     empty-state hint explains which inputs are still missing so
 *     the control is never a bare, unexplained disabled button.
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

  // The handler-side parser validates vehicle_id > 0 and depart_by
  // present + RFC3339, and the deterministic departure heuristic needs
  // a cabin + outside temperature to bound the warm-up / cool-down
  // window. We mirror those preconditions here so the Draft button
  // stays disabled until the parent has resolved every input. The hook
  // is called unconditionally with the current body so the dependency
  // graph stays stable regardless of resolution.
  const haveVehicle = Number.isFinite(numericVehicleId) && numericVehicleId > 0
  const haveDepart = typeof departBy === 'string' && departBy.length > 0
  const haveCabin =
    typeof currentCabinTempC === 'number' && Number.isFinite(currentCabinTempC)
  const haveOutside =
    typeof outsideTempC === 'number' && Number.isFinite(outsideTempC)
  const haveInputs = haveVehicle && haveDepart && haveCabin && haveOutside

  const target =
    typeof targetCabinTempC === 'number' && Number.isFinite(targetCabinTempC)
      ? targetCabinTempC
      : DEFAULT_TARGET_CABIN_TEMP_C

  const body = useMemo(() => {
    return {
      // Only ever forward a resolved, positive vehicle id; otherwise
      // fall back to the 0 sentinel the disabled button never sends.
      // Keeping the body in lockstep with the have* gate means a stale
      // negative / NaN id can never be POSTed even if a future refactor
      // decouples the button's disabled state from `haveInputs`.
      vehicle_id: haveVehicle ? numericVehicleId : 0,
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
  }, [haveVehicle, numericVehicleId, departBy, currentCabinTempC, outsideTempC, target])

  const stream = useAiStream({
    url: '/ai/climate/schedule/draft',
    body,
    onEvent: noopStreamEvent,
    // AI-01: vehicle + departure scope is part of stream identity —
    // changing either aborts an in-flight draft and clears the
    // previous scope's recommendation before the new scope streams in.
    scopeKey: haveVehicle ? `${numericVehicleId}:${departBy ?? ''}` : null,
  })

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
      emptyHint={t(
        'climate.aiPreheatPrecool.emptyHint',
        'Select a vehicle and confirm the cabin temperature, outside temperature, and departure time to draft a schedule.',
      )}
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
