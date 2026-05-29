// Watch-face natural-language response AI surface.
//
// AIWatchFaceNLResponse is the visible AI surface for the /watch
// page. It is rendered conditionally via
// withAiFeature('watch-face-nl-response', …) so:
//
//   - When ai_mode='off' it does not render at all (ADR-015 §I5 + §I6).
//   - When ai_mode is 'local'/'cloud' AND the watch-face-nl-response
//     toggle is on, it renders an opt-in narrator section beneath
//     the deterministic <WatchShell> fixed-cards + tap-commands.
//     The user types (or leaves empty for a default summary) a
//     glance-style question and the Ask button POSTs to
//     /api/v1/ai/watch/respond. The SSE response stream
//     accumulates into the shared AiOutputPanel.
//
// The component does NOT replace the deterministic /watch fixed
// cards (battery, range, charging, locks, sentry, climate
// summary) or the tap-icon command surface rendered by
// <WatchShell> on the same page. That baseline content remains
// the canonical view visible to every user (and the ONLY view
// when AI is off); this Helix panel is opt-in read-only
// narration layered alongside.
//
// Wiring contract:
//   - useAiStream targets POST /ai/watch/respond (the backend
//     path after stripping the /api/v1 prefix; the hook
//     prepends it). POST /api/v1/ai/watch/respond is registered
//     in the feature registry and guard-wrapped by
//     guard.Wrap('watch-face-nl-response') in
//     internal/api/ai_routes.go.
//   - The Ask button's disabled prop is a COMPUTED expression
//     (`!canStart || streaming || paused-confirm`), never a
//     literal `disabled` or `disabled={true}`.
//   - Render contract is NARRATIVE: the strategy emits delta
//     events that the shared AiOutputPanel (rendered by
//     AIFeatureCard) appends to the displayed output. There is
//     no typed proposal, no "Apply to form" handoff — the
//     strategy NEVER claims to have changed a setting or sent a
//     vehicle command (system prompt enforces, redact decorator
//     defence-in-depths).
//   - Double-submit guard: stream.start() is a no-op while
//     state === 'streaming' || state === 'paused-confirm'; the
//     button is also visually disabled to mirror the state
//     machine.
//   - cancel() runs on unmount via a dedicated useEffect so an
//     in-flight stream does not bleed into a subsequent mount
//     of the panel.
//
// HX (Helix UX) contract:
//   - The surface renders through the shared AIFeatureCard
//     scaffold — NOT a bespoke GlassPanel + Button +
//     AiOutputPanel composition.
//   - The per-feature verb "Ask about my car" is passed via
//     `buttonLabel`. The card composes the accessible name as
//     "Ask Helix · Ask about my car"; tests locate the button
//     via the unanchored regex /Ask about my car/i.
//   - User-visible i18n keys say "Helix", not "AI"
//     (watchFaceNL.* namespace).
//
// ADR-015 alignment:
//   - I3 baseline intact: the deterministic <WatchShell> remains
//     the canonical /watch surface; this section adds opt-in
//     narration BELOW it.
//   - I5 hidden UI:       withAiFeature returns null when the
//     feature is not enabled, so the section is entirely
//     absent from the DOM in off mode.
//   - I6 404 routes:      the backend route is guard-wrapped
//     and returns 404 in off mode; useAiStream would surface
//     that as state='error', but the component is never
//     rendered in off mode at all because of I5.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { Textarea } from '@/components/ui'
import { useAiStream } from '@/hooks/useAiStream'

// MaxMessageChars mirrors the backend handler's
// aiWatchFaceNLResponseMaxMessageLen cap so a parser-rejection
// 400 never reaches the user. Keep these two values in sync.
const MaxMessageChars = 1000

function InnerSection() {
  const { t } = useTranslation()
  const [message, setMessage] = useState('')

  const trimmedMessage = message.trim()

  // Body shape mirrors the Go handler's
  // aiWatchFaceNLResponseRequest: a single optional `message`
  // string. We send `undefined` for an empty/whitespace-only
  // textarea so the body serializes as `{}` and the handler
  // falls back to its deterministic "give a glance summary"
  // default prompt. Sending an explicit empty string would
  // pass the parser (the handler's empty-message guard is
  // post-trim), but `undefined` is the honest "user did not
  // supply a question" signal and matches the way other
  // optional-field bodies in this codebase are shaped.
  const body = useMemo(
    () => ({
      message: trimmedMessage.length > 0 ? trimmedMessage : undefined,
    }),
    [trimmedMessage],
  )

  // NARRATIVE render contract: the strategy never emits a
  // typed tool_result that this surface would copy into a
  // form. We still register an onEvent handler because
  // useAiStream's contract requires one — the handler is a
  // deliberate no-op here. AiOutputPanel (rendered by
  // AIFeatureCard) consumes `stream.text` directly to display
  // the narration as it streams.
  const handleEvent = useCallback(() => {
    // Intentionally empty — see comment above.
  }, [])

  const stream = useAiStream({
    url: '/ai/watch/respond',
    body,
    onEvent: handleEvent,
  })

  // Pull cancel out so the cleanup effect's deps stay narrow.
  // The hook returns a stable cancel reference, so destructuring
  // here keeps the effect dep on cancelStream only. Including
  // the whole stream object would re-run the cleanup on every
  // internal state tick of useAiStream.
  const { cancel: cancelStream } = stream

  // Cancel on unmount so a stale stream cannot bleed into a
  // subsequent mount of the panel. Dedicated effect so the
  // cleanup deps stay explicit (Rule of Hooks / W1 §6).
  useEffect(() => {
    return () => {
      cancelStream()
    }
  }, [cancelStream])

  // canStart drives the AIFeatureCard's button disabled state:
  // false during streaming OR during a paused-confirm pause
  // (the W1 double-submit invariant) AND false when the
  // message would be rejected by the backend parser
  // (over-cap). An empty message is ALLOWED (the backend
  // applies a default-summary prompt), so we do NOT require
  // a non-empty message here.
  const messageWithinCap = trimmedMessage.length <= MaxMessageChars
  const canStart =
    messageWithinCap && stream.state !== 'paused-confirm'

  return (
    <AIFeatureCard
      title={t('watchFaceNL.title', 'Ask Helix about your watch face')}
      description={t(
        'watchFaceNL.description',
        'Ask Helix a glance-style natural-language question about your vehicle right now — battery, range, charging, locks, climate, recent alerts. Helix only reads a typed snapshot of canonical state values; it never claims to have changed a setting or sent a vehicle command. To lock, unlock, start climate, or send another command use the watch-face tap icons or the phone app.',
      )}
      buttonLabel={t('watchFaceNL.button', 'Ask about my car')}
      badgeLabel={t('watchFaceNL.badge', 'Helix')}
      canStart={canStart}
      stream={stream}
      inputSlot={
        <Textarea
          rows={3}
          placeholder={t(
            'watchFaceNL.placeholder',
            'e.g. how is my battery? Is the car locked? Leave empty for a summary.',
          )}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={MaxMessageChars}
          aria-label={t('watchFaceNL.inputLabel', 'Your question for Helix')}
        />
      }
    />
  )
}
InnerSection.displayName = 'AIWatchFaceNLResponseInner'

/**
 * AIWatchFaceNLResponse renders the LLM watch-face NL narrator
 * section only when the watch-face-nl-response feature is enabled.
 * The wrapping div from {@link withAiFeature} carries
 * `data-testid="ai-feature-watch-face-nl-response-root"`, which
 * the off-mode invariant test asserts against (the load-bearing
 * proof that the slice does NOT render any AI affordance when
 * ai_mode='off').
 */
export const AIWatchFaceNLResponse = withAiFeature(
  'watch-face-nl-response',
  InnerSection,
)
AIWatchFaceNLResponse.displayName = 'AIWatchFaceNLResponse'
