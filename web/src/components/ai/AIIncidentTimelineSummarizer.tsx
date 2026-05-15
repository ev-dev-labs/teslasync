// Phase-50 / 0042 — S1 Incident timeline summarizer.
// Phase-50 / W1 inline wiring (per slice prompt 0042) — wired the
// Summarize button to POST
// /api/v1/ai/system/incidents/{incidentID}/summarize via the
// canonical useAiStream hook. The slice methodology forbids
// shipping the visual affordance without end-to-end SSE wiring;
// this component lands both in one commit so the on-mode wiring
// test (TestIncidentTimelineSummarizerAIOnWiredCallsRoute) can
// prove the button actually opens an SSE stream against the
// registered backend route.
//
// AIIncidentTimelineSummarizer is the visible AI surface for the
// per-incident IncidentTimelinePage. It is rendered conditionally
// via withAiFeature('incident-timeline-summarizer', …) so:
//
//   - When ai_mode='off' it does not render at all (ADR-015 §I5 + §I6).
//   - When ai_mode is 'local'/'cloud' AND the
//     incident-timeline-summarizer toggle is on, it renders an
//     opt-in section with a Summarize button that POSTs to
//     /api/v1/ai/system/incidents/{incidentID}/summarize. The SSE
//     response stream accumulates into the shared AiOutputPanel.
//
// The component does NOT replace the deterministic incident
// timeline list, append-update form, or lifecycle controls
// rendered by IncidentTimelinePage. That baseline content remains
// the canonical view visible to every user; this AI section is
// opt-in read-only summarization layered alongside.
//
// Render contract (P11/P12 — Wired-or-absent, No-placeholder-buttons):
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
// ADR-015 alignment:
//   - I3 baseline intact: this component never replaces the
//     deterministic incident timeline; it adds an opt-in summary
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

import { AiOutputPanel } from '@/components/ai/AiOutputPanel'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { Button, GlassPanel } from '@/components/ui'
import { useAiStream } from '@/hooks/useAiStream'

interface InnerSectionProps {
  /**
   * incidentId surfaced by the parent IncidentTimelinePage. The
   * ID is used both to (a) compose the backend URL path and (b)
   * keep useAiStream's body stable across renders. Optional only
   * because the parent's data fetch may be unresolved at first
   * paint; when absent we still render the section (the gate has
   * already passed) but the Summarize button stays disabled because
   * the backend call needs an incident in scope.
   */
  incidentId?: string | number
}

/**
 * InnerSection is the always-rendered body of the AI incident
 * timeline summarizer card. The surrounding {@link withAiFeature}
 * HOC handles the visibility gate; this component only describes
 * the surface's appearance.
 *
 * Visual contract:
 *   - One GlassPanel sized to sit above the deterministic incident
 *     timeline list on IncidentTimelinePage.
 *   - Cyan AI badge in the header (matches the chatbot brand
 *     colour).
 *   - A single Summarize button that submits a POST to the
 *     registered backend route. There is no user-supplied
 *     question — the summarization is a one-shot read of the
 *     in-scope incident.
 *   - Summarize button is disabled while a stream is open OR
 *     when no incidentId is available.
 *   - Title attribute carries the long-form explanation so a user
 *     hovering for a tooltip understands the privacy contract —
 *     every PII class is redacted to a round-trip tag, and the
 *     summary is grounded in the same deterministic envelope the
 *     timeline below renders.
 */
function InnerSection({ incidentId }: InnerSectionProps) {
  const { t } = useTranslation()

  const numericIncidentId =
    typeof incidentId === 'number' ? incidentId : Number(incidentId)
  const haveIncident =
    Number.isFinite(numericIncidentId) && numericIncidentId > 0

  // The backend reads incident_id from the URL path; the body is
  // intentionally empty. useMemo keeps the body reference stable so
  // useAiStream's dependency-tracked re-render path doesn't churn.
  const body = useMemo(() => ({}), [])

  // The hook is called unconditionally with a placeholder URL when
  // the parent has not yet resolved the incident; haveIncident
  // gates the canSummarize flag so the button stays disabled until
  // we have a real ID. The placeholder URL is never POSTed because
  // the user cannot click the button while it is disabled (and
  // useAiStream itself short-circuits on a no-op start()).
  const url = haveIncident
    ? `/ai/system/incidents/${numericIncidentId}/summarize`
    : '/ai/system/incidents/0/summarize'

  const stream = useAiStream({
    url,
    body,
    onEvent: () => {},
  })

  const canSummarize = haveIncident && stream.state !== 'streaming'

  return (
    <GlassPanel>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-white/90">
                {t(
                  'incidentTimeline.aiSummary.title',
                  'AI timeline summary',
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
                {t('incidentTimeline.aiSummary.badge', 'AI')}
              </span>
            </div>
            <p className="text-sm text-white/60">
              {t(
                'incidentTimeline.aiSummary.description',
                'Get a 3-6 sentence factual summary of this incident\u2019s timeline. The summary is grounded in the same deterministic envelope the timeline below shows; the narrator never invents updates and never speculates about root cause.',
              )}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={!canSummarize}
            aria-disabled={!canSummarize ? 'true' : 'false'}
            onClick={() => stream.start()}
            title={t(
              'incidentTimeline.aiSummary.description',
              'Get a 3-6 sentence factual summary of this incident\u2019s timeline. The summary is grounded in the same deterministic envelope the timeline below shows; the narrator never invents updates and never speculates about root cause.',
            )}
          >
            {stream.state === 'streaming'
              ? t('ai.common.generating', 'Generating\u2026')
              : t('incidentTimeline.aiSummary.button', 'Summarize')}
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
InnerSection.displayName = 'AIIncidentTimelineSummarizerInner'

/**
 * AIIncidentTimelineSummarizer renders the LLM incident timeline
 * summary section only when the incident-timeline-summarizer
 * feature is enabled. The wrapping div from {@link withAiFeature}
 * carries `data-testid="ai-feature-incident-timeline-summarizer-root"`,
 * which the off-mode invariant test asserts against.
 */
export const AIIncidentTimelineSummarizer = withAiFeature(
  'incident-timeline-summarizer',
  InnerSection,
)
AIIncidentTimelineSummarizer.displayName = 'AIIncidentTimelineSummarizer'
