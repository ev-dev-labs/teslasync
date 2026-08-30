// Weekly digest narration.
// wired the Generate button to
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

// This feature renders its narrative purely through useAiStream's
// built-in delta-text accumulator (surfaced by AiOutputPanel), so it
// has no per-event work to do. A module-level no-op keeps the onEvent
// callback identity stable across renders instead of allocating a
// fresh closure in the render path (which would re-run useAiStream's
// onEvent-ref effect on every render).
const noop = (): void => {}

interface InnerSectionProps {
  /**
   * Active vehicle id from the parent weekly-digest page. Optional
   * because the active-vehicle context may be unresolved at first
   * paint; when absent (or not a positive integer) we still render
   * the section — the gate has already passed — but keep the Generate
   * button disabled because the backend narration handler rejects any
   * `vehicle_id <= 0` with HTTP 400 (see internal/api/aidigest/handler.go).
   */
  vehicleId?: number
}

function InnerSection({ vehicleId }: InnerSectionProps) {
  const { t } = useTranslation()
  // Mirror the handler-side parser (vehicle_id must be > 0). A missing,
  // non-finite (NaN), zero, or negative id keeps the button disabled so
  // the SPA never fires a request the backend would immediately 400.
  const numericVehicleId =
    typeof vehicleId === 'number' && Number.isFinite(vehicleId) ? vehicleId : 0
  const canStart = numericVehicleId > 0
  const body = useMemo(
    () => ({ vehicle_id: numericVehicleId, week_offset_weeks: 0 }),
    [numericVehicleId],
  )
  const stream = useAiStream({
    url: '/ai/digests/weekly/narrate',
    body,
    onEvent: noop,
    // AI-01: vehicle scope is part of stream identity — switching the
    // active vehicle aborts any in-flight narration and clears the
    // previous vehicle's recap before the new scope streams in.
    scopeKey: canStart ? numericVehicleId : null,
  })
  return (
    <AIFeatureCard
      title={t('analytics.weeklyDigest.aiNarration.title', 'Helix narration')}
      description={t(
        'analytics.weeklyDigest.aiNarration.description',
        'Get a short, Helix-written recap of your week from the digest data above.',
      )}
      buttonLabel={t(
        'analytics.weeklyDigest.aiNarration.generateButton',
        'Generate narration',
      )}
      badgeLabel={t('analytics.weeklyDigest.aiNarration.badge', 'Helix')}
      emptyHint={
        canStart
          ? undefined
          : t(
              'analytics.weeklyDigest.aiNarration.noVehicleHint',
              'Pick a vehicle to enable Helix narration.',
            )
      }
      canStart={canStart}
      stream={stream}
    />
  )
}
InnerSection.displayName = 'AIDigestNarrationInner'

export const AIDigestNarration = withAiFeature('digest-narration', InnerSection)
AIDigestNarration.displayName = 'AIDigestNarration'
