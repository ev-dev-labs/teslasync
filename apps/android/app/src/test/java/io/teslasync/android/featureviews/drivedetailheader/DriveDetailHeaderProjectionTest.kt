package io.teslasync.android.featureviews.drivedetailheader

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.util.Locale

/**
 * Off-device verification of the DriveDetailHeader's pure logic — the native analogue of everything the web
 * component derives from its props (web/src/features/driving/components/drive-detail/DriveDetailHeader.tsx): the
 * route-vs-fallback title (web `startAddress && endAddress ? "{start} → {end}" : t('driveDetail.title')`), the
 * assembled subtitle ("vehicleName · date · time TZ [→ endTime]" in the vehicle zone), the timezone-aware
 * localized date/time formatting + em-dash fallback (web `@/lib/dateFormat`), the empty predicate, and the
 * PII-safe `view.opened` diagnostic. Runs in the `:app:testReleaseUnitTest` gate; the Compose render + a11y are
 * covered by the on-device DriveDetailHeaderUiTest.
 */
class DriveDetailHeaderProjectionTest {
    private val zone: ZoneId = ZoneId.of("America/Los_Angeles")
    private val locale: Locale = Locale.US

    private fun data(
        vehicleName: String = "Model 3",
        startAddress: String? = null,
        endAddress: String? = null,
        startTsIso: String? = "2026-01-15T18:30:00Z",
        endTsIso: String? = null,
    ): DriveHeaderData =
        DriveHeaderData(
            driveId = "1024",
            vehicleName = vehicleName,
            startAddress = startAddress,
            endAddress = endAddress,
            startTsIso = startTsIso,
            endTsIso = endTsIso,
        )

    // ── Title: route vs localized fallback (web `start && end ? … : t('driveDetail.title')`) ──────────

    @Test
    fun routeTitleJoinsBothAddressesWithArrow() {
        assertEquals("Cupertino, CA → San Francisco, CA", DriveDetailHeaderProjection.routeTitle("Cupertino, CA", "San Francisco, CA"))
    }

    @Test
    fun routeTitleTrimsEachEndpoint() {
        assertEquals("A → B", DriveDetailHeaderProjection.routeTitle("  A  ", "  B  "))
    }

    @Test
    fun routeTitleIsNullWhenEitherAddressIsMissingOrBlank() {
        assertNull(DriveDetailHeaderProjection.routeTitle("Start only", null))
        assertNull(DriveDetailHeaderProjection.routeTitle(null, "End only"))
        assertNull(DriveDetailHeaderProjection.routeTitle(null, null))
        assertNull(DriveDetailHeaderProjection.routeTitle("   ", "End"))
        assertNull(DriveDetailHeaderProjection.routeTitle("Start", " "))
    }

    @Test
    fun projectExposesRouteTitleWhenBothAddressesPresent() {
        val model = DriveDetailHeaderProjection.project(data(startAddress = "Home", endAddress = "Office"), zone, locale)
        assertEquals("Home → Office", model.routeTitle)
    }

    @Test
    fun projectLeavesRouteTitleNullForAnAddresslessDrive() {
        assertNull(DriveDetailHeaderProjection.project(data(), zone, locale).routeTitle)
    }

    // ── Subtitle composition (web `vehicleName · <date> · <time showTz> [→ <endTime>]`) ───────────────

    @Test
    fun subtitleComposesVehicleDateStartTimeTzAndEndTimeForACompletedDrive() {
        val model = DriveDetailHeaderProjection.project(data(endTsIso = "2026-01-15T19:42:00Z"), zone, locale)
        val subtitle = model.subtitle
        assertTrue("starts with the vehicle name: $subtitle", subtitle.startsWith("Model 3 · "))
        assertTrue("carries the start date: $subtitle", subtitle.contains("Jan") && subtitle.contains("2026"))
        assertTrue("carries the PST start time: $subtitle", subtitle.contains("10:30") && subtitle.contains("PST"))
        assertTrue("carries the end-time arrow + time: $subtitle", subtitle.contains(" → ") && subtitle.contains("11:42"))
    }

    @Test
    fun subtitleOmitsTheEndTimeTailForALiveDrive() {
        val subtitle = DriveDetailHeaderProjection.project(data(endTsIso = null), zone, locale).subtitle
        assertFalse("no end-time arrow when the drive is live: $subtitle", subtitle.contains("→"))
        assertTrue("still carries the start time: $subtitle", subtitle.contains("10:30") && subtitle.contains("PST"))
    }

    @Test
    fun subtitleDropsABlankVehicleNameWithoutADanglingSeparator() {
        val subtitle = DriveDetailHeaderProjection.project(data(vehicleName = ""), zone, locale).subtitle
        assertFalse("no leading separator: $subtitle", subtitle.startsWith(" · ") || subtitle.startsWith("·"))
        assertTrue("still renders the date/time: $subtitle", subtitle.contains("Jan") && subtitle.contains("10:30"))
    }

    @Test
    fun subtitleRendersEmDashFallbackForAPresentButUnparseableTimestamp() {
        val subtitle = DriveDetailHeaderProjection.project(data(startTsIso = "not-a-date"), zone, locale).subtitle
        assertEquals("Model 3 · ${DriveDetailHeaderProjection.FALLBACK} · ${DriveDetailHeaderProjection.FALLBACK}", subtitle)
    }

    @Test
    fun subtitleOmitsDateAndTimeWhenTheStartTimestampIsAbsent() {
        val subtitle = DriveDetailHeaderProjection.project(data(startTsIso = null), zone, locale).subtitle
        assertEquals("Model 3", subtitle)
    }

    // ── Timezone-aware localized formatting (web `@/lib/dateFormat`) ──────────────────────────────────

    @Test
    fun formatDateReturnsTheLocalizedDateOrEmDashFallback() {
        assertTrue(DriveDetailHeaderProjection.formatDate("2026-01-15T18:30:00Z", zone, locale).contains("2026"))
        assertEquals(DriveDetailHeaderProjection.FALLBACK, DriveDetailHeaderProjection.formatDate(null, zone, locale))
        assertEquals(DriveDetailHeaderProjection.FALLBACK, DriveDetailHeaderProjection.formatDate("garbage", zone, locale))
    }

    @Test
    fun formatTimeReturnsTheLocalizedTimeOrEmDashFallback() {
        assertTrue(DriveDetailHeaderProjection.formatTime("2026-01-15T18:30:00Z", zone, locale).contains("10:30"))
        assertEquals(DriveDetailHeaderProjection.FALLBACK, DriveDetailHeaderProjection.formatTime(null, zone, locale))
        assertEquals(DriveDetailHeaderProjection.FALLBACK, DriveDetailHeaderProjection.formatTime("garbage", zone, locale))
    }

    @Test
    fun formatTimeRendersTheTimestampInTheGivenZone() {
        val instant = "2026-01-15T18:30:00Z"
        val losAngeles = DriveDetailHeaderProjection.formatTime(instant, ZoneId.of("America/Los_Angeles"), locale)
        val utc = DriveDetailHeaderProjection.formatTime(instant, ZoneId.of("UTC"), locale)
        assertNotEquals("the same instant must format differently per zone", losAngeles, utc)
        assertTrue(losAngeles.contains("10:30"))
        assertTrue(utc.contains("6:30"))
    }

    @Test
    fun timeZoneAbbrevIsDaylightAwareAndEmptyForUnparseableInput() {
        assertEquals("PST", DriveDetailHeaderProjection.timeZoneAbbrev("2026-01-15T18:30:00Z", zone, locale))
        assertEquals("PDT", DriveDetailHeaderProjection.timeZoneAbbrev("2026-07-15T18:30:00Z", zone, locale))
        assertEquals("", DriveDetailHeaderProjection.timeZoneAbbrev(null, zone, locale))
        assertEquals("", DriveDetailHeaderProjection.timeZoneAbbrev("garbage", zone, locale))
    }

    // ── Empty predicate (never-a-blank-box contract) ─────────────────────────────────────────────────

    @Test
    fun modelIsNotEmptyForAPopulatedDrive() {
        assertFalse(DriveDetailHeaderProjection.project(data(), zone, locale).isEmpty)
    }

    @Test
    fun modelIsEmptyOnlyForAFullyDegenerateDrive() {
        val model = DriveDetailHeaderProjection.project(data(vehicleName = "", startTsIso = null, endTsIso = null), zone, locale)
        assertTrue(model.isEmpty)
        assertNull(model.routeTitle)
        assertEquals("", model.subtitle)
    }

    // ── Diagnostics: PII-safe view.opened (P1/S11) ───────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        DriveDetailHeaderDiagnostics.recordViewOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "DriveDetailHeader"), fields)
    }

    @Test
    fun diagnosticsSlugAndIdAreStable() {
        assertEquals("DriveDetailHeader", DriveDetailHeaderDiagnostics.SLUG)
        assertEquals("drive-detail-header", DriveDetailHeaderDiagnostics.ID)
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
