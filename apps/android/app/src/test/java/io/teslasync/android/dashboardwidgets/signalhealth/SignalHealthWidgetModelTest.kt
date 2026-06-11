package io.teslasync.android.dashboardwidgets.signalhealth

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.data.ErrorKind
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.util.Locale

/**
 * Pure unit tests for the Signal Health model + projection — the data adapter the prompt requires.
 * Covers the active/stale split from the live-gap map, the freshness-age + total-signal derivation,
 * the gap-row null-first/oldest-first ordering, the `healthLevel` thresholds, the `formatAge` +
 * `formatRelative` time bucketing, timestamp parsing (zone variants, bare scalars, garbage), the
 * status→badge + error-kind mappings, and the registry metadata/bounds. These run in the
 * `:android:testReleaseUnitTest` gate with no device.
 */
class SignalHealthWidgetModelTest {
    private val locale = Locale.US
    private val now = 1_700_000_000_000L

    private fun iso(epochMillis: Long): String = Instant.ofEpochMilli(epochMillis).toString()

    /** A live-gap entry `{value, timestamp}` (web `useSignalGaps` element); `null` ts ⇒ no timestamp key. */
    private fun entry(timestamp: String?): JsonElement =
        buildJsonObject {
            put("value", 1)
            timestamp?.let { put("timestamp", it) }
        }

    // ── Projection: active / stale split + freshness + totals ─────────────────────

    @Test
    fun buildSplitsActiveAndStaleByTheFiveMinuteWindow() {
        val gaps =
            mapOf(
                "Fresh" to entry(iso(now - 60_000L)),
                "Stale" to entry(iso(now - 10L * 60_000L)),
                "NoTs" to entry(null),
                "Bare" to JsonPrimitive(3.0),
            )
        val data = SignalHealthProjection.build(listOf("Fresh", "Stale", "NoTs", "Bare", "Extra"), gaps, true, now)

        assertEquals(5, data.totalSignals)
        assertEquals(1, data.activeCount)
        assertEquals(3, data.staleCount)
        assertEquals(4, data.liveTotal)
        assertEquals(60L, data.freshnessAgeSeconds)
        assertEquals(SignalHealthLevel.Critical, data.healthLevel)
        assertTrue(data.hasData)
    }

    @Test
    fun buildSortsGapsNullFirstThenOldestFirst() {
        val gaps =
            mapOf(
                "Newer" to entry(iso(now - 6L * 60_000L)),
                "Older" to entry(iso(now - 30L * 60_000L)),
                "ZetaNull" to entry(null),
                "AlphaNull" to JsonPrimitive(0),
            )
        val data = SignalHealthProjection.build(listOf("Newer", "Older", "ZetaNull", "AlphaNull"), gaps, true, now)
        assertEquals(listOf("AlphaNull", "ZetaNull", "Older", "Newer"), data.gapSignals.map { it.name })
    }

    @Test
    fun buildFreshnessIsNullWhenNoTimestampedSignals() {
        val gaps = mapOf("NoTs" to entry(null), "Bare" to JsonPrimitive(1))
        val data = SignalHealthProjection.build(listOf("NoTs", "Bare"), gaps, true, now)
        assertNull(data.freshnessAgeSeconds)
        assertEquals(0, data.activeCount)
        assertEquals(2, data.staleCount)
    }

    @Test
    fun buildResolvedMirrorsWebHasDataTruthiness() {
        assertFalse(SignalHealthProjection.build(null, null, false, now).hasData)
        assertTrue(SignalHealthProjection.build(null, null, true, now).hasData)
        // Web: signals = [] / gapData = {} are truthy ⇒ hasData true even when empty.
        assertTrue(SignalHealthProjection.build(emptyList(), null, false, now).hasData)
        assertTrue(SignalHealthProjection.build(null, emptyMap(), false, now).hasData)
        assertEquals(SignalHealthData.EMPTY.healthLevel, SignalHealthLevel.Unknown)
        assertFalse(SignalHealthData.EMPTY.hasData)
    }

    // ── healthLevel thresholds (web healthLevel memo) ─────────────────────────────

    @Test
    fun healthLevelMatchesWebThresholds() {
        assertEquals(SignalHealthLevel.Unknown, SignalHealthProjection.healthLevelOf(0, 0))
        assertEquals(SignalHealthLevel.Healthy, SignalHealthProjection.healthLevelOf(10, 0))
        assertEquals(SignalHealthLevel.Degraded, SignalHealthProjection.healthLevelOf(8, 2))
        assertEquals(SignalHealthLevel.Critical, SignalHealthProjection.healthLevelOf(5, 5))
        assertEquals(SignalHealthLevel.Critical, SignalHealthProjection.healthLevelOf(2, 8))
        assertEquals(SignalHealthLevel.Critical, SignalHealthProjection.healthLevelOf(0, 1))
    }

    // ── Timestamp parsing + extraction ────────────────────────────────────────────

    @Test
    fun parseTimestampToleratesZoneVariantsAndRejectsGarbage() {
        val expected = 1_704_067_200_000L
        assertEquals(expected, SignalHealthProjection.parseTimestampMillis("2024-01-01T00:00:00Z"))
        assertEquals(expected, SignalHealthProjection.parseTimestampMillis("2024-01-01T00:00:00+00:00"))
        assertEquals(expected, SignalHealthProjection.parseTimestampMillis("2024-01-01T00:00:00"))
        assertNull(SignalHealthProjection.parseTimestampMillis(""))
        assertNull(SignalHealthProjection.parseTimestampMillis("   "))
        assertNull(SignalHealthProjection.parseTimestampMillis("not-a-timestamp"))
        assertNull(SignalHealthProjection.parseTimestampMillis(null))
    }

    @Test
    fun liveEntryMillisHandlesObjectScalarAndNonStringTimestamp() {
        assertEquals(1_704_067_200_000L, SignalHealthProjection.liveEntryMillis(entry("2024-01-01T00:00:00Z")))
        assertNull(SignalHealthProjection.liveEntryMillis(entry(null)))
        assertNull(SignalHealthProjection.liveEntryMillis(JsonPrimitive(5.0)))
        assertNull(SignalHealthProjection.liveEntryMillis(buildJsonObject { put("timestamp", 42) }))
        assertNull(SignalHealthProjection.liveEntryMillis(null))
    }

    // ── Freshness-age buckets (web formatAge) ─────────────────────────────────────

    @Test
    fun freshnessAgeBucketsLikeWebFormatAge() {
        assertEquals(SignalAge.Unknown, signalFreshnessAge(null))
        assertEquals(SignalAge.Seconds(30), signalFreshnessAge(30))
        assertEquals(SignalAge.Seconds(59), signalFreshnessAge(59))
        assertEquals(SignalAge.Minutes(1), signalFreshnessAge(90))
        assertEquals(SignalAge.Minutes(59), signalFreshnessAge(3599))
        assertEquals(SignalAge.Hours(1), signalFreshnessAge(3600))
        assertEquals(SignalAge.Hours(2), signalFreshnessAge(7200))
    }

    // ── Relative gap-row buckets (web formatRelative) ─────────────────────────────

    @Test
    fun relativeAgeBucketsLikeWebFormatRelative() {
        assertEquals(SignalRelative.Unknown, signalRelativeAge(null, now))
        assertEquals(SignalRelative.JustNow, signalRelativeAge(now - 30_000L, now))
        assertEquals(SignalRelative.Minutes(1), signalRelativeAge(now - 60_000L, now))
        assertEquals(SignalRelative.Minutes(5), signalRelativeAge(now - 5L * 60_000L, now))
        assertEquals(SignalRelative.Hours(2), signalRelativeAge(now - 2L * 3_600_000L, now))
        assertEquals(SignalRelative.Days(3), signalRelativeAge(now - 3L * 86_400_000L, now))
        assertEquals(SignalRelative.Absolute(now - 8L * 86_400_000L), signalRelativeAge(now - 8L * 86_400_000L, now))
    }

    // ── Status badge + error-kind mapping ─────────────────────────────────────────

    @Test
    fun badgeVariantMapsHealthLevel() {
        assertEquals(BadgeVariant.Success, signalHealthBadgeVariant(SignalHealthLevel.Healthy))
        assertEquals(BadgeVariant.Warning, signalHealthBadgeVariant(SignalHealthLevel.Degraded))
        assertEquals(BadgeVariant.Danger, signalHealthBadgeVariant(SignalHealthLevel.Critical))
        assertEquals(BadgeVariant.Neutral, signalHealthBadgeVariant(SignalHealthLevel.Unknown))
    }

    @Test
    fun errorKindMapsConnectivityAndHttpStatus() {
        assertEquals(QueryErrorKind.Offline, signalHealthErrorKind(ErrorKind.Network, null))
        assertEquals(QueryErrorKind.Offline, signalHealthErrorKind(ErrorKind.Timeout, null))
        assertEquals(QueryErrorKind.Waiting, signalHealthErrorKind(ErrorKind.CircuitOpen, null))
        assertEquals(QueryErrorKind.NotFound, signalHealthErrorKind(ErrorKind.Http, HTTP_NOT_FOUND))
        assertEquals(QueryErrorKind.Unauthorized, signalHealthErrorKind(ErrorKind.Http, HTTP_UNAUTHORIZED))
        assertEquals(QueryErrorKind.ServerError, signalHealthErrorKind(ErrorKind.Http, HTTP_SERVER_ERROR))
        assertEquals(QueryErrorKind.Network, signalHealthErrorKind(ErrorKind.Unknown, null))
    }

    @Test
    fun formatCountAppliesLocaleGrouping() {
        assertEquals("1,284", SignalHealthProjection.formatCount(1284, locale))
        assertEquals("0", SignalHealthProjection.formatCount(0, locale))
    }

    // ── Registry + footprint constraints ──────────────────────────────────────────

    @Test
    fun registrationMetadataMatchesWebRegistry() {
        assertEquals("signal-health", SignalHealthRegistration.ID)
        assertEquals("telemetry", SignalHealthRegistration.CATEGORY)
        assertEquals("SignalHealthWidget", SignalHealthRegistration.SLUG)
        assertEquals(5L * 60L * 1000L, SignalHealthRegistration.STALE_THRESHOLD_MS)
        assertEquals(SignalHealthSize(2, 4), SignalHealthRegistration.DEFAULT_SIZE)
        assertEquals(SignalHealthSize(1, 2), SignalHealthRegistration.MIN_SIZE)
        assertEquals(SignalHealthSize(4, 40), SignalHealthRegistration.MAX_SIZE)
    }

    @Test
    fun registrationBoundsAndClampHonourTheFootprint() {
        assertTrue(SignalHealthRegistration.isWithinBounds(SignalHealthSize(2, 4)))
        assertFalse(SignalHealthRegistration.isWithinBounds(SignalHealthSize(0, 4)))
        assertFalse(SignalHealthRegistration.isWithinBounds(SignalHealthSize(2, 41)))
        assertEquals(SignalHealthSize(1, 2), SignalHealthRegistration.clamp(SignalHealthSize(0, 0)))
        assertEquals(SignalHealthSize(4, 40), SignalHealthRegistration.clamp(SignalHealthSize(9, 99)))
    }

    @Test
    fun sizeDerivesCompactAndWide() {
        assertTrue(SignalHealthSize(1, 2).isCompact)
        assertFalse(SignalHealthSize(2, 4).isCompact)
        assertTrue(SignalHealthSize(3, 4).isWide)
        assertTrue(SignalHealthSize(4, 6).isWide)
        assertFalse(SignalHealthSize(2, 4).isWide)
    }

    private companion object {
        const val HTTP_NOT_FOUND = 404
        const val HTTP_UNAUTHORIZED = 401
        const val HTTP_SERVER_ERROR = 500
    }
}
