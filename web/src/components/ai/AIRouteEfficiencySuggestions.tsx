// Route-efficiency suggestions.
//
// The Generate button posts an empty body to
// POST /api/v1/ai/routes/{routeID}/efficiency/suggest.
// The {routeID} slot uses the parent page's vehicleId as an opaque
// backend anchor, not a foreign key to a routes table.
//
// The backend still validates that anchor:
// parseRouteEfficiencySuggestionsURL (internal/api/airouteeff/handler.go)
// rejects any routeID that is not a positive integer with HTTP 400 — zero,
// negative, non-numeric, and decimal values all 400 BEFORE the SSE stream
// opens. We mirror that shape at the display boundary so the button stays
// disabled until vehicleId normalizes to a positive integer; the
// pre-hardening `!!vehicleId` guard wrongly enabled it for the truthy
// strings "0", "-5", "42.5", and "abc", each of which the handler
// immediately rejects.

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { useAiStream } from '@/hooks/useAiStream'

interface InnerSectionProps {
  vehicleId?: string
}

// The stream renders its narrative purely through useAiStream's built-in
// delta-text accumulator (surfaced by AiOutputPanel), so it has no per-event
// work to do. A module-level no-op keeps the callback identity stable across
// renders instead of allocating a fresh closure in the render path.
const noop = (): void => {}

/**
 * normalizeRouteId mirrors the backend contract in
 * internal/api/airouteeff/handler.go's parseRouteEfficiencySuggestionsURL,
 * which rejects any routeID that is not a positive integer with HTTP 400. The
 * routeID slot is fed the parent page's vehicleId as an opaque anchor, so
 * validating the same shape at the display boundary keeps the Generate button
 * from firing a request the handler would immediately reject. Returns the
 * canonical positive integer when valid (leading zeros dropped, surrounding
 * whitespace trimmed — the URL is rebuilt from the parsed integer so it is
 * always clean), or `null` (button disabled) otherwise. Mirrors the sibling
 * AISmartChargeScheduleSuggestion's normalizeVehicleId.
 */
function normalizeRouteId(vehicleId: string | undefined): number | null {
  if (vehicleId == null) return null
  const trimmed = vehicleId.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const n = Number(trimmed)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

function InnerSection({ vehicleId }: InnerSectionProps) {
  const { t } = useTranslation()
  const validRouteId = useMemo(() => normalizeRouteId(vehicleId), [vehicleId])
  const url = useMemo(
    () => `/ai/routes/${validRouteId ?? 0}/efficiency/suggest`,
    [validRouteId],
  )
  const body = useMemo(() => ({}), [])
  const stream = useAiStream({ url, body, onEvent: noop })
  return (
    <AIFeatureCard
      title={t('routeEfficiency.aiSuggestions.title', 'Route-efficiency suggestions')}
      description={t(
        'routeEfficiency.aiSuggestions.description',
        'Get a short plain-language suggestion for lower-consumption habits and route choices grounded in your own historical route data — the dominant route, its kWh/100mi figure, a comparison across your other routes, and one or two concrete, non-mutating ideas you can try yourself.',
      )}
      buttonLabel={t('routeEfficiency.aiSuggestions.generateButton', 'Generate suggestions')}
      badgeLabel={t('routeEfficiency.aiSuggestions.badge', 'Helix')}
      emptyHint={t(
        'routeEfficiency.aiSuggestions.emptyHint',
        'Select a vehicle to generate route-efficiency suggestions.',
      )}
      canStart={validRouteId !== null}
      stream={stream}
    />
  )
}
InnerSection.displayName = 'AIRouteEfficiencySuggestionsInner'

export const AIRouteEfficiencySuggestions = withAiFeature(
  'route-efficiency-suggestions',
  InnerSection,
)
AIRouteEfficiencySuggestions.displayName = 'AIRouteEfficiencySuggestions'
