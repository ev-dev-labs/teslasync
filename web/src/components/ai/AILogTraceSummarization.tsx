// Visible AI surface for LiveLogsPage. The Summarize button POSTs to
// /api/v1/ai/system/logs/summarize via useAiStream so the UI and SSE
// wiring are delivered together.
//
// AILogTraceSummarization is the visible AI surface for the
// LiveLogsPage. It is rendered conditionally via
// withAiFeature('log-trace-summarization', …) so:
//
//   - When ai_mode='off' it does not render at all.
//   - When ai_mode is 'local'/'cloud' AND the
//     log-trace-summarization toggle is on, it renders an opt-in
//     section with a Summarize button that POSTs to
//     /api/v1/ai/system/logs/summarize. The SSE response stream
//     accumulates into the shared AiOutputPanel.
//
// The component does NOT replace the deterministic live-log
// stream rendered by LiveLogsPage. The streaming log table, the
// search filter, the stream controls, and the rest of the
// baseline experience remain the canonical view visible to every
// user; this AI section is opt-in read-only summarization layered
// alongside.
//
// Render contract:
//   - useAiStream is called unconditionally at the top of the body
//     (Hooks-rules safe).
//   - The Summarize button's disabled prop is a COMPUTED expression
//     (`!canSummarize`), never a literal `disabled` or
//     `disabled={true}`.
//   - Double-submit protection: stream.start() is a no-op while
//     state === 'streaming' (the hook coalesces; the button is
//     also visually disabled to mirror the state machine).
//   - The streamed text accumulates into AiOutputPanel which
//     renders the SSE delta stream as-it-arrives.
//
// AI safety contract:
//   - Baseline intact: this component never replaces the deterministic
//     log tail; it adds an opt-in summary section alongside.
//   - Hidden UI: withAiFeature returns null when the feature is disabled,
//     so the section is absent from the DOM in off mode.
//   - Off-mode routes: the backend route is guard-wrapped and
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
   * fromUnix is the inclusive start of the log/trace window in
   * Unix seconds. Required for the call to be valid; when absent
   * (because the parent has not yet computed a window) the
   * Summarize button stays disabled. The parent LiveLogsPage
   * derives this from the buffered log stream — newest event
   * time backward by 30 minutes, or the current time minus 30
   * minutes when the buffer is empty.
   */
  fromUnix?: number
  /**
   * toUnix is the inclusive end of the log/trace window in Unix
   * seconds. MUST be > fromUnix; the component otherwise refuses
   * to enable the Summarize button. The backend additionally
   * caps the window at 24 hours.
   */
  toUnix?: number
  /**
   * vehicleId narrows the window to one vehicle. Optional;
   * undefined or zero means "all vehicles" (the backend treats
   * vehicle_id=0 the same way).
   */
  vehicleId?: number
}

/**
 * InnerSection is the always-rendered body of the AI log-trace
 * summarization card. The surrounding {@link withAiFeature} HOC
 * handles the visibility gate; this component only describes the
 * surface's appearance.
 *
 * Visual contract:
 *   - One GlassPanel sized to sit above the deterministic
 *     LiveLogsPage table.
 *   - Cyan AI badge in the header (matches the chatbot brand
 *     colour).
 *   - A single Summarize button that submits a POST to the
 *     registered backend route. The body carries the in-scope
 *     window so the LLM cannot widen it.
 *   - Summarize button is disabled while a stream is open OR
 *     when the parent has not yet supplied a valid window. When
 *     disabled for a missing/invalid window an inline empty-state
 *     hint explains why, so the control is never silently dead.
 *   - Title attribute carries the long-form explanation so a
 *     user hovering for a tooltip understands the privacy
 *     contract — the LLM never sees raw log lines, only the
 *     redacted envelope and PolicyChatbot-redacted excerpts.
 */
function InnerSection({ fromUnix, toUnix, vehicleId }: InnerSectionProps) {
  const { t } = useTranslation()

  const haveWindow =
    typeof fromUnix === 'number' &&
    Number.isFinite(fromUnix) &&
    fromUnix > 0 &&
    typeof toUnix === 'number' &&
    Number.isFinite(toUnix) &&
    toUnix > fromUnix
  const windowSeconds = haveWindow ? (toUnix as number) - (fromUnix as number) : 0
  const windowAcceptable = haveWindow && windowSeconds <= 24 * 60 * 60

  // The backend reads from_unix, to_unix, and (optional)
  // vehicle_id from the body. useMemo keeps the body reference
  // stable so useAiStream's dependency-tracked re-render path
  // doesn't churn between renders that did not change the
  // window. When the window is unset we ship a placeholder body
  // that the button is disabled from posting.
  const body = useMemo(() => {
    if (!windowAcceptable) {
      return { from_unix: 0, to_unix: 0 }
    }
    const out: { from_unix: number; to_unix: number; vehicle_id?: number } = {
      from_unix: fromUnix as number,
      to_unix: toUnix as number,
    }
    if (typeof vehicleId === 'number' && Number.isFinite(vehicleId) && vehicleId > 0) {
      out.vehicle_id = vehicleId
    }
    return out
  }, [windowAcceptable, fromUnix, toUnix, vehicleId])

  // The hook is called unconditionally so Hooks-rules pass even
  // when the parent has not yet supplied a window. The URL is
  // the registered backend endpoint (the request() client that
  // useAiStream wraps prepends /api/v1).
  const stream = useAiStream({
    url: '/ai/system/logs/summarize',
    body,
    onEvent: () => {},
  })

  return (
    <AIFeatureCard
      title={t('liveLogs.aiSummary.title', 'Helix log/trace summary')}
      description={t(
        'liveLogs.aiSummary.description',
        'Get a 3-6 sentence factual summary of the recent log and trace window. The narrator is grounded in a redacted envelope of the same window the table below shows; it never invents log lines and never speculates about root cause.',
      )}
      buttonLabel={t('liveLogs.aiSummary.button', 'Summarize')}
      badgeLabel={t('liveLogs.aiSummary.badge', 'Helix')}
      emptyHint={
        windowAcceptable
          ? undefined
          : t('liveLogs.aiSummary.emptyHint', 'Waiting for a valid log window…')
      }
      canStart={windowAcceptable}
      stream={stream}
    />
  )
}
InnerSection.displayName = 'AILogTraceSummarizationInner'

/**
 * AILogTraceSummarization renders the LLM log/trace summary
 * section only when the log-trace-summarization feature is
 * enabled. The wrapping div from {@link withAiFeature} carries
 * `data-testid="ai-feature-log-trace-summarization-root"`, which
 * the off-mode invariant test asserts against.
 */
export const AILogTraceSummarization = withAiFeature(
  'log-trace-summarization',
  InnerSection,
)
AILogTraceSummarization.displayName = 'AILogTraceSummarization'
