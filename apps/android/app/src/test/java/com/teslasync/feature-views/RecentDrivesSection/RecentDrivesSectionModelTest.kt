// Off-device unit coverage for the RecentDrivesSection feature view's pure model (P3 acceptance: adapter +
// per-state + a11y-label tests). Exercises the settings -> display-prefs adapter (distance unit, locale,
// precision — the web `useUnits` + `fmtNumber` `_globalPrecision` derivation), the per-column projection (the
// web `formatDateTime` date, `fmtNumber(convertDistanceFromSI(...))` distance, `durationStr(duration_s / 60)`
// duration with its half-away-from-zero residual rounding, and the `start% → end%` battery range), the
// tolerant timestamp formatter, the lifecycle classifier the composable switches on (per-state coverage), the
// merged per-row accessibility announcement (a11y-label coverage), and the PII-safe `view.opened` diagnostic.
// No Compose / Android / HTTP — runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.recentdrivessection

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneOffset
import java.util.Locale

class RecentDrivesSectionModelTest {
    private val metric = RecentDrivesDisplayPrefs.from(UnitPreferences.fromSettings(null))
    private val imperial =
        RecentDrivesDisplayPrefs.from(UnitPreferences.fromSettings(Json.parseToJsonElement("""{"unit_of_length":"mi"}""")))
    private val onePlace =
        RecentDrivesDisplayPrefs.from(UnitPreferences.fromSettings(Json.parseToJsonElement("""{"decimal_precision":1}""")))

    private val strings =
        RecentDrivesStrings(
            title = "Recent Drives",
            viewAll = "View all",
            date = "Date",
            distance = "Distance",
            duration = "Duration",
            battery = "Battery",
            empty = "No drives recorded yet",
        )

    // A clean drive: 12 km in 3900 s (65 min -> 1h 5m), 80% -> 60%.
    private val drive =
        RecentDrive(
            id = 7L,
            startTs = "2026-06-11T14:30:00Z",
            distanceM = 12_000.0,
            durationS = 3_900.0,
            startSocPct = 80.0,
            endSocPct = 60.0,
        )

    private fun rows(
        drives: List<RecentDrive>,
        prefs: RecentDrivesDisplayPrefs,
    ) = RecentDrivesProjection.rows(drives, prefs, strings, formatDate = { "DATE[$it]" })

    private fun firstRow(
        drives: List<RecentDrive>,
        prefs: RecentDrivesDisplayPrefs,
    ) = rows(drives, prefs).first()

    // ── Settings -> display-prefs adapter (web `useUnits` + `fmtNumber` global precision) ────────

    @Test
    fun defaultPrefsAreMetricEnUsPrecisionTwo() {
        assertEquals(DistanceUnitPref.KM, metric.prefs.distance)
        assertEquals("en-US", metric.locale.toLanguageTag())
        // The web `fmtNumber` `_globalPrecision` defaults to 2, NOT the shared formatDistance per-quantity 1.
        assertEquals(WEB_DEFAULT_PRECISION, metric.precision)
        assertEquals(2, metric.precision)
    }

    @Test
    fun imperialSettingsSelectMiles() {
        assertEquals(DistanceUnitPref.MI, imperial.prefs.distance)
    }

    @Test
    fun decimalPrecisionSettingOverridesTheDefault() {
        assertEquals(1, onePlace.precision)
    }

    // ── Distance column (web `fmtNumber(convertDistanceFromSI(distance_m, distanceUnit))` + unit) ──

    @Test
    fun distanceConvertsAndFormatsForMetricAtPrecisionTwo() {
        assertEquals("12.00 km", firstRow(listOf(drive), metric).distanceText)
    }

    @Test
    fun distanceHonorsTheDecimalPrecisionSetting() {
        assertEquals("12.0 km", firstRow(listOf(drive), onePlace).distanceText)
    }

    @Test
    fun distanceConvertsThroughTheImperialBoundary() {
        // 12000 m / 1609.344 = 7.4565 mi -> 2 dp "7.46".
        assertEquals("7.46 mi", firstRow(listOf(drive), imperial).distanceText)
    }

    @Test
    fun distanceRoundsHalfAwayFromZeroLikeIntlNumberFormat() {
        // 6437 m -> 6.437 km -> 2 dp "6.44".
        val d = drive.copy(distanceM = 6_437.0)
        assertEquals("6.44 km", RecentDrivesProjection.distanceText(d.distanceM, metric))
    }

    @Test
    fun nonFiniteDistanceCoercesToZero() {
        assertEquals("0.00 km", RecentDrivesProjection.distanceText(Double.NaN, metric))
    }

    // ── Duration column (web `durationStr(duration_s / 60)`) ─────────────────────────────────────

    @Test
    fun durationRendersHoursAndMinutes() {
        assertEquals("1h 5m", firstRow(listOf(drive), metric).durationText)
    }

    @Test
    fun durationSubHourOmitsTheHourSegment() {
        assertEquals("30m", RecentDrivesProjection.durationStr(1_800.0 / 60.0, Locale.US))
    }

    @Test
    fun durationResidualMinutesRoundHalfAwayFromZero() {
        // 3690 s -> 61.5 min -> floor(61.5/60)=1h, fmtInt(61.5%60)=fmtInt(1.5)=2 -> "1h 2m".
        assertEquals("1h 2m", RecentDrivesProjection.durationStr(3_690.0 / 60.0, Locale.US))
        // 150 s -> 2.5 min -> fmtInt(2.5)=3 (halfExpand, not banker's rounding) -> "3m".
        assertEquals("3m", RecentDrivesProjection.durationStr(150.0 / 60.0, Locale.US))
    }

    @Test
    fun durationZeroIsZeroMinutes() {
        assertEquals("0m", RecentDrivesProjection.durationStr(0.0, Locale.US))
    }

    // ── Battery column (web `start% → end%` / `—`) ───────────────────────────────────────────────

    @Test
    fun batteryRendersTheSocRangeWhenBothEndpointsArePresent() {
        assertEquals("80% \u2192 60%", firstRow(listOf(drive), metric).batteryText)
    }

    @Test
    fun batteryIsTheEmDashWhenEitherEndpointIsAbsent() {
        assertEquals(EM_DASH, RecentDrivesProjection.batteryText(80.0, null))
        assertEquals(EM_DASH, RecentDrivesProjection.batteryText(null, 60.0))
    }

    @Test
    fun batteryRendersWholeAndFractionalPercentsLikeJsNumberToString() {
        assertEquals("82% \u2192 64%", RecentDrivesProjection.batteryText(82.0, 64.0))
        assertEquals("80.5% \u2192 60%", RecentDrivesProjection.batteryText(80.5, 60.0))
    }

    // ── Date column (web `formatDateTime(start_ts)`) ─────────────────────────────────────────────

    @Test
    fun timeFormattingRendersALocalizedDateTimeInTheGivenZone() {
        val text = RecentDrivesTimeFormatting.format("2026-06-11T14:30:00Z", ZoneOffset.UTC, Locale.US)
        assertNotEquals(EM_DASH, text)
        // Robust across JDK locale-data versions: the year and the minute always appear.
        assertTrue(text, text.contains("2026"))
        assertTrue(text, text.contains("30"))
    }

    @Test
    fun timeFormattingFallsBackToEmDashForBlankOrUnparseableInput() {
        assertEquals(EM_DASH, RecentDrivesTimeFormatting.format("", ZoneOffset.UTC, Locale.US))
        assertEquals(EM_DASH, RecentDrivesTimeFormatting.format("   ", ZoneOffset.UTC, Locale.US))
        assertEquals(EM_DASH, RecentDrivesTimeFormatting.format("not-a-date", ZoneOffset.UTC, Locale.US))
    }

    @Test
    fun timeFormattingAcceptsAnOffsetDateTimeAndAZonelessLocalDateTime() {
        assertNotEquals(EM_DASH, RecentDrivesTimeFormatting.format("2026-06-11T14:30:00+02:00", ZoneOffset.UTC, Locale.US))
        assertNotEquals(EM_DASH, RecentDrivesTimeFormatting.format("2026-06-11T14:30:00", ZoneOffset.UTC, Locale.US))
    }

    // ── Lifecycle surface classifier (per-state) ─────────────────────────────────────────────────

    @Test
    fun projectUiStateCoversLoadingContentAndEmpty() {
        assertEquals(UiPhase.Loading, projectUiState(listOf(drive), loading = true).phase)
        // Web `drives && drives.length > 0` -> empty for both a null prop and an empty list.
        assertEquals(UiPhase.Empty, projectUiState(null, loading = false).phase)
        assertEquals(UiPhase.Empty, projectUiState(emptyList(), loading = false).phase)
        val content = projectUiState(listOf(drive), loading = false)
        assertEquals(UiPhase.Content, content.phase)
        assertEquals(listOf(drive), content.data)
    }

    @Test
    fun offlineCachedStateStaysContentAndStillProjectsRows() {
        val offline =
            UiState(
                phase = UiPhase.Content,
                data = listOf(drive),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            )
        assertFalse(offline.isLoading)
        assertFalse(offline.isError)
        assertTrue(offline.isOffline)
        assertTrue(offline.canRetry)
        assertEquals(1, rows(offline.data!!, metric).size)
    }

    // ── i18n / a11y announcement (merged TalkBack row summary) ───────────────────────────────────

    @Test
    fun rowAnnouncementComposesTheSuppliedI18nLabelsAndValues() {
        val announce = firstRow(listOf(drive), metric).announce
        assertTrue(announce, announce.contains("Date, DATE[2026-06-11T14:30:00Z]"))
        assertTrue(announce, announce.contains("Distance, 12.00 km"))
        assertTrue(announce, announce.contains("Duration, 1h 5m"))
        assertTrue(announce, announce.contains("Battery, 80% \u2192 60%"))
    }

    @Test
    fun projectionMapsEveryDriveToARowPreservingOrder() {
        val second = drive.copy(id = 8L, distanceM = 6_437.0)
        val projected = rows(listOf(drive, second), metric)
        assertEquals(2, projected.size)
        assertEquals(7L, projected[0].id)
        assertEquals(8L, projected[1].id)
        assertEquals("6.44 km", projected[1].distanceText)
    }

    // ── Diagnostics (P1/S11 `view.opened`) ───────────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeEventWithSurfaceSlug() {
        val logger = RecordingLogger()
        recordRecentDrivesSectionOpened(logger)
        assertEquals(1, logger.records.size)
        val record = logger.records.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals("view.opened", record.event)
        assertEquals(mapOf("surface" to "RecentDrivesSection"), record.fields)
        assertEquals("RecentDrivesSection", RecentDrivesSectionRegistration.SLUG)
    }

    /** A recording [Logger] capturing emitted records for the diagnostics assertion. */
    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }
}
