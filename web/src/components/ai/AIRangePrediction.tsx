// ML2 Range-prediction model.
// Wires the "Train range model" button to
// POST /api/v1/ai/ml/range/train. The narration walks the user
// through the per-bucket (temp_bucket × speed_bucket) learned
// Wh/km envelope returned by train_range_model (and the
// deterministic linear-fallback for any bucket with too few
// drives), then summarises the currently-effective heuristic
// baseline via query_range_prediction. The AI never persists state
// it is read-only narration over the learned envelope; the
// canonical Projected Range page at /projected-range
// (RangeProjectionHandler at GET /api/v1/vehicles/{id}/range/projection)
// is unchanged (ADR-015 §I3 + §I8 propose-only contract).

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
  // Default learning window: the last 14 days. Wide enough to
  // capture a representative weekly cadence (commuting + weekend
  // long drives), narrow enough that a recent owner-behaviour
  // change (new commute, summer→winter) is reflected in the
  // learned per-bucket Wh/km within a couple of weeks. The trainer
  // clamps the upper bound at mlrange.MaxDays=30, so wider values
  // are silently capped server-side.
  const body = useMemo(
    () => ({ vehicle_id: vehicleId ?? 0, days: 14 }),
    [vehicleId],
  )
  const stream = useAiStream({
    url: '/ai/ml/range/train',
    body,
    onEvent: () => {},
  })
  // Computed disabled — never literal-true. The explicit boolean expression
  // also keeps the on-mode wiring test honest: a regression that
  // pins the button as always-disabled would silently falsify the
  // double-submit guard test.
    return (
    <AIFeatureCard
      title={t('range.aiPredict.title', 'Learn per-vehicle range model')}
      description={t(
                'range.aiPredict.description',
                'Compute per-bucket (temperature × speed) learned Wh/km from this vehicle’s recent drives and walk through how each bucket compares to the static heuristic curve the projection uses today.',
              )}
      buttonLabel={t('range.aiPredict.generateButton', 'Train range model')}
      badgeLabel={t('range.aiPredict.badge', 'Helix')}
      canStart={vehicleId != null}
      stream={stream}
    />
  )
}
InnerSection.displayName = 'AIRangePredictionInner'

export const AIRangePrediction = withAiFeature(
  'range-prediction-model',
  InnerSection,
)
AIRangePrediction.displayName = 'AIRangePrediction'
