package io.teslasync.android.sharedsurfaces.range

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.data.repo.Resource
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device unit coverage of [RangeProjection] + [RangeSnapshot] — the pure data adapter the composable
 * renders. Exercises the web `selectPreferredRange` selection (rated vs ideal), the `useUnits` SI display
 * formatting (km/mi + precision), the em-dash empty branch (web `meters == null`), and the
 * cache-then-network → projection envelope (loading / content-from-cache / stale / offline / hard error),
 * plus the classified error-kind mapping. Runs in the `:android:testReleaseUnitTest` gate.
 */
class RangeProjectionTest {
    // ── selectPreferredRange port: range-type resolution + value selection ───────────────────────────

    @Test
    fun rangeTypeDefaultsToRatedWhenPreferenceAbsentOrMistyped() {
        assertEquals(PreferredRangeType.Rated, RangeProjection.rangeTypeOf(null))
        assertEquals(PreferredRangeType.Rated, RangeProjection.rangeTypeOf(buildJsonObject {}))
        assertEquals(
            PreferredRangeType.Rated,
            RangeProjection.rangeTypeOf(buildJsonObject { put("preferred_range", "bogus") }),
        )
        assertEquals(PreferredRangeType.Rated, RangeProjection.rangeTypeOf(JsonPrimitive("ideal")))
    }

    @Test
    fun rangeTypeReadsIdealPreference() {
        assertEquals(
            PreferredRangeType.Ideal,
            RangeProjection.rangeTypeOf(buildJsonObject { put("preferred_range", "ideal") }),
        )
    }

    @Test
    fun selectMetresPicksTheFieldForTheType() {
        val snapshot = RangeSnapshot(ratedRangeMeters = 300_000.0, idealRangeMeters = 400_000.0)
        assertEquals(300_000.0, RangeProjection.selectMetres(snapshot, PreferredRangeType.Rated))
        assertEquals(400_000.0, RangeProjection.selectMetres(snapshot, PreferredRangeType.Ideal))
        assertNull(RangeProjection.selectMetres(null, PreferredRangeType.Rated))
        assertNull(RangeProjection.selectMetres(RangeSnapshot(), PreferredRangeType.Ideal))
    }

    @Test
    fun snapshotFromStateReadsSiMetreFields() {
        val state =
            buildJsonObject {
                put("rated_range", 250_000.0)
                put("ideal_range", 270_000.0)
            }
        val snapshot = RangeSnapshot.fromState(state)
        assertEquals(250_000.0, snapshot.ratedRangeMeters)
        assertEquals(270_000.0, snapshot.idealRangeMeters)

        assertEquals(RangeSnapshot(), RangeSnapshot.fromState(null))
        assertEquals(RangeSnapshot(), RangeSnapshot.fromState(JsonPrimitive("nope")))
    }

    // ── useUnits port: SI → display formatting in the resolved phase ─────────────────────────────────

    @Test
    fun contentFormatsMetricRatedRange() {
        val display = RangeProjection.project(success(metric()), RangeSnapshot(ratedRangeMeters = 300_000.0), 0)
        assertEquals(RangePhase.Content, display.phase)
        assertEquals(PreferredRangeType.Rated, display.rangeType)
        assertEquals("300 km", display.valueText)
        assertEquals("300 km", display.displayValue)
    }

    @Test
    fun contentFormatsImperialRange() {
        val display = RangeProjection.project(success(imperial()), RangeSnapshot(ratedRangeMeters = 300_000.0), 0)
        assertEquals("186 mi", display.valueText)
    }

    @Test
    fun contentHonoursPrecisionOverride() {
        val display = RangeProjection.project(success(metric()), RangeSnapshot(ratedRangeMeters = 300_000.0), 1)
        assertEquals("300.0 km", display.valueText)
    }

    @Test
    fun idealPreferenceSelectsIdealValueAndLabelType() {
        val settings =
            success(
                buildJsonObject {
                    put("unit_of_length", "km")
                    put("preferred_range", "ideal")
                },
            )
        val display =
            RangeProjection.project(
                settings,
                RangeSnapshot(ratedRangeMeters = 300_000.0, idealRangeMeters = 400_000.0),
                0,
            )
        assertEquals(PreferredRangeType.Ideal, display.rangeType)
        assertEquals("400 km", display.valueText)
    }

    // ── Empty / loading / error branches ─────────────────────────────────────────────────────────────

    @Test
    fun missingValueRendersEmptyEmDash() {
        val display = RangeProjection.project(success(metric()), null, 0)
        assertEquals(RangePhase.Empty, display.phase)
        assertNull(display.valueText)
        assertEquals("\u2014", display.displayValue)
    }

    @Test
    fun firstLoadWithNoCacheIsLoading() {
        val settings = Resource.Loading<JsonElement>(cached = null, fetchedAt = null, stale = false).toUiState { false }
        val display = RangeProjection.project(settings, RangeSnapshot(ratedRangeMeters = 300_000.0), 0)
        assertEquals(RangePhase.Loading, display.phase)
    }

    @Test
    fun hardErrorWithNoCacheIsError() {
        val settings =
            Resource
                .Error<JsonElement>(cached = null, fetchedAt = null, stale = false, error = RuntimeException("down"))
                .toUiState { false }
        val display = RangeProjection.project(settings, RangeSnapshot(ratedRangeMeters = 300_000.0), 0)
        assertEquals(RangePhase.Error, display.phase)
        assertTrue(display.canRetry)
    }

    // ── Cached → projection: the stale + offline freshness envelope ──────────────────────────────────

    @Test
    fun cachedValueAfterFailedRefreshIsOffline() {
        val settings =
            Resource
                .Error<JsonElement>(cached = imperial(), fetchedAt = 5L, stale = true, error = RuntimeException("net"))
                .toUiState { false }
        val display = RangeProjection.project(settings, RangeSnapshot(ratedRangeMeters = 300_000.0), 0)
        assertEquals(RangePhase.Content, display.phase)
        assertEquals("186 mi", display.valueText)
        assertTrue(display.offline)
        assertFalse(display.stale)
        assertTrue(display.showFreshnessChip)
        assertEquals(5L, display.freshnessStamp)
    }

    @Test
    fun cachedValuePastTtlIsStaleAndRefreshing() {
        val settings =
            Resource.Loading<JsonElement>(cached = metric(), fetchedAt = 9L, stale = true).toUiState { false }
        val display = RangeProjection.project(settings, RangeSnapshot(ratedRangeMeters = 300_000.0), 0)
        assertEquals(RangePhase.Content, display.phase)
        assertEquals("300 km", display.valueText)
        assertTrue(display.stale)
        assertFalse(display.offline)
        assertTrue(display.refreshing)
        assertTrue(display.showFreshnessChip)
    }

    // ── Classified error-kind mapping ────────────────────────────────────────────────────────────────

    @Test
    fun queryErrorKindMapsTheTaxonomy() {
        assertEquals(QueryErrorKind.Waiting, kindFor(ErrorKind.CircuitOpen, null))
        assertEquals(QueryErrorKind.Network, kindFor(ErrorKind.Network, null))
        assertEquals(QueryErrorKind.Network, kindFor(ErrorKind.Timeout, null))
        assertEquals(QueryErrorKind.Unauthorized, kindFor(ErrorKind.Http, 401))
        assertEquals(QueryErrorKind.Unauthorized, kindFor(ErrorKind.Http, 403))
        assertEquals(QueryErrorKind.NotFound, kindFor(ErrorKind.Http, 404))
        assertEquals(QueryErrorKind.ServerError, kindFor(ErrorKind.Http, 503))
        assertEquals(QueryErrorKind.ServerError, kindFor(ErrorKind.Unknown, null))
    }

    private fun kindFor(
        errorKind: ErrorKind,
        httpStatus: Int?,
    ): QueryErrorKind =
        RangeProjection.queryErrorKind(
            RangeDisplay(
                phase = RangePhase.Error,
                rangeType = PreferredRangeType.Rated,
                errorKind = errorKind,
                httpStatus = httpStatus,
            ),
        )

    private companion object {
        fun metric(): JsonElement = buildJsonObject { put("unit_of_length", "km") }

        fun imperial(): JsonElement = buildJsonObject { put("unit_of_length", "mi") }

        fun success(document: JsonElement) = Resource.Success<JsonElement>(document, fetchedAt = 1L, stale = false).toUiState { false }
    }
}
