// Phase-50 / 0032 — T2 Cabin temperature impact narrative.
// Phase-50 / W1 inline wiring (per slice prompt 0032) — wired the
// Narrate button to POST /api/v1/ai/climate/temperature-impact/narrate
// via the canonical useAiStream hook. The slice methodology forbids
// shipping the visual affordance without end-to-end SSE wiring; this
// component lands both in one commit so the on-mode wiring test
// (TestCabinTemperatureNarrativeAIOnWiredCallsRoute) can prove the
// button actually opens an SSE stream against the registered backend
// route.
//
// AICabinTemperatureImpactNarrative is the visible AI surface for
// the Temperature Impact analytics page. It is rendered conditionally
// via withAiFeature('cabin-temperature-impact-narrative', …) so:
//
//   - When ai_mode='off' it does not render at all (ADR-015 §I5 + §I6).
//   - When ai_mode is 'local'/'cloud' AND the
//     cabin-temperature-impact-narrative toggle is on, it renders an
//     opt-in section with a Narrate button that POSTs to
//     /api/v1/ai/climate/temperature-impact/narrate. The SSE response
//     stream accumulates into the shared AiOutputPanel.
//
// The component does NOT replace the deterministic temperature-bucket
// efficiency chart, the monthly seasonal trend, the recent-drives
// table, or any other content rendered by TemperatureImpactPage. That
// baseline content remains the canonical view visible to every user;
// this AI section is opt-in read-only narration layered alongside.
//
// Render contract (P11/P12 — Wired-or-absent, No-placeholder-buttons):
//   - useAiStream is called unconditionally at the top of the body
//     (Hooks-rules safe).
//   - The Narrate button's disabled prop is a COMPUTED expression
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
//     deterministic temperature-impact charts; it adds an opt-in
//     narrative section alongside.
//   - I5 hidden UI:       the withAiFeature HOC returns null when
//     the feature is not enabled, so the section is entirely
//     absent from the DOM in off mode.
//   - I6 404 routes:      the backend route is guard-wrapped and
//     returns 404 in off mode; useAiStream surfaces that as
//     state='error' for the user, but the component is never
//     rendered in off mode at all because of I5.

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AiOutputPanel } from '@/components/ai/AiOutputPanel'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { Button, GlassPanel } from '@/components/ui'
import { useAiStream } from '@/hooks/useAiStream'

interface InnerSectionProps {
  /**
   * vehicleId surfaced by the parent TemperatureImpactPage. Optional
   * because the active-vehicle context may be unresolved at first
   * paint; when absent we still render the section (the gate has
   * already passed) but the Narrate button stays disabled because
   * the backend call needs a vehicle in scope.
   */
  vehicleId?: string | number
}

/**
 * InnerSection is the always-rendered body of the AI cabin
 * temperature impact narration card. The surrounding
 * {@link withAiFeature} HOC handles the visibility gate; this
 * component only describes the surface's appearance.
 *
 * Visual contract:
 *   - One GlassPanel sized to sit above the temperature-bucket
 *     efficiency chart on TemperatureImpactPage.
 *   - Cyan AI badge in the header (matches the chatbot brand
 *     colour).
 *   - Narrate button is disabled while a stream is open OR when no
 *     vehicleId is available from the active-vehicle context.
 *   - Title attribute carries the long-form explanation so a user
 *     hovering for a tooltip understands the privacy contract — only
 *     the vehicle name may be narrated; the bucket / monthly trend
 *     numbers are the same the chart shows. The narrator never
 *     changes the deterministic aggregates — it only explains them.
 */
function InnerSection({ vehicleId }: InnerSectionProps) {
  const { t } = useTranslation()
  const numericVehicleId =
    typeof vehicleId === 'number' ? vehicleId : Number(vehicleId)
  // The handler-side parser validates vehicle_id > 0; we mirror
  // that here to keep the button disabled when the parent has not
  // yet resolved the active vehicle. The hook is called
  // unconditionally with the current body so the dependency graph
  // stays stable regardless of vehicleId resolution.
  const body = useMemo(() => {
    const out: { vehicle_id: number } = {
      vehicle_id: Number.isFinite(numericVehicleId) ? numericVehicleId : 0,
    }
    return out
  }, [numericVehicleId])
  const stream = useAiStream({
    url: '/ai/climate/temperature-impact/narrate',
    body,
    onEvent: () => {},
  })
  const haveInputs = Number.isFinite(numericVehicleId) && numericVehicleId > 0
  const canGenerate = haveInputs && stream.state !== 'streaming'
  return (
    <GlassPanel>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-white/90">
                {t(
                  'tempImpact.aiNarrative.title',
                  'Narrate the cabin-temperature impact',
                )}
              </h3>
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2.5 py-1 text-xs font-medium text-cyan-300"
                title={t(
                  'chatbot.llm.indicatorTooltip',
                  'Responses are generated by an LLM with redacted vehicle context.',
                )}
                aria-label={t('chatbot.llm.indicator', 'AI mode')}
              >
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full bg-cyan-300"
                  aria-hidden="true"
                />
                {t('tempImpact.aiNarrative.badge', 'AI')}
              </span>
            </div>
            <p className="text-sm text-white/60">
              {t(
                'tempImpact.aiNarrative.description',
                'Ask the AI narrator to explain how outside ambient temperature affects this vehicle\u2019s efficiency \u2014 which temperature bucket runs most efficiently, how cold-weather months compare with mild-weather months, and what the seasonal pattern in the chart implies. The bucket and monthly numbers are the same the chart below shows; the narrator only explains them and is honest that these are descriptive aggregates of recent drives, not a forecast.',
              )}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={!canGenerate}
            aria-disabled={!canGenerate ? 'true' : 'false'}
            onClick={() => stream.start()}
            title={t(
              'tempImpact.aiNarrative.description',
              'Ask the AI narrator to explain how outside ambient temperature affects this vehicle\u2019s efficiency \u2014 which temperature bucket runs most efficiently, how cold-weather months compare with mild-weather months, and what the seasonal pattern in the chart implies. The bucket and monthly numbers are the same the chart below shows; the narrator only explains them and is honest that these are descriptive aggregates of recent drives, not a forecast.',
            )}
          >
            {stream.state === 'streaming'
              ? t('ai.common.generating', 'Generating\u2026')
              : t('tempImpact.aiNarrative.generateButton', 'Narrate impact')}
          </Button>
        </div>
        <AiOutputPanel text={stream.text} state={stream.state} error={stream.error} />
      </div>
    </GlassPanel>
  )
}
InnerSection.displayName = 'AICabinTemperatureImpactNarrativeInner'

/**
 * AICabinTemperatureImpactNarrative renders the LLM cabin
 * temperature impact narration section only when the
 * cabin-temperature-impact-narrative feature is enabled. The
 * wrapping div from {@link withAiFeature} carries
 * `data-testid="ai-feature-cabin-temperature-impact-narrative-root"`,
 * which the off-mode invariant test asserts against.
 */
export const AICabinTemperatureImpactNarrative = withAiFeature(
  'cabin-temperature-impact-narrative',
  InnerSection,
)
AICabinTemperatureImpactNarrative.displayName = 'AICabinTemperatureImpactNarrative'
