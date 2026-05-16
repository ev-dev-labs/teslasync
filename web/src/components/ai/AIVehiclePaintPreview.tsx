// Phase-50 / 0061 — GEN2 vehicle paint preview.
// Phase-50 / W1 inline wiring (per slice prompt 0061) — wired the
// "Preview paint color" button to
// POST /api/v1/ai/vehicles/{vehicleID}/paint-preview/draft via the
// canonical useAiStream hook. The slice methodology forbids
// shipping the visual affordance without end-to-end SSE wiring;
// this component lands both in one commit so the on-mode wiring
// test (TestVehiclePaintPreviewAIOnWiredCallsRoute) can prove the
// button actually opens an SSE stream against the registered
// backend route.
//
// AIVehiclePaintPreview is the visible AI surface for the
// VehicleDetailPage (/vehicles/:vehicleId). It is rendered
// conditionally via withAiFeature('vehicle-paint-preview', …) so:
//
//   - When ai_mode='off' it does not render at all (ADR-015 §I5 + §I6).
//   - When ai_mode is 'local'/'cloud' AND the
//     vehicle-paint-preview toggle is on, it renders an opt-in
//     section with a "Preview paint color" button that POSTs to
//     /api/v1/ai/vehicles/{vehicleID}/paint-preview/draft. The
//     SSE response stream accumulates into the shared
//     AiOutputPanel inside AIFeatureCard.
//
// The component does NOT replace the deterministic
// VehicleConfigSection (model, trim, current exterior color, etc.)
// or the manual theme/appearance settings on the same page. Those
// baseline surfaces remain the canonical way to view and update
// the vehicle's paint color; this AI section is opt-in
// propose-only image-prompt drafting layered alongside.
//
// Render contract (P11/P12 — Wired-or-absent, No-placeholder-buttons):
//   - useAiStream is called unconditionally at the top of the body
//     (Hooks-rules safe).
//   - The button's disabled prop is a COMPUTED expression
//     (`!haveInputs || stream.state === 'streaming'` via the
//     `canStart` prop on AIFeatureCard), never a literal
//     `disabled` or `disabled={true}`.
//   - Double-submit protection: stream.start() is a no-op while
//     state === 'streaming' (the hook coalesces; the button is
//     also visually disabled to mirror the state machine).
//   - The streamed text accumulates into AiOutputPanel which
//     renders the SSE delta stream as-it-arrives.
//
// HX (Helix UX) contract:
//   - The surface renders through the shared AIFeatureCard
//     scaffold — NOT a bespoke GlassPanel + Button + AiOutputPanel
//     composition.
//   - The per-feature verb "Preview paint color" is passed via
//     `buttonLabel`. The card composes the accessible name as
//     "Ask Helix · Preview paint color".
//   - User-visible i18n keys say "Helix", not "AI" (per the HX
//     addendum).
//
// ADR-015 alignment:
//   - I3 baseline intact: this component never replaces the
//     deterministic VehicleConfigSection / VehiclePhotoGallery /
//     manual theme surface; it adds an opt-in propose-only draft
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

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { useAiStream } from '@/hooks/useAiStream'

interface InnerSectionProps {
  /**
   * vehicleId surfaced by the parent VehicleDetailPage (the
   * vehicle whose detail page is currently rendered). Required
   * for the backend call: the URL is
   * /api/v1/ai/vehicles/{vehicleID}/paint-preview/draft so the
   * action button stays disabled while the parent has not yet
   * resolved a vehicleId.
   */
  vehicleId?: number

  /**
   * Optional one-word style hint the user can pass to Helix
   * (e.g. "studio", "outdoor", "sunset"). The handler caps this
   * at 80 characters and rejects control chars + lat/long-looking
   * substrings. Defaults to undefined; the strategy then asks the
   * model to pick a sensible default.
   */
  styleHint?: string
}

/**
 * InnerSection is the always-rendered body of the AI
 * vehicle-paint-preview card. The surrounding {@link withAiFeature}
 * HOC handles the visibility gate; this component only describes
 * the surface's appearance.
 *
 * Visual contract:
 *   - One AIFeatureCard sized to sit beneath the deterministic
 *     VehicleConfigSection on VehicleDetailPage.
 *   - Helix brand badge in the header.
 *   - "Preview paint color" button is disabled while a stream is
 *     open OR when no vehicleId is available from the parent
 *     page.
 *   - Description carries the long-form explanation so a user
 *     reading the panel hint understands the privacy contract +
 *     the propose-only guarantee: Helix drafts an image prompt,
 *     but the user has to click the existing manual per-vehicle
 *     Color setting to actually apply a new paint.
 */
function InnerSection({ vehicleId, styleHint }: InnerSectionProps) {
  const { t } = useTranslation()
  // The handler-side parser validates vehicleID > 0; we mirror
  // that here to keep the button disabled when the parent has
  // not yet resolved a vehicle selection. The hook is called
  // unconditionally with the current body so the dependency
  // graph stays stable regardless of vehicleId resolution.
  const numericVehicleId =
    typeof vehicleId === 'number' && Number.isFinite(vehicleId) ? vehicleId : 0
  const body = useMemo(() => {
    const payload: { style_hint?: string } = {}
    if (typeof styleHint === 'string' && styleHint.trim() !== '') {
      payload.style_hint = styleHint.trim()
    }
    return payload
  }, [styleHint])
  // useAiStream prefixes the URL with /api/v1; we pass the
  // post-prefix path. The vehicleID is embedded in the URL so the
  // handler can scope the prompt; the body carries only the
  // optional style hint.
  const urlPath =
    numericVehicleId > 0
      ? `/ai/vehicles/${numericVehicleId}/paint-preview/draft`
      : '/ai/vehicles/0/paint-preview/draft'
  const stream = useAiStream({
    url: urlPath,
    body,
    onEvent: () => {},
  })
  const haveInputs = numericVehicleId > 0
  return (
    <AIFeatureCard
      title={t(
        'vehicles.aiPaintPreview.title',
        'Draft a Helix paint preview',
      )}
      description={t(
        'vehicles.aiPaintPreview.description',
        'Ask Helix to draft a propose-only paint-color image prompt for this vehicle. Helix only sees the redacted vehicle context (model, trim, current exterior color) \u2014 never the display name, VIN, license plate, or location. The draft is never applied automatically; review the proposed image prompt here, then use the existing Color setting below to apply the new paint if you\u2019d like to keep it.',
      )}
      buttonLabel={t(
        'vehicles.aiPaintPreview.button',
        'Preview paint color',
      )}
      badgeLabel={t('vehicles.aiPaintPreview.badge', 'Helix')}
      emptyHint={
        haveInputs
          ? undefined
          : t(
              'vehicles.aiPaintPreview.noVehicleHint',
              'Open a vehicle detail page to enable Helix.',
            )
      }
      canStart={haveInputs}
      stream={stream}
    />
  )
}
InnerSection.displayName = 'AIVehiclePaintPreviewInner'

/**
 * AIVehiclePaintPreview renders the LLM paint-preview image-prompt
 * drafting section only when the vehicle-paint-preview feature is
 * enabled. The wrapping div from {@link withAiFeature} carries
 * `data-testid="ai-feature-vehicle-paint-preview-root"`, which the
 * off-mode invariant test asserts against.
 */
export const AIVehiclePaintPreview = withAiFeature(
  'vehicle-paint-preview',
  InnerSection,
)
AIVehiclePaintPreview.displayName = 'AIVehiclePaintPreview'
