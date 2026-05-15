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

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { Textarea } from '@/components/ui'
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

function InnerSection({ vehicleId }: InnerSectionProps) {
  const { t } = useTranslation()
  const [question, setQuestion] = useState('')

  const numericVehicleId =
    typeof vehicleId === 'number' ? vehicleId : Number(vehicleId)

  const trimmedQuestion = question.trim()

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

  return (
    <AIFeatureCard
      title={t('lifetime.aiQA.title', 'Ask about your lifetime stats')}
      description={t(
        'lifetime.aiQA.description',
        'Ask Helix a natural-language question about your all-time stats \u2014 total distance, charging savings, achievements, personal records. Answers are grounded in the same deterministic envelope the dashboard below shows; the narrator never invents numbers.',
      )}
      buttonLabel={t('lifetime.aiQA.askButton', 'Ask')}
      badgeLabel={t('lifetime.aiQA.badge', 'Helix')}
      canStart={haveVehicle && haveQuestion}
      stream={stream}
      inputSlot={
        <Textarea
          rows={3}
          placeholder={t(
            'lifetime.aiQA.placeholder',
            'e.g. How far have I driven in total? How much have I saved on fuel?',
          )}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={MaxQuestionChars}
          aria-label={t('lifetime.aiQA.inputLabel', 'Your question')}
        />
      }
    />
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
