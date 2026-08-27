// Optional Helix paint-preview proposal for VehicleDetailPage.
// Contract:
//   - Hidden entirely when ai_mode='off' or the feature toggle is disabled.
//   - POSTs to /api/v1/ai/vehicles/{vehicleID}/paint-preview/draft and streams into AiOutputPanel.
//   - Never replaces deterministic vehicle configuration or manual appearance controls.
//   - Renders through shared AIFeatureCard and keeps user-facing copy branded as Helix.
//   - useAiStream stays unconditional; AIFeatureCard derives start availability from `canStart`.

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { useAiStream } from '@/hooks/useAiStream'

// The paint-preview draft is surfaced entirely through `stream.text`
// (rendered by AIFeatureCard's AiOutputPanel); there is no per-frame
// side effect to run. A module-level no-op keeps the `onEvent`
// identity stable so useAiStream does not re-run its callback-ref
// effect on every parent re-render.
const NO_OP = (): void => {
  /* no per-frame side effect — the accumulated text is read from stream.text */
}

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
  // The handler-side parser validates vehicleID > 0 and parses it as
  // an integer path param, so a fractional or non-finite value can
  // never map to a persisted vehicle. Requiring a positive integer
  // here keeps the button disabled — and stops a malformed
  // /ai/vehicles/7.5/... request from ever firing — until the parent
  // has resolved a real vehicle selection. The hook is called
  // unconditionally with the current body so the dependency graph
  // stays stable regardless of vehicleId resolution.
  const numericVehicleId =
    typeof vehicleId === 'number' && Number.isInteger(vehicleId) ? vehicleId : 0
  const body = useMemo(() => {
    const payload: { style_hint?: string } = {}
    if (typeof styleHint === 'string' && styleHint.trim() !== '') {
      payload.style_hint = styleHint.trim()
    }
    return payload
  }, [styleHint])
  const haveInputs = numericVehicleId > 0
  // useAiStream prefixes the URL with /api/v1; we pass the
  // post-prefix path. The vehicleID is embedded in the URL so the
  // handler can scope the prompt; the body carries only the
  // optional style hint. Memoised so the stream's inputs stay
  // referentially stable across re-renders.
  const urlPath = useMemo(
    () =>
      haveInputs
        ? `/ai/vehicles/${numericVehicleId}/paint-preview/draft`
        : '/ai/vehicles/0/paint-preview/draft',
    [haveInputs, numericVehicleId],
  )
  const stream = useAiStream({
    url: urlPath,
    body,
    onEvent: NO_OP,
    // AI-01: vehicle + style-hint scope is part of stream identity —
    // changing either aborts an in-flight draft and clears the
    // previous scope's paint preview before the new scope streams in.
    scopeKey: haveInputs ? `${numericVehicleId}:${styleHint ?? ''}` : null,
  })
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
