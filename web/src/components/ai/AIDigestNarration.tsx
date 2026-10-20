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
  weekOffsetWeeks?: number
  weekStart?: string
  weekLabel?: string
}

function InnerSection({ vehicleId, weekOffsetWeeks = 0, weekStart, weekLabel }: InnerSectionProps) {
  const { t } = useTranslation()
  // Mirror the handler-side parser (vehicle_id must be > 0). A missing,
  // non-finite (NaN), zero, or negative id keeps the button disabled so
  // the SPA never fires a request the backend would immediately 400.
  const numericVehicleId =
    typeof vehicleId === 'number' && Number.isFinite(vehicleId) ? vehicleId : 0
  const validVehicle = Number.isSafeInteger(numericVehicleId) && numericVehicleId > 0
  const supportedWeek = Number.isInteger(weekOffsetWeeks) && weekOffsetWeeks >= -12 && weekOffsetWeeks <= 0
  const canStart = validVehicle && supportedWeek
  const body = useMemo(
    () => ({ vehicle_id: numericVehicleId, week_offset_weeks: weekOffsetWeeks }),
    [numericVehicleId, weekOffsetWeeks],
  )
  const stream = useAiStream({
    url: '/ai/digests/weekly/narrate',
    body,
    onEvent: noop,
    scopeKey: `${numericVehicleId}:${weekStart ?? ''}:${weekOffsetWeeks}`,
  })
  return (
    <AIFeatureCard
      title={t('analytics.weeklyDigest.aiNarration.title', 'Helix narration')}
      description={`${t(
        'analytics.weeklyDigest.aiNarration.description',
        'Get a short, Helix-written recap of your week from the digest data above.',
      )} ${weekLabel ?? ''} ${t(
        'analytics.weeklyDigest.aiNarration.utcScope',
        'Narration uses Monday-to-Monday UTC weeks, which may differ from the local-time totals above.',
      )}`}
      buttonLabel={t(
        'analytics.weeklyDigest.aiNarration.generateButton',
        'Generate narration',
      )}
      badgeLabel={t('analytics.weeklyDigest.aiNarration.badge', 'Helix')}
      emptyHint={
        !validVehicle
          ? t(
              'analytics.weeklyDigest.aiNarration.noVehicleHint',
              'Pick a vehicle to enable Helix narration.',
            )
          : !supportedWeek
            ? t(
                'analytics.weeklyDigest.aiNarration.weekLimit',
                'Narration is available only for the current UTC week and the previous 12 weeks. Select a supported week to generate its recap.',
              )
            : undefined
      }
      canStart={canStart}
      stream={stream}
    />
  )
}
InnerSection.displayName = 'AIDigestNarrationInner'

export const AIDigestNarration = withAiFeature('digest-narration', InnerSection)
AIDigestNarration.displayName = 'AIDigestNarration'
