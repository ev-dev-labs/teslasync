package io.teslasync.android.dashboard.widgets.drivingdynamics

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the DrivingDynamicsWidget's pure logic — the raw-SI-JSON decode, the
 * `maxG` / `isSmooth` / `deriveSeverity` / `gaugeColor` derivations, the histogram transformation, the
 * compact-hero TalkBack phrase, the empty projection, the registry metadata, and the cache-then-network
 * combine mapper that folds the primary dynamics feed with the supplementary distribution feed. Mirrors
 * the web spec (web/src/features/dashboard/widgets/DrivingDynamicsWidget.tsx).
 */
class DrivingDynamicsProjectionTest {
    private val strings =
        DrivingDynamicsStrings(
            title = "Driving Dynamics",
            maxG = "Max g",
            smooth = "Smooth",
            aggressive = "Aggressive",
            noData = "No dynamics data",
            accel = "Accel",
            brake = "Brake",
            lateral = "Lateral",
            distribution = "G-Force Distribution",
        )

    private fun dynamics(
        maxAccel: Double = 0.3,
        maxBraking: Double = 0.25,
        maxCornering: Double = 0.2,
        avgAccel: Double = 0.18,
        avgBraking: Double = 0.12,
    ): JsonObject =
        buildJsonObject {
            put("max_acceleration_g", maxAccel)
            put("max_braking_g", maxBraking)
            put("max_cornering_g", maxCornering)
            put("avg_acceleration_g", avgAccel)
            put("avg_braking_g", avgBraking)
            put("smoothness_score", 70.0)
        }

    private fun distribution(vararg values: Double): JsonObject =
        buildJsonObject {
            put(
                "values",
                buildJsonArray { values.forEach { add(it) } },
            )
        }

    private fun project(
        dyn: JsonObject = dynamics(),
        dist: JsonObject? = distribution(2.0, 5.0, 8.0),
    ) = DrivingDynamicsProjection.project(DrivingDynamicsBundle(dyn, dist), strings, Locale.US)

    // ---- empty / no-data --------------------------------------------------------------

    @Test
    fun nullBundleIsEmpty() {
        val display = DrivingDynamicsProjection.project(null, strings, Locale.US)
        assertFalse(display.hasData)
        assertEquals("No dynamics data", display.noDataMessage)
        assertEquals(EM_DASH, display.maxGText)
        assertTrue(display.histogram.isEmpty())
    }

    @Test
    fun nonObjectDynamicsIsEmpty() {
        val display = DrivingDynamicsProjection.project(DrivingDynamicsBundle(JsonNull, null), strings, Locale.US)
        assertFalse(display.hasData)
    }

    // ---- maxG / smoothness ------------------------------------------------------------

    @Test
    fun maxGIsLargestOfThreeMaxReadings() {
        val display = project(dynamics(maxAccel = 0.31, maxBraking = 0.52, maxCornering = 0.18))
        assertEquals(0.52, display.maxG, 1e-9)
        assertEquals("0.52", display.maxGText)
    }

    @Test
    fun smoothWhenMaxGBelowThreshold() {
        assertTrue(DrivingDynamicsProjection.isSmooth(0.39))
        assertFalse(DrivingDynamicsProjection.isSmooth(0.4))
        assertFalse(DrivingDynamicsProjection.isSmooth(0.41))
    }

    @Test
    fun compactWordAndBadgeFollowSmoothness() {
        val smooth = project(dynamics(maxAccel = 0.2, maxBraking = 0.2, maxCornering = 0.2))
        assertTrue(smooth.smooth)
        assertEquals("Smooth", smooth.compactWord)

        val rough = project(dynamics(maxAccel = 0.9, maxBraking = 0.2, maxCornering = 0.2))
        assertFalse(rough.smooth)
        assertEquals("Aggressive", rough.compactWord)
    }

    @Test
    fun compactContentDescriptionFoldsLabelNumberAndWord() {
        val display = project(dynamics(maxAccel = 0.2, maxBraking = 0.2, maxCornering = 0.2))
        assertEquals("Max g 0.20, Smooth", display.compactContentDescription)
    }

    // ---- severity (deriveSeverity) ----------------------------------------------------

    @Test
    fun severityBucketsMatchWebThresholds() {
        // avg = (avgAccel + avgBraking) / 2
        assertEquals(GForceTone.Calm, DrivingDynamicsProjection.deriveSeverity(0.1, 0.1)) // 0.10 < 0.15
        assertEquals(GForceTone.Normal, DrivingDynamicsProjection.deriveSeverity(0.2, 0.2)) // 0.20 < 0.30
        assertEquals(GForceTone.Sporty, DrivingDynamicsProjection.deriveSeverity(0.4, 0.4)) // 0.40 < 0.50
        assertEquals(GForceTone.Aggressive, DrivingDynamicsProjection.deriveSeverity(0.6, 0.6)) // >= 0.50
    }

    @Test
    fun severityWordIsBinaryStyleVocabulary() {
        // Calm/Normal → success half → "Smooth"; Sporty/Aggressive → warning half → "Aggressive".
        assertEquals("Smooth", project(dynamics(avgAccel = 0.1, avgBraking = 0.1)).severityWord)
        assertEquals("Smooth", project(dynamics(avgAccel = 0.2, avgBraking = 0.2)).severityWord)
        assertEquals("Aggressive", project(dynamics(avgAccel = 0.4, avgBraking = 0.4)).severityWord)
        assertEquals("Aggressive", project(dynamics(avgAccel = 0.7, avgBraking = 0.7)).severityWord)
    }

    @Test
    fun isPositiveCoversCalmAndNormalOnly() {
        assertTrue(DrivingDynamicsProjection.isPositive(GForceTone.Calm))
        assertTrue(DrivingDynamicsProjection.isPositive(GForceTone.Normal))
        assertFalse(DrivingDynamicsProjection.isPositive(GForceTone.Sporty))
        assertFalse(DrivingDynamicsProjection.isPositive(GForceTone.Aggressive))
    }

    // ---- gauges (gaugeColor + label + value) ------------------------------------------

    @Test
    fun gaugeToneBucketsMatchWebThresholds() {
        assertEquals(GForceTone.Calm, DrivingDynamicsProjection.gaugeTone(0.19)) // < 0.2
        assertEquals(GForceTone.Normal, DrivingDynamicsProjection.gaugeTone(0.39)) // < 0.4
        assertEquals(GForceTone.Sporty, DrivingDynamicsProjection.gaugeTone(0.59)) // < 0.6
        assertEquals(GForceTone.Aggressive, DrivingDynamicsProjection.gaugeTone(0.6)) // >= 0.6
    }

    @Test
    fun gaugesBindAvgAccelAvgBrakeAndMaxCornering() {
        val display = project(dynamics(avgAccel = 0.18, avgBraking = 0.45, maxCornering = 0.7))
        assertEquals(0.18, display.accel.value, 1e-9)
        assertEquals("Accel", display.accel.label)
        assertEquals(GForceTone.Calm, display.accel.tone)

        assertEquals(0.45, display.brake.value, 1e-9)
        assertEquals("Brake", display.brake.label)
        assertEquals(GForceTone.Sporty, display.brake.tone)

        // Lateral gauge uses max_cornering_g (web `dynamics.maxCorneringG`), not an avg.
        assertEquals(0.7, display.lateral.value, 1e-9)
        assertEquals("Lateral", display.lateral.label)
        assertEquals(GForceTone.Aggressive, display.lateral.tone)
    }

    @Test
    fun missingFieldsReadAsZero() {
        val display = DrivingDynamicsProjection.project(DrivingDynamicsBundle(buildJsonObject { }, null), strings, Locale.US)
        assertTrue(display.hasData)
        assertEquals(0.0, display.maxG, 1e-9)
        assertEquals(0.0, display.accel.value, 1e-9)
        assertEquals(GForceTone.Calm, display.severity)
    }

    // ---- histogram --------------------------------------------------------------------

    @Test
    fun histogramMapsValuesToEvenlySpacedBars() {
        val bars = DrivingDynamicsProjection.histogram(distribution(3.0, 8.0, 5.0), Locale.US)
        // step = G_MAX / n = 1.2 / 3 = 0.4 → labels 0.00, 0.40, 0.80
        assertEquals(3, bars.size)
        assertEquals(listOf("0.00", "0.40", "0.80"), bars.map { it.rangeLabel })
        assertEquals(listOf(3.0, 8.0, 5.0), bars.map { it.count })
    }

    @Test
    fun histogramEmptyForNoValuesOrNonObject() {
        assertTrue(DrivingDynamicsProjection.histogram(distribution(), Locale.US).isEmpty())
        assertTrue(DrivingDynamicsProjection.histogram(null, Locale.US).isEmpty())
        assertTrue(DrivingDynamicsProjection.histogram(JsonNull, Locale.US).isEmpty())
    }

    @Test
    fun projectFoldsHistogramFromDistribution() {
        val display = project(dist = distribution(1.0, 2.0))
        assertEquals(2, display.histogram.size)
        assertEquals(listOf("0.00", "0.60"), display.histogram.map { it.rangeLabel })
    }

    @Test
    fun projectWithoutDistributionHasNoHistogram() {
        val display = project(dist = null)
        assertTrue(display.hasData)
        assertTrue(display.histogram.isEmpty())
    }

    // ---- registry metadata ------------------------------------------------------------

    @Test
    fun registrationMatchesWebRegistry() {
        assertEquals("driving-dynamics", DrivingDynamicsRegistration.ID)
        assertEquals("driving", DrivingDynamicsRegistration.CATEGORY)
        assertEquals("DrivingDynamicsWidget", DrivingDynamicsRegistration.SLUG)
        assertEquals(DrivingDynamicsSize(2, 4), DrivingDynamicsRegistration.DEFAULT_SIZE)
        assertEquals(DrivingDynamicsSize(1, 2), DrivingDynamicsRegistration.MIN_SIZE)
        assertEquals(DrivingDynamicsSize(4, 40), DrivingDynamicsRegistration.MAX_SIZE)
    }

    @Test
    fun registrationClampAndBounds() {
        assertEquals(DrivingDynamicsSize(1, 2), DrivingDynamicsRegistration.clamp(DrivingDynamicsSize(0, 1)))
        assertEquals(DrivingDynamicsSize(4, 40), DrivingDynamicsRegistration.clamp(DrivingDynamicsSize(9, 99)))
        assertTrue(DrivingDynamicsRegistration.isWithinBounds(DrivingDynamicsSize(2, 4)))
        assertFalse(DrivingDynamicsRegistration.isWithinBounds(DrivingDynamicsSize(5, 4)))
    }

    @Test
    fun sizeCompactAndWideFlags() {
        assertTrue(DrivingDynamicsSize(1, 2).isCompact)
        assertFalse(DrivingDynamicsSize(2, 4).isCompact)
        assertFalse(DrivingDynamicsSize(2, 4).isWide)
        assertTrue(DrivingDynamicsSize(3, 4).isWide)
        assertTrue(DrivingDynamicsSize(4, 4).isWide)
    }

    // ---- combine (cache-then-network fold) --------------------------------------------

    @Test
    fun combineBothLoadingNoCacheStaysLoading() {
        val out = combineDrivingDynamics(Resource.Loading(null, null, false), Resource.Loading(null, null, false))
        assertTrue(out is Resource.Loading)
        assertNull(out.cached)
    }

    @Test
    fun combineBothSuccessProducesBundleWithMaxFetchedAt() {
        val dyn = dynamics()
        val dist = distribution(1.0, 2.0)
        val out = combineDrivingDynamics(Resource.Success(dyn, 100L, false), Resource.Success(dist, 250L, false))
        assertTrue(out is Resource.Success)
        out as Resource.Success
        assertEquals(dyn, out.data.dynamics)
        assertEquals(dist, out.data.distribution)
        assertEquals(250L, out.fetchedAt) // web Math.max(dyn, dist)
    }

    @Test
    fun combineDynamicsReadyButDistributionLoadingShowsRefreshOverContent() {
        val dyn = dynamics()
        val out = combineDrivingDynamics(Resource.Success(dyn, 100L, false), Resource.Loading(null, null, false))
        // Refresh-over-cached: content visible (gauges) + refreshing chip, never a skeleton.
        assertTrue(out is Resource.Loading)
        out as Resource.Loading
        assertEquals(dyn, out.cached?.dynamics)
        assertNull(out.cached?.distribution)
    }

    @Test
    fun combineDistributionBestEffortDoesNotGateOnItsError() {
        val dyn = dynamics()
        val out = combineDrivingDynamics(Resource.Success(dyn, 100L, false), Resource.Error(null, 50L, false, ApiError.Network()))
        // Dynamics succeeded → surface is Success even though the distribution feed errored.
        assertTrue(out is Resource.Success)
        out as Resource.Success
        assertEquals(dyn, out.data.dynamics)
        assertNull(out.data.distribution)
    }

    @Test
    fun combineDynamicsErrorNoCacheIsError() {
        val out = combineDrivingDynamics(Resource.Error(null, null, false, ApiError.Timeout()), Resource.Loading(null, null, false))
        assertTrue(out is Resource.Error)
        assertNull(out.cached)
    }

    @Test
    fun combineDynamicsErrorWithCacheKeepsBundle() {
        val dyn = dynamics()
        val dist = distribution(4.0)
        val out =
            combineDrivingDynamics(
                Resource.Error(dyn, 100L, true, ApiError.Network()),
                Resource.Success(dist, 90L, false),
            )
        assertTrue(out is Resource.Error)
        out as Resource.Error
        assertEquals(dyn, out.cached?.dynamics)
        assertEquals(dist, out.cached?.distribution)
        assertTrue(out.stale)
    }

    @Test
    fun combineDynamicsLoadingWithCacheFoldsDistribution() {
        val cachedDyn = dynamics()
        val dist = distribution(1.0, 2.0, 3.0)
        val out =
            combineDrivingDynamics(
                Resource.Loading(cachedDyn, 80L, true),
                Resource.Success(dist, 120L, false),
            )
        assertTrue(out is Resource.Loading)
        out as Resource.Loading
        assertEquals(cachedDyn, out.cached?.dynamics)
        assertEquals(dist, out.cached?.distribution)
        assertEquals(120L, out.fetchedAt)
        assertTrue(out.stale)
    }
}
