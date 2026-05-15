// Phase-50 / 0012 — U2 Weekly digest narration.
// Phase-50 / W1 (slice 0065) — wired the Generate button to
// POST /api/v1/ai/digests/weekly/narrate.
//
// AIDigestNarration is the visible AI surface for the weekly-digest
// page. It is rendered conditionally via withAiFeature('digest-narration', …)
// so:
//
//   - When ai_mode='off' it does not render at all (ADR-015 §I5 + §I6).
//   - When ai_mode is on AND the digest-narration toggle is on, it
//     renders an opt-in section that streams a narrated recap.
//
// The component does NOT replace the deterministic template digest
// (DrivingSection, ChargingSection, BatteryHealthSection, etc.). The
// template digest remains the canonical baseline visible to every
// user; this AI section is opt-in narrative prose layered alongside.

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AIFeatureCard } from '@/components/ai/AIFeatureCard'
import { withAiFeature } from '@/components/ai/withAiFeature'
import { useAiStream } from '@/hooks/useAiStream'

interface InnerSectionProps {
  vehicleId?: number
}

function InnerSection({ vehicleId }: InnerSectionProps) {
  const { t } = useTranslation()
  const body = useMemo(
    () => ({ vehicle_id: vehicleId ?? 0, week_offset_weeks: 0 }),
    [vehicleId],
  )
  const stream = useAiStream({
    url: '/ai/digests/weekly/narrate',
    body,
    onEvent: () => {},
  })
    return (
    <AIFeatureCard
      title={t('analytics.weeklyDigest.aiNarration.title', 'Helix narration')}
      description={t(
                'analytics.weeklyDigest.aiNarration.description',
                'Get a short, Helix-written recap of your week from the digest data above.',
              )}
      buttonLabel={t('analytics.weeklyDigest.aiNarration.generateButton', 'Generate narration')}
      badgeLabel={t('analytics.weeklyDigest.aiNarration.badge', 'Helix')}
      canStart={vehicleId != null}
      stream={stream}
    />
  )
}
InnerSection.displayName = 'AIDigestNarrationInner'

export const AIDigestNarration = withAiFeature('digest-narration', InnerSection)
AIDigestNarration.displayName = 'AIDigestNarration'
