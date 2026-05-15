// Phase-50 / 0041 — X2 Lifetime stats Q&A.
// Phase-50 / W1 inline wiring (per slice prompt 0041) — wired the
// Ask button to POST /api/v1/ai/analytics/lifetime/qa via the
// canonical useAiStream hook. The slice methodology forbids
// shipping the visual affordance without end-to-end SSE wiring;
// this component lands both in one commit so the on-mode wiring
// test (TestLifetimeStatsQaAIOnWiredCallsRoute) can prove the
// button actually opens an SSE stream against the registered
// backend route.
//
// AILifetimeStatsQA is the visible AI surface for the Lifetime
// Stats page. It is rendered conditionally via
// withAiFeature('lifetime-stats-qa', …) so:
//
//   - When ai_mode='off' it does not render at all (ADR-015 §I5 + §I6).
//   - When ai_mode is 'local'/'cloud' AND the lifetime-stats-qa
//     toggle is on, it renders an opt-in section with a question
//     input and Ask button that POSTs to
//     /api/v1/ai/analytics/lifetime/qa. The SSE response stream
//     accumulates into the shared AiOutputPanel.
//
// The component does NOT replace the deterministic lifetime-stats
// hero card, key-stats grid, achievements gallery, fun-facts cards,
// personal-records panel, or ownership timeline rendered by
// LifetimeStatsPage. That baseline content remains the canonical
// view visible to every user; this AI section is opt-in read-only
// Q&A layered alongside.
//
// Render contract (P11/P12 — Wired-or-absent, No-placeholder-buttons):
//   - useAiStream is called unconditionally at the top of the body
//     (Hooks-rules safe).
//   - The Ask button's disabled prop is a COMPUTED expression
//     (`!canAsk`), never a literal `disabled` or `disabled={true}`.
//   - Double-submit protection: stream.start() is a no-op while
//     state === 'streaming' (the hook coalesces; the button is
//     also visually disabled to mirror the state machine).
//   - The streamed text accumulates into AiOutputPanel which
//     renders the SSE delta stream as-it-arrives.
//
// ADR-015 alignment:
//   - I3 baseline intact: this component never replaces the
//     deterministic lifetime-stats dashboard; it adds an opt-in
//     Q&A section alongside.
//   - I5 hidden UI:       the withAiFeature HOC returns null when
//     the feature is not enabled, so the section is entirely
//     absent from the DOM in off mode.
//   - I6 404 routes:      the backend route is guard-wrapped and
//     returns 404 in off mode; useAiStream surfaces that as
//     state='error' for the user, but the component is never
//     rendered in off mode at all because of I5.

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AiOutputPanel } from '@/components/ai/AiOutputPanel'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { Button, GlassPanel } from '@/components/ui'
import { useAiStream } from '@/hooks/useAiStream'

// MaxQuestionChars mirrors the backend handler's
// aiLifetimeStatsQAMaxQuestionChars cap so a parser-rejection
// 400 never reaches the user. Keep these two values in sync.
const MaxQuestionChars = 1024

interface InnerSectionProps {
  /**
   * vehicleId surfaced by the parent LifetimeStatsPage. Optional
   * because the active-vehicle context may be unresolved at first
   * paint; when absent we still render the section (the gate has
   * already passed) but the Ask button stays disabled because the
   * backend call needs a vehicle in scope.
   */
  vehicleId?: string | number
}

/**
 * InnerSection is the always-rendered body of the AI lifetime-stats
 * Q&A card. The surrounding {@link withAiFeature} HOC handles the
 * visibility gate; this component only describes the surface's
 * appearance.
 *
 * Visual contract:
 *   - One GlassPanel sized to sit above the Lifetime Stats hero
 *     card on LifetimeStatsPage.
 *   - Cyan AI badge in the header (matches the chatbot brand
 *     colour).
 *   - A single textarea for the user's question and an Ask button
 *     that submits a POST to the registered backend route.
 *   - Ask button is disabled while a stream is open OR when the
 *     question is empty OR when no vehicleId is available from
 *     the active-vehicle context.
 *   - Title attribute carries the long-form explanation so a user
 *     hovering for a tooltip understands the privacy contract —
 *     every PII class is redacted to a round-trip tag including
 *     vehicle name, and the answer is grounded in the same
 *     deterministic envelope the dashboard renders.
 */
function InnerSection({ vehicleId }: InnerSectionProps) {
  const { t } = useTranslation()
  const [question, setQuestion] = useState('')

  const numericVehicleId =
    typeof vehicleId === 'number' ? vehicleId : Number(vehicleId)

  const trimmedQuestion = question.trim()

  // The handler-side parser validates vehicle_id > 0 and
  // question != "" with len(question) <= 1024; we mirror that
  // here to keep the button disabled when the parent has not yet
  // resolved the active vehicle or the user has not typed
  // anything. The hook is called unconditionally with the current
  // body so the dependency graph stays stable regardless of
  // resolution.
  const body = useMemo(
    () => ({
      vehicle_id: Number.isFinite(numericVehicleId) ? numericVehicleId : 0,
      question: trimmedQuestion,
    }),
    [numericVehicleId, trimmedQuestion],
  )
  const stream = useAiStream({
    url: '/ai/analytics/lifetime/qa',
    body,
    onEvent: () => {},
  })
  const haveVehicle = Number.isFinite(numericVehicleId) && numericVehicleId > 0
  const haveQuestion =
    trimmedQuestion.length > 0 && trimmedQuestion.length <= MaxQuestionChars
  const canAsk = haveVehicle && haveQuestion && stream.state !== 'streaming'

  return (
    <GlassPanel>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-white/90">
                {t(
                  'lifetime.aiQA.title',
                  'Ask about your lifetime stats',
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
                {t('lifetime.aiQA.badge', 'AI')}
              </span>
            </div>
            <p className="text-sm text-white/60">
              {t(
                'lifetime.aiQA.description',
                'Ask the AI a natural-language question about your all-time stats \u2014 total distance, charging savings, achievements, personal records. Answers are grounded in the same deterministic envelope the dashboard below shows; the narrator never invents numbers.',
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <textarea
            className="min-h-[72px] w-full resize-y rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/90 placeholder:text-white/30 focus:border-cyan-300/40 focus:outline-none focus:ring-2 focus:ring-cyan-300/20"
            placeholder={t(
              'lifetime.aiQA.placeholder',
              'e.g. How far have I driven in total? How much have I saved on fuel?',
            )}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={MaxQuestionChars}
            aria-label={t('lifetime.aiQA.inputLabel', 'Your question')}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={!canAsk}
            aria-disabled={!canAsk ? 'true' : 'false'}
            onClick={() => stream.start()}
            title={t(
              'lifetime.aiQA.description',
              'Ask the AI a natural-language question about your all-time stats \u2014 total distance, charging savings, achievements, personal records. Answers are grounded in the same deterministic envelope the dashboard below shows; the narrator never invents numbers.',
            )}
          >
            {stream.state === 'streaming'
              ? t('ai.common.generating', 'Generating\u2026')
              : t('lifetime.aiQA.askButton', 'Ask')}
          </Button>
        </div>
        <AiOutputPanel
          text={stream.text}
          state={stream.state}
          error={stream.error}
        />
      </div>
    </GlassPanel>
  )
}
InnerSection.displayName = 'AILifetimeStatsQAInner'

/**
 * AILifetimeStatsQA renders the LLM lifetime-stats Q&A section only
 * when the lifetime-stats-qa feature is enabled. The wrapping div
 * from {@link withAiFeature} carries
 * `data-testid="ai-feature-lifetime-stats-qa-root"`, which the
 * off-mode invariant test asserts against.
 */
export const AILifetimeStatsQA = withAiFeature(
  'lifetime-stats-qa',
  InnerSection,
)
AILifetimeStatsQA.displayName = 'AILifetimeStatsQA'
