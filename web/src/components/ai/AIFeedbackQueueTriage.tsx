// Feedback queue triage wires the "Suggest triage" button to POST
// /api/v1/ai/feedback/triage/draft via useAiStream. The on-mode
// wiring test proves the button opens an SSE stream against the
// registered backend route.

// AIFeedbackQueueTriage is the visible AI surface for the Admin
// FeedbackQueuePage. It is rendered conditionally via
// withAiFeature('feedback-queue-triage', …) so:

// - When ai_mode='off' it does not render at all.
// - When ai_mode is 'local'/'cloud' AND the feedback-queue-triage
// toggle is on, it renders an opt-in section beneath the manual
// triage controls inside the per-row expansion. The button
// POSTs `{feedback_id}` to /api/v1/ai/feedback/triage/draft and
// the SSE response stream accumulates into the shared
// AiOutputPanel.

// The component does NOT replace the deterministic manual triage
// controls (Status Select, GitHub URL Input, Save URL button,
// Forward to GitHub button). Those remain the sole write path:
// even when the AI advisor returns a proposed status, the operator
// is the only entity that can persist it via the existing
// useUpdateFeedback() mutation.

// Render contract (Wired-or-absent, No-placeholder-buttons):
// - useAiStream is called unconditionally at the top of the body
// (Hooks-rules safe).
// - The "Suggest triage" button's disabled prop is a COMPUTED
// expression (`!canDraft`), never a literal `disabled` or
// `disabled={true}`.
// - Double-submit protection: stream.start() is a no-op while
// state === 'streaming' (the hook coalesces; the button is
// also visually disabled to mirror the state machine).
// - The streamed text accumulates into AiOutputPanel which
// renders the SSE delta stream as-it-arrives.

// Safety alignment:
// - Baseline intact: this component adds an opt-in advisor section
//   alongside the manual triage controls; it never replaces them.
// - Hidden UI: withAiFeature returns null when the feature is not enabled,
//   so the section is absent from the DOM in off mode.
// - Guarded route: the backend returns 404 in off mode; useAiStream surfaces
//   that as state='error', but this component is not rendered in off mode.
// - Propose-only: the AI surface never calls useUpdateFeedback. Proposed
//   labels are informational; the operator's manual controls stay authoritative.

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { useAiStream } from '@/hooks/useAiStream'

// The advisor renders the accumulated delta text through AiOutputPanel
// and never reacts to individual stream frames, so onEvent is a stable
// module-scope no-op. Keeping the reference identical across renders
// avoids re-running useAiStream's onEvent ref-sync effect every time the
// parent per-row expansion re-renders.
const noopStreamEvent = (): void => {}

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
 * - One GlassPanel sized to sit beneath the manual triage
 * controls inside the per-row expansion.
 * - Cyan AI badge in the header (matches the chatbot brand
 * colour).
 * - A single "Suggest triage" button that submits a POST to
 * the registered backend route. The body carries the
 * in-scope feedback_id so the LLM cannot widen it.
 * - "Suggest triage" button is disabled while a stream is open
 * OR when the parent has not yet supplied a valid feedback id.
 * When disabled for a missing id, an empty-state hint explains
 * that the operator must select a feedback row first, so the
 * control is never a bare, unexplained affordance.
 * - Title attribute carries the long-form explanation so a
 * user hovering for a tooltip understands the privacy
 * contract — the LLM never sees email/IP/console-tail/recent-
 * errors, only the redacted envelope (id, category, title,
 * body excerpt, page route, app version, status, created_at).
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
    onEvent: noopStreamEvent,
  })

  return (
    <AIFeatureCard
      title={t('feedbackTriage.aiAdvisor.title', 'Helix triage advisor')}
      description={t(
                'feedbackTriage.aiAdvisor.description',
                'Get a proposed status, category, and priority label for this feedback row. The advisor reads only the redacted envelope (id, category, title, body excerpt, page route, app version, status, created_at) — never the reporter email, IP, console tail, or recent errors. The proposal is informational; your existing manual controls above remain the only way to save changes.',
              )}
      buttonLabel={t('feedbackTriage.aiAdvisor.button', 'Suggest triage')}
      badgeLabel={t('feedbackTriage.aiAdvisor.badge', 'Helix')}
      emptyHint={t(
        'feedbackTriage.aiAdvisor.emptyHint',
        'Select a feedback row to suggest triage labels.',
      )}
      canStart={haveFeedback}
      stream={stream}
    />
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
