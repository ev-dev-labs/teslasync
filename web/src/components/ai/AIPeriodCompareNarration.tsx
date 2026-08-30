// Opt-in AI narration for Period Compare. It never replaces the deterministic
// charts, metrics, tables, or insight panels.
//
// The feature gate hides the section entirely when disabled. When enabled, the
// Narrate button opens an SSE stream from /ai/analytics/period-compare/narrate.
// useAiStream is called unconditionally, and the button disables while streaming
// or while the required vehicle context is missing.

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
  /** Optional until active-vehicle context resolves; disables Narrate when absent. */
  vehicleId?: string | number
  /** Period A trailing-day window; 0 means "all time" and is passed through. */
  daysA?: number
  /** Period B trailing-day window; omitted values use the backend default. */
  daysB?: number
}

/**
 * InnerSection is the always-rendered body of the AI period-compare
 * narration card. The surrounding {@link withAiFeature} HOC handles
 * the visibility gate; this component only describes the surface's
 * appearance.
 *
 * Visual contract:
 *   - One GlassPanel sized to sit above the per-period MetricCards
 *     on PeriodComparePage.
 *   - Cyan AI badge in the header (matches the chatbot brand
 *     colour).
 *   - Narrate button is disabled while a stream is open OR when no
 *     vehicleId is available from the active-vehicle context.
 *   - Title attribute carries the long-form explanation so a user
 *     hovering for a tooltip understands the privacy contract — only
 *     the vehicle name may be narrated; the aggregate analytics are
 *     the same the chart shows. The narrator never changes the
 *     deterministic deltas — it only explains them.
 */
function InnerSection({ vehicleId, daysA, daysB }: InnerSectionProps) {
  const { t } = useTranslation()
  const numericVehicleId =
    typeof vehicleId === 'number' ? vehicleId : Number(vehicleId)
  // Keep the button disabled until vehicle_id is valid, while still calling the
  // hook unconditionally so hook order stays stable.
  const body = useMemo(() => {
    const out: { vehicle_id: number; days_a?: number; days_b?: number } = {
      vehicle_id: Number.isFinite(numericVehicleId) ? numericVehicleId : 0,
    }
    // 0 means "all time"; omit only when the caller did not provide a value.
    if (typeof daysA === 'number' && Number.isFinite(daysA) && daysA >= 0) {
      out.days_a = daysA
    }
    if (typeof daysB === 'number' && Number.isFinite(daysB) && daysB >= 0) {
      out.days_b = daysB
    }
    return out
  }, [numericVehicleId, daysA, daysB])
  const stream = useAiStream({
    url: '/ai/analytics/period-compare/narrate',
    body,
    onEvent: noop,
    // AI-01: vehicle + period-window scope is part of stream
    // identity — changing any of them aborts an in-flight narration
    // and clears the previous scope's narrative before the new scope
    // streams in.
    scopeKey:
      Number.isFinite(numericVehicleId) && numericVehicleId > 0
        ? `${numericVehicleId}:${body.days_a ?? ''}:${body.days_b ?? ''}`
        : null,
  })
  const haveInputs = Number.isFinite(numericVehicleId) && numericVehicleId > 0
  return (
    <AIFeatureCard
      title={t('compare.aiNarrative.title', 'Narrate the period comparison')}
      description={t(
        'compare.aiNarrative.description',
        'Ask Helix to explain the deterministic period-over-period analytics \u2014 which one or two metrics moved most between Period A and Period B, with directional phrasing keyed to the percent_change sign. The numbers are the same the chart and table below show; the narrator only explains them and is honest about zero-baseline windows and best-effort cost figures.',
      )}
      buttonLabel={t('compare.aiNarrative.generateButton', 'Narrate comparison')}
      badgeLabel={t('compare.aiNarrative.badge', 'Helix')}
      emptyHint={
        haveInputs
          ? undefined
          : t(
              'compare.aiNarrative.noVehicleHint',
              'Pick a vehicle to enable Helix narration.',
            )
      }
      canStart={haveInputs}
      stream={stream}
    />
  )
}
InnerSection.displayName = 'AIPeriodCompareNarrationInner'

/**
 * AIPeriodCompareNarration renders the LLM period-compare narration
 * section only when the period-compare-narration feature is enabled.
 * The wrapping div from {@link withAiFeature} carries
 * `data-testid="ai-feature-period-compare-narration-root"`, which the
 * off-mode invariant test asserts against.
 */
export const AIPeriodCompareNarration = withAiFeature(
  'period-compare-narration',
  InnerSection,
)
AIPeriodCompareNarration.displayName = 'AIPeriodCompareNarration'
