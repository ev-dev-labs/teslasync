// Phase-50 / 0046 — S5 Feedback queue triage.
// Phase-50 / W1 inline wiring (per slice prompt 0046) — wired the
// "Suggest triage" button to POST /api/v1/ai/feedback/triage/draft
// via the canonical useAiStream hook. The slice methodology forbids
// shipping the visual affordance without end-to-end SSE wiring;
// this component lands both in one commit so the on-mode wiring
// test (TestFeedbackQueueTriageAIOnWiredCallsRoute) can prove the
// button actually opens an SSE stream against the registered
// backend route.
//
// AIFeedbackQueueTriage is the visible AI surface for the Admin
// FeedbackQueuePage. It is rendered conditionally via
// withAiFeature('feedback-queue-triage', …) so:
//
//   - When ai_mode='off' it does not render at all (ADR-015 §I5 + §I6).
//   - When ai_mode is 'local'/'cloud' AND the feedback-queue-triage
//     toggle is on, it renders an opt-in section beneath the manual
//     triage controls inside the per-row expansion. The button
//     POSTs `{feedback_id}` to /api/v1/ai/feedback/triage/draft and
//     the SSE response stream accumulates into the shared
//     AiOutputPanel.
//
// The component does NOT replace the deterministic manual triage
// controls (Status Select, GitHub URL Input, Save URL button,
// Forward to GitHub button). Those remain the sole write path:
// even when the AI advisor returns a proposed status, the operator
// is the only entity that can persist it via the existing
// useUpdateFeedback() mutation. ADR-015 §I3 + §I8 propose-only.
//
// Render contract (P11/P12 — Wired-or-absent, No-placeholder-buttons):
//   - useAiStream is called unconditionally at the top of the body
//     (Hooks-rules safe).
//   - The "Suggest triage" button's disabled prop is a COMPUTED
//     expression (`!canDraft`), never a literal `disabled` or
//     `disabled={true}`.
//   - Double-submit protection: stream.start() is a no-op while
//     state === 'streaming' (the hook coalesces; the button is
//     also visually disabled to mirror the state machine).
//   - The streamed text accumulates into AiOutputPanel which
//     renders the SSE delta stream as-it-arrives.
//
// ADR-015 alignment:
//   - I3 baseline intact: this component never replaces the manual
//     triage controls; it adds an opt-in advisor section alongside.
//   - I5 hidden UI:       the withAiFeature HOC returns null when
//     the feature is not enabled, so the section is entirely absent
//     from the DOM in off mode.
//   - I6 404 routes:      the backend route is guard-wrapped and
//     returns 404 in off mode; useAiStream surfaces that as
//     state='error' for the user, but the component is never
//     rendered in off mode at all because of I5.
//   - I8 propose-only:    the AI surface NEVER calls the
//     useUpdateFeedback mutation. The proposed labels are
//     informational; the operator's existing manual controls
//     remain the sole write path.

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AiOutputPanel } from '@/components/ai/AiOutputPanel'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { Button, GlassPanel } from '@/components/ui'
import { useAiStream } from '@/hooks/useAiStream'

interface InnerSectionProps {
  /**
   * feedbackId is the user_feedback row this advisor proposes
   * triage labels for. Required for the call to be valid; when
   * absent (because the parent has not yet selected a row) the
   * "Suggest triage" button stays disabled. The parent
   * FeedbackQueuePage derives this from the per-row expansion —
   * each row's expanded section mounts its own component instance
   * with that row's id.
   */
  feedbackId?: number
}

/**
 * InnerSection is the always-rendered body of the AI feedback
 * triage advisor card. The surrounding {@link withAiFeature} HOC
 * handles the visibility gate; this component only describes the
 * surface's appearance.
 *
 * Visual contract:
 *   - One GlassPanel sized to sit beneath the manual triage
 *     controls inside the per-row expansion.
 *   - Cyan AI badge in the header (matches the chatbot brand
 *     colour).
 *   - A single "Suggest triage" button that submits a POST to
 *     the registered backend route. The body carries the
 *     in-scope feedback_id so the LLM cannot widen it.
 *   - "Suggest triage" button is disabled while a stream is open
 *     OR when the parent has not yet supplied a valid feedback id.
 *   - Title attribute carries the long-form explanation so a
 *     user hovering for a tooltip understands the privacy
 *     contract — the LLM never sees email/IP/console-tail/recent-
 *     errors, only the redacted envelope (id, category, title,
 *     body excerpt, page route, app version, status, created_at).
 */
function InnerSection({ feedbackId }: InnerSectionProps) {
  const { t } = useTranslation()

  const haveFeedback =
    typeof feedbackId === 'number' && Number.isFinite(feedbackId) && feedbackId > 0

  // The backend reads feedback_id from the body. useMemo keeps
  // the body reference stable so useAiStream's dependency-tracked
  // re-render path doesn't churn between renders that did not
  // change the row id. When the feedback id is unset we ship a
  // placeholder body that the button is disabled from posting.
  const body = useMemo(() => {
    if (!haveFeedback) {
      return { feedback_id: 0 }
    }
    return { feedback_id: feedbackId as number }
  }, [haveFeedback, feedbackId])

  // The hook is called unconditionally so Hooks-rules pass even
  // when the parent has not yet supplied a feedback id. The URL
  // is the registered backend endpoint (the request() client that
  // useAiStream wraps prepends /api/v1).
  const stream = useAiStream({
    url: '/ai/feedback/triage/draft',
    body,
    onEvent: () => {},
  })

  const canDraft = haveFeedback && stream.state !== 'streaming'

  return (
    <GlassPanel>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-white/90">
                {t('feedbackTriage.aiAdvisor.title', 'AI triage advisor')}
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
                {t('feedbackTriage.aiAdvisor.badge', 'AI')}
              </span>
            </div>
            <p className="text-sm text-white/60">
              {t(
                'feedbackTriage.aiAdvisor.description',
                'Get a proposed status, category, and priority label for this feedback row. The advisor reads only the redacted envelope (id, category, title, body excerpt, page route, app version, status, created_at) — never the reporter email, IP, console tail, or recent errors. The proposal is informational; your existing manual controls above remain the only way to save changes.',
              )}
            </p>
            {!haveFeedback && (
              <p className="text-xs text-white/40">
                {t(
                  'feedbackTriage.aiAdvisor.emptyHint',
                  'Waiting for a feedback row\u2026',
                )}
              </p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={!canDraft}
            aria-disabled={!canDraft ? 'true' : 'false'}
            onClick={() => stream.start()}
            title={t(
              'feedbackTriage.aiAdvisor.description',
              'Get a proposed status, category, and priority label for this feedback row. The advisor reads only the redacted envelope (id, category, title, body excerpt, page route, app version, status, created_at) — never the reporter email, IP, console tail, or recent errors. The proposal is informational; your existing manual controls above remain the only way to save changes.',
            )}
          >
            {stream.state === 'streaming'
              ? t('ai.common.generating', 'Generating\u2026')
              : t('feedbackTriage.aiAdvisor.button', 'Suggest triage')}
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
InnerSection.displayName = 'AIFeedbackQueueTriageInner'

/**
 * AIFeedbackQueueTriage renders the LLM feedback triage advisor
 * section only when the feedback-queue-triage feature is enabled.
 * The wrapping div from {@link withAiFeature} carries
 * `data-testid="ai-feature-feedback-queue-triage-root"`, which
 * the off-mode invariant test asserts against.
 */
export const AIFeedbackQueueTriage = withAiFeature(
  'feedback-queue-triage',
  InnerSection,
)
AIFeedbackQueueTriage.displayName = 'AIFeedbackQueueTriage'
