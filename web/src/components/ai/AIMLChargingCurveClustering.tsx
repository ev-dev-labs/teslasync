// ML charging-curve fingerprint clustering model. Wires the "Train charging-curve clusters"
// button to POST /api/v1/ai/ml/charging-curves/cluster. The
// narration walks the user through the per-cluster (L1 overnight /
// L2 workplace / DC fast / unknown) LEARNED charging envelope
// (mean peak power plus stddev / p5 / p95 per cluster, mean avg
// power / total energy / duration / ramp shape) returned by
// train_charge_curve_clusters AND the deterministic rule-label
// fallback per cluster (when fewer than
// mlchargingcurves.DefaultMinSessionsPerCluster=3 sessions exist
// in the lookback window), then summarises the
// currently-effective baseline via query_charge_curve_clusters.
//
// The AI never persists state — it is read-only narration over
// the learned envelope; the canonical Charging Curve page at
// /charging/curves with the existing rule-based session labels
// (web/src/features/charging/components/charging-curve/helpers.ts)
// is unchanged (ADR-015 §I3 + §I8 propose-only contract).
//
// Sibling distinction: this is the ML3-tier *statistical
// clustering* model. The C3-tier *charging-curve-fingerprint-
// clustering* feature is a separate LLM narrator over the C3
// aggregator's output; both surfaces coexist on /charging/curves
// with independent per-feature toggles and independent test IDs.

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
  // Default learning window: the last 90 days. Charging sessions
  // are O(0.1–1/day) per vehicle (the prompt's
  // DefaultMinSessionsPerCluster=3 acknowledges this), so a 90-day
  // window is what the trainer needs to cover representative
  // L1/L2/DC behaviour. The Go trainer clamps the upper bound at
  // mlchargingcurves.MaxLookbackDays=365, so wider values are
  // silently capped server-side. Mirrors the SPA Charging Curve
  // page's default lookback for parity with the baseline charts.
  const body = useMemo(
    () => ({ vehicle_id: vehicleId ?? 0, lookback_days: 90 }),
    [vehicleId],
  )
  const stream = useAiStream({
    url: '/ai/ml/charging-curves/cluster',
    body,
    onEvent: () => {},
  })
  // Keep the disabled state computed rather than hard-coded; the explicit
  // boolean expression keeps the on-mode wiring test honest: a regression that
  // pins the button as always-disabled would silently falsify the
  // double-submit guard test.
    return (
    <AIFeatureCard
      title={t(
                  'charging.aiMlClustering.title',
                  'Learn per-vehicle charging-curve clusters',
                )}
      description={t(
                'charging.aiMlClustering.description',
                'Compute per-cluster (L1 overnight / L2 workplace / DC fast) learned charging envelope from this vehicle’s recent sessions and walk through how each cluster compares to the deterministic rule-label baseline used by the Charging Curve page today.',
              )}
      buttonLabel={t(
                  'charging.aiMlClustering.generateButton',
                  'Train charging-curve clusters',
                )}
      badgeLabel={t('charging.aiMlClustering.badge', 'Helix')}
      canStart={vehicleId != null}
      stream={stream}
    />
  )
}
InnerSection.displayName = 'AIMLChargingCurveClusteringInner'

export const AIMLChargingCurveClustering = withAiFeature(
  'ml-charging-curve-clustering',
  InnerSection,
)
AIMLChargingCurveClustering.displayName = 'AIMLChargingCurveClustering'
