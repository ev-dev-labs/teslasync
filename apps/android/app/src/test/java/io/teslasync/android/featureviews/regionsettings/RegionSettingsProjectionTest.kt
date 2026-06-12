package io.teslasync.android.featureviews.regionsettings

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.user.TeslaConfigEnvelope
import io.teslasync.shared.core.presentation.user.TeslaRegionData
import io.teslasync.shared.core.presentation.user.TeslaRegionEnvelope
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.util.Locale

/**
 * Off-device verification of the RegionSettings' pure logic — the native analogue of the web component's
 * inline derivations (web/src/features/settings/components/RegionSettings.tsx): the "has a region" empty
 * guard (web `regionConfig?.data?.region`), the "ever fetched" guard (web `fetched_at` truthiness), the
 * base-URL fallback (web `fleet_api_base_url ?? '—'`), the localized "Synced" stamp (web `formatDateTime`),
 * and the PII-safe `view.opened` diagnostic. Runs in the :android:testReleaseUnitTest gate.
 */
class RegionSettingsProjectionTest {
    private val zoneUtc: ZoneId = ZoneId.of("UTC")

    private fun envelope(
        region: String = "North America",
        fleetApiBaseUrl: String = "https://fleet-api.prd.na.vn.cloud.tesla.com",
        fetchedAt: String? = "2026-06-12T14:30:00Z",
    ): TeslaRegionEnvelope =
        TeslaConfigEnvelope(
            data = TeslaRegionData(region = region, fleetApiBaseUrl = fleetApiBaseUrl),
            fetchedAt = fetchedAt,
        )

    // ── Empty guard (web !regionConfig?.data?.region) ───────────────────────────────

    @Test
    fun isEmptyIsTrueForNullEnvelopeOrBlankRegion() {
        assertTrue(RegionSettingsProjection.isEmpty(null))
        assertTrue(RegionSettingsProjection.isEmpty(envelope(region = "")))
        assertTrue(RegionSettingsProjection.isEmpty(envelope(region = "   ")))
    }

    @Test
    fun isEmptyIsFalseWhenRegionPresent() {
        assertFalse(RegionSettingsProjection.isEmpty(envelope(region = "eu", fetchedAt = null)))
    }

    // ── Fetched guard (web regionConfig?.fetched_at) ────────────────────────────────

    @Test
    fun hasFetchedReflectsTheEnvelope() {
        assertFalse(RegionSettingsProjection.hasFetched(null))
        assertFalse(RegionSettingsProjection.hasFetched(envelope(fetchedAt = null)))
        assertFalse(RegionSettingsProjection.hasFetched(envelope(fetchedAt = "")))
        assertTrue(RegionSettingsProjection.hasFetched(envelope(fetchedAt = "2026-06-12T14:30:00Z")))
    }

    // ── Region projection (web data.region + fleet_api_base_url ?? '—') ─────────────

    @Test
    fun regionViewMapsRenderReadyFields() {
        val view = RegionSettingsProjection.regionView(envelope(region = "North America"))

        assertEquals("North America", view?.region)
        assertEquals("https://fleet-api.prd.na.vn.cloud.tesla.com", view?.fleetApiUrl)
    }

    @Test
    fun regionViewFallsBackToEmDashForBlankUrl() {
        val view = RegionSettingsProjection.regionView(envelope(region = "cn", fleetApiBaseUrl = ""))

        assertEquals("cn", view?.region)
        assertEquals(EM_DASH, view?.fleetApiUrl)
    }

    @Test
    fun regionViewIsNullWhenNoRegion() {
        assertNull(RegionSettingsProjection.regionView(null))
        assertNull(RegionSettingsProjection.regionView(envelope(region = "")))
        assertNull(RegionSettingsProjection.regionView(envelope(region = "  ")))
    }

    // ── Synced stamp (web formatDateTime) ───────────────────────────────────────────

    @Test
    fun formatSyncedRendersLocalizedDateTimeForValidIso() {
        val formatted = RegionSettingsProjection.formatSynced("2026-06-12T14:30:00Z", zoneUtc, Locale.US)
        assertTrue("expected a real date, got '$formatted'", formatted != EM_DASH)
        assertTrue("expected the year, got '$formatted'", formatted.contains("2026"))
        assertTrue("expected the short month, got '$formatted'", formatted.contains("Jun"))
    }

    @Test
    fun formatSyncedAcceptsAnOffsetTimestamp() {
        val formatted = RegionSettingsProjection.formatSynced("2026-06-12T16:30:00+02:00", zoneUtc, Locale.US)
        assertTrue("expected a real date, got '$formatted'", formatted != EM_DASH)
        assertTrue("expected the year, got '$formatted'", formatted.contains("2026"))
    }

    @Test
    fun formatSyncedReturnsEmDashForNullBlankOrUnparseable() {
        assertEquals(EM_DASH, RegionSettingsProjection.formatSynced(null, zoneUtc, Locale.US))
        assertEquals(EM_DASH, RegionSettingsProjection.formatSynced("", zoneUtc, Locale.US))
        assertEquals(EM_DASH, RegionSettingsProjection.formatSynced("nonsense", zoneUtc, Locale.US))
    }

    // ── Diagnostics (P1/S11 view.opened contract) ──────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordRegionSettingsOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "RegionSettings"), fields)
    }

    @Test
    fun registrationExposesStableIdAndSlug() {
        assertEquals("region-settings", RegionSettingsRegistration.ID)
        assertEquals("RegionSettings", RegionSettingsRegistration.SLUG)
    }

    private data class Record(
        val level: LogLevel,
        val event: String,
        val fields: Map<String, String>,
    )

    private class RecordingLogger : Logger {
        val records = mutableListOf<Record>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Record(level, event, fields)
        }
    }
}
