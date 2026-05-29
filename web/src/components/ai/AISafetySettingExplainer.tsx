// Helix safety setting explainer.

// Wiring contract:
// - useAiStream targets POST /ai/settings/safety/explain
// (the backend path after stripping the /api/v1 prefix).
// - The primary action button is disabled via a COMPUTED
// expression
// (`stream.state === 'streaming' || stream.state === 'paused-confirm'`),
// never a literal `disabled` or `disabled={true}` (the wiring rule).
// - The render contract is NARRATIVE (not proposal): the LLM
// EXPLAINS the user's existing safety-related settings —
// it never proposes a different value, never claims to have
// changed a setting, and never offers an "Apply to form"
// handoff. The streaming text is rendered via the shared
// AiOutputPanel inside the AIFeatureCard scaffold.
// - cancel() runs on unmount (dedicated useEffect with
// explicit cancelStream dep so internal stream ticks do
// not wipe in-flight narration mid-stream).
// - Component is wrapped with withAiFeature so it is ABSENT
// (returns null) when ai_mode='off' or the per-feature
// toggle is off.

// Helix UX contract:
// - The surface renders through the shared AIFeatureCard
// scaffold — NOT a bespoke GlassPanel + Button +
// AiOutputPanel composition.
// - The per-feature verb "Explain my settings" is passed via
// `buttonLabel`. The card composes the accessible name as
// "Ask Helix · Explain my settings".
// - User-visible i18n keys say "Helix", not "AI".

// Safety alignment:
// - Baseline intact: this component never replaces the
// deterministic listing of safety settings in the
// /settings/safety page; it adds an opt-in narrator panel
// above the list. The list itself is rendered from
// useSettings() and is fully usable when AI is off.
// - Hidden UI: the withAiFeature HOC returns null
// when the feature is not enabled, so the section is
// entirely absent from the DOM in off mode.
// - Guarded route: the backend route is guard-wrapped
// and returns 404 in off mode; useAiStream surfaces that
// as state='error' for the user, but the component is
// never rendered in off mode.

import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { useAiStream } from '@/hooks/useAiStream'

function InnerSection() {
  const { t } = useTranslation()

  // Body is the empty object — the backend reads the user's
  // identity from the ForwardAuth subject and applies a
  // deterministic default question ("give a short overview of
  // your safety settings"). A future edit may surface a per-
  // setting question textbox; for now an empty body matches
  // the most common case (one click → one short summary of
  // the install's current safety toggle state).
  
  // useMemo so useAiStream's deps are stable across renders.
  const body = useMemo(() => ({}), [])

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
    url: '/ai/settings/safety/explain',
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
  // Cleanup deps stay explicit so stream ticks do not cancel narration.
  useEffect(() => {
    return () => {
      cancelStream()
    }
  }, [cancelStream])

  const isBusy =
    stream.state === 'streaming' || stream.state === 'paused-confirm'

  const handleExplain = useCallback(() => {
    if (isBusy) {
      return // double-submit no-op
    }
    stream.start()
  }, [isBusy, stream])

  return (
    <AIFeatureCard
      title={t(
        'safetySettings.aiExplainer.title',
        'Explain my safety settings',
      )}
      description={t(
        'safetySettings.aiExplainer.description',
        'Ask Helix to explain the safety-related TeslaSync settings on this page in plain English. Helix only reads the typed envelope of canonical setting values (booleans, enum strings, HH:MM times) — it never reads notification titles, vehicle names, or any other PII, and it never proposes or changes a setting. Use the controls below to update a value yourself; Helix only narrates.',
      )}
      buttonLabel={t(
        'safetySettings.aiExplainer.button',
        'Explain my settings',
      )}
      badgeLabel={t('safetySettings.aiExplainer.badge', 'Helix')}
      canStart={stream.state !== 'paused-confirm'}
      stream={stream}
      onAction={handleExplain}
      buttonPlacement="below"
      buttonTestId="ai-feature-safety-setting-explainer-suggest"
    />
  )
}
InnerSection.displayName = 'AISafetySettingExplainerInner'

/**
 * AISafetySettingExplainer renders the LLM safety-setting
 * narrator section only when the safety-setting-explainer
 * feature is enabled. The wrapping div from {@link withAiFeature}
 * carries `data-testid="ai-feature-safety-setting-explainer-root"`,
 * which the off-mode invariant test asserts against.
 */
export const AISafetySettingExplainer = withAiFeature(
  'safety-setting-explainer',
  InnerSection,
)
AISafetySettingExplainer.displayName = 'AISafetySettingExplainer'
