// Phase-50 / 0023 — D3 Route-efficiency suggestions.
// Phase-50 / W1 (slice 0065) — wired the Generate button to
// POST /api/v1/ai/routes/{routeID}/efficiency/suggest (empty body).
// The {routeID} URL slot is filled with the parent page's
// vehicleId — per slice 0023 the backend treats this as an
// "opaque anchor", not a foreign key to a routes table.

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { useAiStream } from '@/hooks/useAiStream'

interface InnerSectionProps {
  vehicleId?: string
}

function InnerSection({ vehicleId }: InnerSectionProps) {
  const { t } = useTranslation()
  const url = useMemo(
    () =>
      vehicleId
        ? `/ai/routes/${encodeURIComponent(vehicleId)}/efficiency/suggest`
        : '/ai/routes/0/efficiency/suggest',
    [vehicleId],
  )
  const body = useMemo(() => ({}), [])
  const stream = useAiStream({ url, body, onEvent: () => {} })
    return (
    <AIFeatureCard
      title={t('routeEfficiency.aiSuggestions.title', 'Route-efficiency suggestions')}
      description={t(
                'routeEfficiency.aiSuggestions.description',
                'Get a short plain-language suggestion for lower-consumption habits and route choices grounded in your own historical route data — the dominant route, its kWh/100mi figure, a comparison across your other routes, and one or two concrete, non-mutating ideas you can try yourself.',
              )}
      buttonLabel={t('routeEfficiency.aiSuggestions.generateButton', 'Generate suggestions')}
      badgeLabel={t('routeEfficiency.aiSuggestions.badge', 'Helix')}
      canStart={!!vehicleId}
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
