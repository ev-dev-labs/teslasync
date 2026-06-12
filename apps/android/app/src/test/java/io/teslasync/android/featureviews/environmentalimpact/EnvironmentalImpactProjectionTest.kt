package io.teslasync.android.featureviews.environmentalimpact

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Off-device verification of the EnvironmentalImpact data adapter — the native mirror of the lone derivation
 * the web component performs (web/src/features/charging/components/cost-analysis/EnvironmentalImpact.tsx): the
 * `coreStats.co2SavedKg / 1000` kilograms→metric-tonnes conversion. Every other figure is a pass-through, so
 * the [EnvironmentalImpactDisplay] is exactly what the thin composable formats and renders, and these
 * assertions double as the per-projection "snapshot". Runs in the :android:testReleaseUnitTest gate.
 */
class EnvironmentalImpactProjectionTest {
    // ── metricTons (web `coreStats.co2SavedKg / 1000`) ──────────────────────────────

    @Test
    fun metricTonsDividesKilogramsByOneThousand() {
        assertEquals(0.0, EnvironmentalImpactProjection.metricTons(0.0), 0.0)
        assertEquals(0.54, EnvironmentalImpactProjection.metricTons(540.0), 1e-9)
        assertEquals(1.0, EnvironmentalImpactProjection.metricTons(1000.0), 1e-9)
        assertEquals(2.5, EnvironmentalImpactProjection.metricTons(2500.0), 1e-9)
    }

    @Test
    fun metricTonsConstantIsOneThousand() {
        assertEquals(1000.0, EnvironmentalImpactProjection.KG_PER_METRIC_TON, 0.0)
    }

    // ── Projection (the data-adapter path: computed CoreStats slice -> render-ready display) ──

    @Test
    fun projectPassesThroughEveryFigureAndDerivesMetricTons() {
        val display =
            EnvironmentalImpactProjection.project(
                EnvironmentalImpactData(
                    co2SavedKg = 540.0,
                    treeEquiv = 25.7,
                    gallonsEquiv = 61.0,
                    savings = 318.0,
                ),
            )

        assertEquals(540.0, display.co2SavedKg, 0.0)
        assertEquals(25.7, display.treeEquiv, 0.0)
        assertEquals(61.0, display.gallonsEquiv, 0.0)
        assertEquals(318.0, display.savings, 0.0)
        assertEquals(0.54, display.metricTonsCo2, 1e-9)
    }

    @Test
    fun zeroStatsProjectTheFriendlyNoImpactValues() {
        // The all-zero case still projects (0 kg / 0 trees / 0 gal / $0 / 0 t) — the composable renders the
        // populated breakdown with zeros, never a blank box.
        val display = EnvironmentalImpactProjection.project(EnvironmentalImpactData())

        assertEquals(0.0, display.co2SavedKg, 0.0)
        assertEquals(0.0, display.treeEquiv, 0.0)
        assertEquals(0.0, display.gallonsEquiv, 0.0)
        assertEquals(0.0, display.savings, 0.0)
        assertEquals(0.0, display.metricTonsCo2, 0.0)
    }

    @Test
    fun defaultedDataModelsAStillComputingCoreStats() {
        // A partial CoreStats (only CO₂ resolved so far) projects without throwing — the other fields default
        // to zero, exactly as the web `coreStats?.field ?? 0` reads degrade.
        val display = EnvironmentalImpactProjection.project(EnvironmentalImpactData(co2SavedKg = 1500.0))

        assertEquals(1500.0, display.co2SavedKg, 0.0)
        assertEquals(0.0, display.treeEquiv, 0.0)
        assertEquals(1.5, display.metricTonsCo2, 1e-9)
    }

    @Test
    fun largeFleetStatsProjectAtFullPrecision() {
        // Defends the metric-tonnes derivation against grouping-sized inputs (formatting is the render layer's
        // job; the projection keeps full precision).
        val display =
            EnvironmentalImpactProjection.project(
                EnvironmentalImpactData(
                    co2SavedKg = 12_345.6,
                    treeEquiv = 588.0,
                    gallonsEquiv = 1_390.0,
                    savings = 7_250.0,
                ),
            )

        assertEquals(12_345.6, display.co2SavedKg, 0.0)
        assertEquals(12.3456, display.metricTonsCo2, 1e-9)
        assertEquals(588.0, display.treeEquiv, 0.0)
        assertEquals(7_250.0, display.savings, 0.0)
    }
}
