package io.teslasync.android.sharedsurfaces.elevationprofile

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the ElevationProfile surface's pure logic — the native analogue of the web
 * surface's inline derivations (web/src/components/charts/ElevationProfile.tsx): the samples → render-ready
 * projection (distance x labels, the index-aligned elevation value list, the `↑ {gain}m  ↓ {loss}m` subtitle
 * with web `Math.round` rounding, the clamped replay cursor), the `data.length === 0` empty guard, the
 * cumulative gain/loss reducer with its non-finite guard, the prop-driven lifecycle-state builder, the locale
 * resolver, and the PII-safe `view.opened` diagnostic. Runs in the :android:testReleaseUnitTest gate.
 */
class ElevationProfileProjectionTest {
    private fun points(): List<ElevationProfilePoint> =
        listOf(
            ElevationProfilePoint(index = 0, distance = 0.0, elevation = 120.0, speed = 0.0),
            ElevationProfilePoint(index = 1, distance = 1.2, elevation = 168.0, speed = 42.0),
            ElevationProfilePoint(index = 2, distance = 2.6, elevation = 210.0, speed = null),
            ElevationProfilePoint(index = 3, distance = 3.9, elevation = 184.0, speed = 58.0),
            ElevationProfilePoint(index = 4, distance = 5.1, elevation = 142.0, speed = 31.0),
        )

    private fun data(): ElevationProfileData = ElevationProfileData(points())

    private val usDistance: (Double) -> String = { "%.1f".format(Locale.US, it) }

    // ── project (x labels, elevation values, subtitle, order) ─────────────────────

    @Test
    fun projectMapsDistanceLabelsAndElevationValuesInOrder() {
        val result = ElevationProfileProjection.project(data(), currentIndex = null, formatDistance = usDistance)

        assertFalse(result.isEmpty)
        assertEquals(listOf("0.0", "1.2", "2.6", "3.9", "5.1"), result.xLabels)
        assertEquals(listOf(120.0, 168.0, 210.0, 184.0, 142.0), result.elevationValues)
    }

    @Test
    fun projectBuildsGainLossSubtitleWithArrowsAndMetreSuffix() {
        // diffs: +48, +42, -26, -42 → gain 90, loss 68.
        val result = ElevationProfileProjection.project(data(), currentIndex = null, formatDistance = usDistance)

        assertEquals(90L, result.gainMeters)
        assertEquals(68L, result.lossMeters)
        assertEquals("\u2191 90m  \u2193 68m", result.subtitle)
    }

    // ── cursor clamping (web data[currentIndex] guard) ────────────────────────────

    @Test
    fun projectKeepsAnInRangeCursorIndex() {
        val result = ElevationProfileProjection.project(data(), currentIndex = 2, formatDistance = usDistance)

        assertEquals(2, result.cursorIndex)
    }

    @Test
    fun projectDropsAnOutOfRangeOrNullCursorIndex() {
        assertNull(ElevationProfileProjection.project(data(), currentIndex = 9, formatDistance = usDistance).cursorIndex)
        assertNull(ElevationProfileProjection.project(data(), currentIndex = -1, formatDistance = usDistance).cursorIndex)
        assertNull(ElevationProfileProjection.project(data(), currentIndex = null, formatDistance = usDistance).cursorIndex)
    }

    // ── empty guard (web data.length === 0) ───────────────────────────────────────

    @Test
    fun projectIsEmptyOnlyForZeroSamples() {
        val zero = ElevationProfileProjection.project(ElevationProfileData(emptyList()), null, usDistance)
        val one =
            ElevationProfileProjection.project(
                ElevationProfileData(listOf(ElevationProfilePoint(0, 0.0, 120.0, 0.0))),
                null,
                usDistance,
            )

        assertTrue(zero.isEmpty)
        // The web renders the chart for a single point (only `data.length === 0` is empty).
        assertFalse(one.isEmpty)
    }

    // ── gainLoss (web reducer + Math.round + safeNumber) ──────────────────────────

    @Test
    fun gainLossSumsConsecutivePositiveAndNegativeDeltas() {
        val (gain, loss) = ElevationProfileProjection.gainLoss(listOf(100.0, 130.0, 110.0, 160.0))

        // +30, -20, +50 → gain 80, loss 20.
        assertEquals(80L, gain)
        assertEquals(20L, loss)
    }

    @Test
    fun gainLossRoundsHalfUpLikeTheWebMathRound() {
        // Single +2.5 climb → Math.round(2.5) === 3; single -1.5 drop → Math.round(1.5) === 2.
        assertEquals(3L, ElevationProfileProjection.gainLoss(listOf(0.0, 2.5)).first)
        assertEquals(2L, ElevationProfileProjection.gainLoss(listOf(1.5, 0.0)).second)
    }

    @Test
    fun gainLossIsZeroForEmptyOrSingleSample() {
        assertEquals(0L to 0L, ElevationProfileProjection.gainLoss(emptyList()))
        assertEquals(0L to 0L, ElevationProfileProjection.gainLoss(listOf(120.0)))
    }

    @Test
    fun gainLossCollapsesNonFiniteTotalsToZero() {
        // A corrupt (NaN) sample must never surface as `NaN m` — the web `safeNumber` guard.
        val (gain, loss) = ElevationProfileProjection.gainLoss(listOf(0.0, Double.NaN, 10.0))

        assertEquals(0L, gain)
        assertEquals(0L, loss)
    }

    // ── elevationProfileState (prop-driven lifecycle builder) ─────────────────────

    @Test
    fun elevationProfileStateIsEmptyForNullOrEmptyPoints() {
        assertEquals(UiPhase.Empty, elevationProfileState(null).phase)
        assertEquals(UiPhase.Empty, elevationProfileState(emptyList()).phase)
    }

    @Test
    fun elevationProfileStateIsContentForOneOrMorePoints() {
        val state = elevationProfileState(points())

        assertEquals(UiPhase.Content, state.phase)
        assertEquals(5, state.data?.points?.size)
    }

    // ── resolveDisplayLocale ──────────────────────────────────────────────────────

    @Test
    fun resolveDisplayLocaleFallsBackToUsForBlankOrNull() {
        assertEquals(Locale.US, resolveDisplayLocale(null))
        assertEquals(Locale.US, resolveDisplayLocale(""))
        assertEquals(Locale.US, resolveDisplayLocale("   "))
    }

    @Test
    fun resolveDisplayLocaleParsesBcp47Tag() {
        assertEquals(Locale.US, resolveDisplayLocale("en-US"))
        assertEquals("de", resolveDisplayLocale("de-DE").language)
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordElevationProfileOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "ElevationProfile"), fields)
    }

    @Test
    fun registrationSlugMatchesTheDiagnosticSurface() {
        assertEquals("ElevationProfile", ElevationProfileRegistration.SLUG)
        assertEquals("elevation-profile", ElevationProfileRegistration.ID)
    }

    // ── lifecycle field plumbing (sanity that UiState carries the freshness contract) ──

    @Test
    fun uiStateExposesTheFreshnessContractTheSurfaceReads() {
        val offline =
            elevationProfileState(points()).copy(
                fetchedAt = 1_700_000_000_000L,
                stale = true,
                errorKind = ErrorKind.Network,
            )

        assertTrue(offline.stale)
        assertTrue(offline.hasError)
        assertTrue(offline.isOffline)
        assertFalse(offline.isLoading)
    }

    private class RecordingLogger : Logger {
        val records = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += event to fields
        }
    }
}
