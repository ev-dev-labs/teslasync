package io.teslasync.android.featureviews.journeydetailspanel

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
 * Off-device verification of the JourneyDetailsPanel's pure logic — the native analogue of everything the web
 * component derives from its props (web/src/features/driving/components/drive-detail/JourneyDetailsPanel.tsx): the
 * address-vs-coordinate-vs-fallback location (web `address ? … : (lat && lon) ? coords : fallback`), the JS-truthy
 * coordinate guard + sign/abs asymmetry, the battery `?? '?'` placeholder, the timezone-aware localized datetime +
 * em-dash fallback (web `@/lib/dateFormat`), the live-destination time/fallback selection, the empty predicate, and
 * the PII-safe `view.opened` diagnostic. Runs in the `:app:testReleaseUnitTest` gate; the Compose render + a11y are
 * covered by the on-device JourneyDetailsPanelUiTest.
 */
class JourneyDetailsPanelProjectionTest {
    private val zone: ZoneId = ZoneId.of("America/Los_Angeles")
    private val locale: Locale = Locale.US

    private val base =
        JourneyDetailsData(
            startAddress = null,
            endAddress = null,
            startLat = null,
            startLon = null,
            endLat = null,
            endLon = null,
            startBatteryPct = 87.0,
            endBatteryPct = 64.0,
            startTsIso = "2026-01-15T18:30:00Z",
            endTsIso = "2026-01-15T19:42:00Z",
        )

    // ── Location: address vs coordinates vs fallback (web `address ? … : (lat && lon) ? coords : null`) ──

    @Test
    fun locationPrefersANonEmptyAddressAsPlainText() {
        val location = JourneyDetailsPanelProjection.location("Cupertino, CA", 37.33, -122.03, locale)
        assertEquals("Cupertino, CA", location?.text)
        assertFalse("an address is not monospace", location?.monospace ?: true)
    }

    @Test
    fun locationFallsThroughAnEmptyAddressToCoordinates() {
        val location = JourneyDetailsPanelProjection.location("", 37.33, -122.03, locale)
        assertEquals("37.33°N, 122.03°W", location?.text)
        assertTrue("coordinates render monospace", location?.monospace ?: false)
    }

    @Test
    fun locationIsNullWhenNeitherAddressNorCoordinatesExist() {
        assertNull(JourneyDetailsPanelProjection.location(null, null, null, locale))
    }

    // ── Coordinate formatting (web `{fmtNumber(lat)}°N/S, {fmtNumber(|lon|)}°E/W`) ───────────────────────

    @Test
    fun coordinatesFormatNorthWestWithTwoFractionDigits() {
        assertEquals("37.33°N, 122.03°W", JourneyDetailsPanelProjection.coordinates(37.33, -122.03, locale))
    }

    @Test
    fun coordinatesKeepTheLatitudeSignButAbsoluteTheLongitude() {
        // Web abs()-es only the longitude; the latitude keeps its sign, so a southern latitude reads "-33.86°S".
        assertEquals("-33.86°S, 151.20°E", JourneyDetailsPanelProjection.coordinates(-33.86, 151.20, locale))
    }

    @Test
    fun coordinatesAreNullForZeroOrNullOrNonFiniteValues() {
        assertNull("zero latitude is JS-falsy", JourneyDetailsPanelProjection.coordinates(0.0, 5.0, locale))
        assertNull("zero longitude is JS-falsy", JourneyDetailsPanelProjection.coordinates(5.0, 0.0, locale))
        assertNull(JourneyDetailsPanelProjection.coordinates(null, 5.0, locale))
        assertNull(JourneyDetailsPanelProjection.coordinates(5.0, null, locale))
        assertNull(JourneyDetailsPanelProjection.coordinates(Double.NaN, 5.0, locale))
    }

    // ── Battery (web `{batteryPct ?? '?'}`) ──────────────────────────────────────────────────────────────

    @Test
    fun batteryRendersAWholeNumberWithoutAFractionalPart() {
        assertEquals("87", JourneyDetailsPanelProjection.battery(87.0))
        assertEquals("0", JourneyDetailsPanelProjection.battery(0.0))
    }

    @Test
    fun batteryPreservesAFractionalPercent() {
        assertEquals("87.5", JourneyDetailsPanelProjection.battery(87.5))
    }

    @Test
    fun batteryIsTheQuestionMarkPlaceholderForNullOrNonFinite() {
        assertEquals(JourneyDetailsPanelProjection.UNKNOWN_BATTERY, JourneyDetailsPanelProjection.battery(null))
        assertEquals(JourneyDetailsPanelProjection.UNKNOWN_BATTERY, JourneyDetailsPanelProjection.battery(Double.NaN))
    }

    // ── Timezone-aware localized formatting (web `@/lib/dateFormat` formatDateTime) ───────────────────────

    @Test
    fun formatDateTimeReturnsLocalizedDateAndTimeOrEmDashFallback() {
        val formatted = JourneyDetailsPanelProjection.formatDateTime("2026-01-15T18:30:00Z", zone, locale)
        assertTrue("carries the localized date: $formatted", formatted.contains("Jan") && formatted.contains("2026"))
        assertTrue("carries the PST time: $formatted", formatted.contains("10:30"))
        assertEquals(JourneyDetailsPanelProjection.FALLBACK, JourneyDetailsPanelProjection.formatDateTime(null, zone, locale))
        assertEquals(JourneyDetailsPanelProjection.FALLBACK, JourneyDetailsPanelProjection.formatDateTime("garbage", zone, locale))
    }

    @Test
    fun formatDateTimeRendersTheTimestampInTheGivenZone() {
        val instant = "2026-01-15T18:30:00Z"
        val losAngeles = JourneyDetailsPanelProjection.formatDateTime(instant, ZoneId.of("America/Los_Angeles"), locale)
        val utc = JourneyDetailsPanelProjection.formatDateTime(instant, ZoneId.of("UTC"), locale)
        assertNotEquals("the same instant must format differently per zone", losAngeles, utc)
        assertTrue(losAngeles.contains("10:30"))
        assertTrue(utc.contains("6:30"))
    }

    // ── Projection: completed vs live drive (web `endTs ? … : t('driveDetail.inProgress')`) ──────────────

    @Test
    fun projectMapsACompletedDriveWithAddresses() {
        val model = JourneyDetailsPanelProjection.project(base.copy(startAddress = "Home", endAddress = "Office"), zone, locale)
        assertEquals("Home", model.start.location?.text)
        assertEquals("Office", model.destination.location?.text)
        assertEquals(LocationFallback.NoAddress, model.destination.locationFallback)
        assertTrue("a completed drive has a destination time", model.destination.timeText?.contains("Jan") ?: false)
        assertEquals("87", model.start.batteryValue)
        assertEquals("64", model.destination.batteryValue)
    }

    @Test
    fun projectLeavesTheDestinationTimeNullAndFallbackInProgressForALiveDrive() {
        val model = JourneyDetailsPanelProjection.project(base.copy(endTsIso = null, endBatteryPct = null), zone, locale)
        assertNull("a live destination renders the in-progress fallback, not a time", model.destination.timeText)
        assertEquals(LocationFallback.InProgress, model.destination.locationFallback)
        assertEquals(JourneyDetailsPanelProjection.UNKNOWN_BATTERY, model.destination.batteryValue)
    }

    @Test
    fun projectAlwaysGivesTheStartATimeEvenWhenAbsent() {
        val startTime = JourneyDetailsPanelProjection.project(base, zone, locale).start.timeText
        assertTrue(startTime!!.contains("Jan"))
        assertEquals(
            JourneyDetailsPanelProjection.FALLBACK,
            JourneyDetailsPanelProjection.project(base.copy(startTsIso = null), zone, locale).start.timeText,
        )
        assertEquals(
            LocationFallback.NoAddress,
            JourneyDetailsPanelProjection.project(base, zone, locale).start.locationFallback,
        )
    }

    @Test
    fun projectResolvesCoordinatesWhenNoAddressIsPresent() {
        val model = JourneyDetailsPanelProjection.project(base.copy(startLat = 37.33, startLon = -122.03), zone, locale)
        assertEquals("37.33°N, 122.03°W", model.start.location?.text)
        assertTrue(model.start.location?.monospace ?: false)
    }

    // ── Empty predicate (never-a-blank-box contract) ─────────────────────────────────────────────────────

    @Test
    fun modelIsNotEmptyForAPopulatedDrive() {
        assertFalse(JourneyDetailsPanelProjection.project(base.copy(startAddress = "Home"), zone, locale).isEmpty)
    }

    @Test
    fun modelIsEmptyOnlyForAFullyDegenerateDrive() {
        val model =
            JourneyDetailsPanelProjection.project(
                base.copy(startBatteryPct = null, endBatteryPct = null, startTsIso = null, endTsIso = null),
                zone,
                locale,
            )
        assertTrue(model.isEmpty)
        assertTrue(model.start.isEmpty)
        assertTrue(model.destination.isEmpty)
    }

    // ── Diagnostics: PII-safe view.opened (P1/S11) ───────────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        JourneyDetailsPanelDiagnostics.recordViewOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "JourneyDetailsPanel"), fields)
    }

    @Test
    fun diagnosticsSlugAndIdAreStable() {
        assertEquals("JourneyDetailsPanel", JourneyDetailsPanelDiagnostics.SLUG)
        assertEquals("journey-details-panel", JourneyDetailsPanelDiagnostics.ID)
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
