// MQTT and SSE inspector explanations.
// The "Explain streams" button POSTs to
// /api/v1/ai/system/streams/explain via useAiStream. The UI and
// SSE wiring ship together so the button cannot appear without a
// registered backend stream.
//
// AIMqttSseInspectorExplanations is the visible AI surface for the
// MQTTInspectorPage. It is rendered conditionally via
// withAiFeature('mqtt-sse-inspector-explanations', …) so:
//
//   - When ai_mode='off' it does not render at all (ADR-015 §I5 + §I6).
//   - When ai_mode is 'local'/'cloud' AND the
//     mqtt-sse-inspector-explanations toggle is on, it renders an
//     opt-in section beneath the broker connection panel inside
//     the MQTTInspectorPage. The button POSTs `{from_unix, to_unix}`
//     to /api/v1/ai/system/streams/explain and the SSE response
//     stream accumulates into the shared AiOutputPanel.
//
// The component does NOT replace the deterministic broker-status
// snapshot table (Connection Info, Per-Vehicle Stats, throughput
// chart). Those remain the canonical baseline: even when the AI
// explainer narrates the envelope, the operator continues to use
// the deterministic /api/v1/admin/mqtt/status panel above for raw
// inspection. ADR-015 §I3 baseline intact.
//
// Render contract:
//   - useAiStream is called unconditionally at the top of the body
//     (Hooks-rules safe).
//   - The "Explain streams" button's disabled prop is a COMPUTED
//     expression (`!canStart`), never a literal `disabled` or
//     `disabled={true}`.
//   - Double-submit protection: stream.start() is a no-op while
//     state === 'streaming' (the hook coalesces; the button is
//     also visually disabled to mirror the state machine).
//   - The streamed text accumulates into AiOutputPanel which
//     renders the SSE delta stream as-it-arrives.
//
// ADR-015 alignment:
//   - I3 baseline intact: this component never replaces the
//     broker-status snapshot table; it adds an opt-in explainer
//     section alongside.
//   - I5 hidden UI:       the withAiFeature HOC returns null when
//     the feature is not enabled, so the section is entirely
//     absent from the DOM in off mode.
//   - I6 404 routes:      the backend route is guard-wrapped and
//     returns 404 in off mode; useAiStream surfaces that as
//     state='error' for the user, but the component is never
//     rendered in off mode at all because of I5.
//   - I8 propose-only:    the AI surface NEVER mutates broker
//     subscriptions, vehicle state, or any signal-pipeline
//     entry point. The explainer is read-only narration over the
//     deterministic envelope.

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { useAiStream } from '@/hooks/useAiStream'

interface InnerSectionProps {
  /**
   * fromUnix is the inclusive start of the explanation window
   * in Unix seconds. When the parent omits it OR the value is
   * non-positive, the "Explain streams" button stays disabled.
   * The parent MQTTInspectorPage derives this from the current
   * time (now-30min by default) so the explanation always
   * covers the most-recent broker activity the operator was
   * looking at.
   */
  fromUnix?: number

  /**
   * toUnix is the inclusive end of the explanation window in
   * Unix seconds. When the parent omits it OR the value is
   * less than fromUnix, the "Explain streams" button stays
   * disabled.
   */
  toUnix?: number
}

/**
 * InnerSection is the always-rendered body of the AI MQTT/SSE
 * inspector explainer card. The surrounding {@link withAiFeature}
 * HOC handles the visibility gate; this component only describes
 * the surface's appearance.
 *
 * Visual contract:
 *   - One AIFeatureCard sized to sit beneath the Connection Info
 *     panel inside the MQTTInspectorPage.
 *   - Cyan AI badge in the header (matches the Helix brand
 *     colour).
 *   - A single "Explain streams" button that submits a POST to
 *     the registered backend route. The body carries the
 *     in-scope (from_unix, to_unix) tuple so the LLM cannot
 *     widen it.
 *   - "Explain streams" button is disabled while a stream is
 *     open OR when the parent has not yet supplied a valid
 *     window.
 *   - Title attribute carries the long-form explanation so a
 *     user hovering for a tooltip understands the privacy
 *     contract — the LLM never sees broker hostnames, ports,
 *     SSE client identifiers, or VINs in plaintext; every PII
 *     class is round-tripped through PolicyChatbot before the
 *     message reaches the provider.
 */
function InnerSection({ fromUnix, toUnix }: InnerSectionProps) {
  const { t } = useTranslation()

  const haveWindow =
    typeof fromUnix === 'number' &&
    Number.isFinite(fromUnix) &&
    fromUnix > 0 &&
    typeof toUnix === 'number' &&
    Number.isFinite(toUnix) &&
    toUnix > fromUnix

  // The backend reads from_unix / to_unix from the body. useMemo
  // keeps the body reference stable so useAiStream's dependency-
  // tracked re-render path doesn't churn between renders that
  // did not change the window. When the window is unset we ship
  // a placeholder body that the button is disabled from posting.
  const body = useMemo(() => {
    if (!haveWindow) {
      return { from_unix: 0, to_unix: 0 }
    }
    return { from_unix: fromUnix as number, to_unix: toUnix as number }
  }, [haveWindow, fromUnix, toUnix])

  // The hook is called unconditionally so Hooks-rules pass even
  // when the parent has not yet supplied a window. The URL is
  // the registered backend endpoint (the request() client that
  // useAiStream wraps prepends /api/v1).
  const stream = useAiStream({
    url: '/ai/system/streams/explain',
    body,
    onEvent: () => {},
    // AI-01: time-window scope is part of stream identity — changing
    // the window aborts an in-flight explanation and clears the
    // previous window's narrative before the new scope streams in.
    scopeKey: haveWindow ? `${fromUnix}:${toUnix}` : null,
  })

  return (
    <AIFeatureCard
      title={t('mqttSseInspector.aiExplainer.title', 'Helix stream explainer')}
      description={t(
        'mqttSseInspector.aiExplainer.description',
        'Get a 3-6 sentence factual explanation of the current MQTT broker, SSE hub, and background-job state. The explainer reads only the deterministic broker-status envelope (broker connectivity, per-vehicle stream stats, SSE client counts, job freshness) — broker hostnames, ports, SSE client identifiers, and VINs are redacted before the message reaches the provider. The explanation is informational; the broker-status snapshot above remains the canonical raw view.',
      )}
      buttonLabel={t('mqttSseInspector.aiExplainer.button', 'Explain streams')}
      badgeLabel={t('mqttSseInspector.aiExplainer.badge', 'Helix')}
      emptyHint={
        haveWindow
          ? undefined
          : t(
              'mqttSseInspector.aiExplainer.emptyHint',
              'A valid time window is required.',
            )
      }
      canStart={haveWindow}
      stream={stream}
    />
  )
}
InnerSection.displayName = 'AIMqttSseInspectorExplanationsInner'

/**
 * AIMqttSseInspectorExplanations renders the LLM stream-state
 * explainer section only when the mqtt-sse-inspector-explanations
 * feature is enabled. The wrapping div from {@link withAiFeature}
 * carries `data-testid="ai-feature-mqtt-sse-inspector-explanations-root"`,
 * which the off-mode invariant test asserts against.
 */
export const AIMqttSseInspectorExplanations = withAiFeature(
  'mqtt-sse-inspector-explanations',
  InnerSection,
)
AIMqttSseInspectorExplanations.displayName = 'AIMqttSseInspectorExplanations'
