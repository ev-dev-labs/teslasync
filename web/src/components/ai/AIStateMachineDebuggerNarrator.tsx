// State-machine debugger narrator.
// The "Narrate transitions" button POSTs to /api/v1/ai/system/fsm/narrate
// via the canonical useAiStream hook. Keep the visual affordance and SSE
// wiring together so the on-mode wiring test can prove the button opens
// a stream against the registered backend route.
//
// AIStateMachineDebuggerNarrator is the visible AI surface for the
// StateMachineDebuggerPage. It is rendered conditionally via
// withAiFeature('state-machine-debugger-narrator', …) so:
//
//   - When ai_mode='off' it does not render at all (ADR-015 §I5 + §I6).
//   - When ai_mode is 'local'/'cloud' AND the
//     state-machine-debugger-narrator toggle is on, it renders an
//     opt-in section beneath the FSM Health Panel inside the
//     StateMachineDebuggerPage. The button POSTs `{vehicle_id,
//     from_unix, to_unix}` to /api/v1/ai/system/fsm/narrate and
//     the SSE response stream accumulates into the shared
//     AiOutputPanel.
//
// The component does NOT replace the deterministic transition
// table, state diagram, FSM health panel, or timeline chart.
// Those remain the canonical baseline: even when the AI narrator
// renders the envelope, the operator continues to use the
// deterministic /api/v1/fsm/transitions surfaces above for raw
// inspection. ADR-015 §I3 baseline intact.
//
// Render contract:
//   - useAiStream is called unconditionally at the top of the body
//     (Hooks-rules safe).
//   - The "Narrate transitions" button's disabled prop is a COMPUTED
//     expression (`!canStart`), never a literal `disabled` or
//     `disabled={true}`.
//   - Double-submit protection: stream.start() is a no-op while
//     state === 'streaming' (the hook coalesces; the button is
//     also visually disabled to mirror the state machine).
//   - The streamed text accumulates into AiOutputPanel which
//     renders the SSE delta stream as-it-arrives.
//
// ADR-015 alignment:
//   - I3 baseline intact: this component never replaces the FSM
//     transition table; it adds an opt-in narration section
//     alongside.
//   - I5 hidden UI:       the withAiFeature HOC returns null when
//     the feature is not enabled, so the section is entirely
//     absent from the DOM in off mode.
//   - I6 404 routes:      the backend route is guard-wrapped and
//     returns 404 in off mode; useAiStream surfaces that as
//     state='error' for the user, but the component is never
//     rendered in off mode at all because of I5.
//   - I8 propose-only:    the AI surface NEVER mutates FSM state,
//     transition rows, or any signal-pipeline entry point. The
//     narrator is read-only narration over the deterministic
//     envelope.

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { useAiStream } from '@/hooks/useAiStream'

// The narration card consumes the accumulated delta text through
// AiOutputPanel and never reacts to individual stream frames, so
// onEvent is a stable no-op. Hoisting it to module scope keeps the
// reference identical across renders, which avoids re-running
// useAiStream's onEvent ref-sync effect every time the parent
// StateMachineDebuggerPage re-renders (its vehicle/window selectors
// change frequently). Matches the elevated sibling narrators.
const noopStreamEvent = (): void => {}

interface InnerSectionProps {
  /**
   * vehicleId is the in-scope vehicle the narration covers.
   * When the parent omits it OR the value is non-positive,
   * the "Narrate transitions" button stays disabled.
   * The parent StateMachineDebuggerPage derives this from the
   * page's active vehicle selector.
   */
  vehicleId?: number

  /**
   * fromUnix is the inclusive start of the narration window
   * in Unix seconds. When the parent omits it OR the value is
   * non-positive, the "Narrate transitions" button stays disabled.
   * The parent StateMachineDebuggerPage derives this from the
   * page's startInstant.
   */
  fromUnix?: number

  /**
   * toUnix is the inclusive end of the narration window in
   * Unix seconds. When the parent omits it OR the value is
   * less than fromUnix, the "Narrate transitions" button stays
   * disabled.
   */
  toUnix?: number
}

/**
 * InnerSection is the always-rendered body of the AI state-machine
 * debugger narrator card. The surrounding {@link withAiFeature}
 * HOC handles the visibility gate; this component only describes
 * the surface's appearance.
 *
 * Visual contract:
 *   - One AIFeatureCard sized to sit beneath the FSM Health Panel
 *     inside the StateMachineDebuggerPage.
 *   - Cyan AI badge in the header (matches the Helix brand
 *     colour).
 *   - A single "Narrate transitions" button that submits a POST
 *     to the registered backend route. The body carries the
 *     in-scope (vehicle_id, from_unix, to_unix) tuple so the
 *     LLM cannot widen it.
 *   - "Narrate transitions" button is disabled while a stream is
 *     open OR when the parent has not yet supplied a valid
 *     (vehicle, window) triple.
 *   - Description carries the long-form privacy contract — the
 *     LLM never sees VINs, lat/long, place names, IPs, emails,
 *     phone numbers, MAC addresses, or IDs in plaintext; every
 *     PII class except the operator-chosen car name is
 *     round-tripped through PolicyDigest before the message
 *     reaches the provider.
 */
function InnerSection({ vehicleId, fromUnix, toUnix }: InnerSectionProps) {
  const { t } = useTranslation()

  const haveScope =
    typeof vehicleId === 'number' &&
    Number.isFinite(vehicleId) &&
    vehicleId > 0 &&
    typeof fromUnix === 'number' &&
    Number.isFinite(fromUnix) &&
    fromUnix > 0 &&
    typeof toUnix === 'number' &&
    Number.isFinite(toUnix) &&
    toUnix > fromUnix

  // The backend reads vehicle_id / from_unix / to_unix from the
  // body. useMemo keeps the body reference stable so useAiStream's
  // dependency-tracked re-render path doesn't churn between
  // renders that did not change the scope. When the scope is
  // unset we ship a placeholder body that the button is disabled
  // from posting.
  const body = useMemo(() => {
    if (!haveScope) {
      return { vehicle_id: 0, from_unix: 0, to_unix: 0 }
    }
    return {
      vehicle_id: vehicleId as number,
      from_unix: fromUnix as number,
      to_unix: toUnix as number,
    }
  }, [haveScope, vehicleId, fromUnix, toUnix])

  // The hook is called unconditionally so Hooks-rules pass even
  // when the parent has not yet supplied a scope. The URL is
  // the registered backend endpoint (the request() client that
  // useAiStream wraps prepends /api/v1).
  const stream = useAiStream({
    url: '/ai/system/fsm/narrate',
    body,
    onEvent: noopStreamEvent,
    // AI-01: vehicle + time-window scope is part of stream identity —
    // changing either aborts an in-flight narration and clears the
    // previous window's narrative before the new scope streams in.
    scopeKey: haveScope ? `${vehicleId}:${fromUnix}:${toUnix}` : null,
  })

  return (
    <AIFeatureCard
      title={t('stateMachineDebugger.aiNarrator.title', 'Helix FSM narrator')}
      description={t(
        'stateMachineDebugger.aiNarrator.description',
        'Get a 3-6 sentence factual narration of the current vehicle FSM transition trace. The narrator reads only the deterministic FSM envelope (vehicle id, window bounds, per-FSM-name counts, per-edge counts, flap count, transition stream) — VINs, coordinates, place names, IPs, and personal identifiers are redacted before the message reaches the provider. The narration is informational; the transition table, state diagram, and FSM health panel above remain the canonical raw view.',
      )}
      buttonLabel={t('stateMachineDebugger.aiNarrator.button', 'Narrate transitions')}
      badgeLabel={t('stateMachineDebugger.aiNarrator.badge', 'Helix')}
      emptyHint={
        haveScope
          ? undefined
          : t(
              'stateMachineDebugger.aiNarrator.emptyHint',
              'Select a vehicle and a valid time window first.',
            )
      }
      canStart={haveScope}
      stream={stream}
    />
  )
}
InnerSection.displayName = 'AIStateMachineDebuggerNarratorInner'

/**
 * AIStateMachineDebuggerNarrator renders the LLM FSM-trace
 * narrator section only when the state-machine-debugger-narrator
 * feature is enabled. The wrapping div from {@link withAiFeature}
 * carries `data-testid="ai-feature-state-machine-debugger-narrator-root"`,
 * which the off-mode invariant test asserts against.
 */
export const AIStateMachineDebuggerNarrator = withAiFeature(
  'state-machine-debugger-narrator',
  InnerSection,
)
AIStateMachineDebuggerNarrator.displayName = 'AIStateMachineDebuggerNarrator'
