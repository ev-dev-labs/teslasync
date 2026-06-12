// Off-device unit coverage for the PatternsSlide feature view's pure model (P3 acceptance: adapter +
// per-state + a11y-relevant projection tests). Exercises the `YearReview` patterns-slice parser
// (snake_case, camelCase dual-shape, null/non-object/empty tolerance, partial rows — the web `data` reads),
// the SI → display projection (the web `convertDistanceFromSI` distance, the `KM_PER_MILE` efficiency, the
// `fmtNumber`/`Math.round` formatting, the favorite-day em-dash fallback, and the locale-aware 12-hour clock
// label that backs each card's accessible announcement), the lifecycle classifier the composable switches
// on (per-state coverage incl. offline/stale), and the PII-safe `view.opened` diagnostic. No Compose /
// Android / HTTP — runs in :app:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.patternsslide

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

class PatternsSlideModelTest {
    private val metric = UnitFormatter.default().prefs
    private val imperial =
        UnitFormatter(UnitPreferences.fromSettings(Json.parseToJsonElement("""{"unit_of_length":"mi"}"""))).prefs

    private val fullRow =
        """
        {"most_active_day_of_week":"Saturday","most_active_hour":17,"avg_drives_per_week":5.4,
         "avg_distance_per_drive_km":41.8,"avg_efficiency_wh_km":168.0}
        """.trimIndent()

    private fun parse(json: String) = PatternsSlideData.parse(Json.parseToJsonElement(json))

    // ── Parser (web `data` reads) ───────────────────────────────────────────────

    @Test
    fun parsesSnakeCasePatternsFields() {
        val snapshot = parse(fullRow)
        assertEquals(
            PatternsSnapshot(
                mostActiveDayOfWeek = "Saturday",
                mostActiveHour = 17,
                avgDrivesPerWeek = 5.4,
                avgDistancePerDriveKm = 41.8,
                avgEfficiencyWhKm = 168.0,
            ),
            snapshot,
        )
    }

    @Test
    fun parsesCamelCaseDualShape() {
        val snapshot =
            parse(
                """
                {"mostActiveDayOfWeek":"Monday","mostActiveHour":8,"avgDrivesPerWeek":3.0,
                 "avgDistancePerDriveKm":12.0,"avgEfficiencyWhKm":150.0}
                """.trimIndent(),
            )
        assertEquals("Monday", snapshot?.mostActiveDayOfWeek)
        assertEquals(8, snapshot?.mostActiveHour)
        assertEquals(150.0, snapshot?.avgEfficiencyWhKm)
    }

    @Test
    fun parserTreatsAbsentPayloadAsEmptySurface() {
        assertNull(PatternsSlideData.parse(null))
        assertNull(parse("""[1,2,3]"""))
        assertNull(parse("""{}"""))
    }

    @Test
    fun parserToleratesPartialRowsWithZeroAndEmptyDefaults() {
        val snapshot = parse("""{"most_active_hour":6}""")
        assertEquals(
            PatternsSnapshot(
                mostActiveDayOfWeek = "",
                mostActiveHour = 6,
                avgDrivesPerWeek = 0.0,
                avgDistancePerDriveKm = 0.0,
                avgEfficiencyWhKm = 0.0,
            ),
            snapshot,
        )
    }

    // ── Projection: metric units (web `convertDistanceFromSI` + `fmtNumber`/`Math.round`) ─────

    @Test
    fun projectsMetricDisplayValues() {
        val display = PatternsSlideProjection.project(parse(fullRow)!!, metric, Locale.US)
        assertEquals("Saturday", display.favoriteDay)
        assertEquals("5 PM", display.hourLabel)
        assertEquals("5.4", display.drivesPerWeekValue)
        assertEquals("42", display.distancePerDriveValue)
        assertEquals("km", display.distanceUnitLabel)
        assertEquals("168", display.efficiencyValue)
        assertEquals("Wh/km", display.efficiencyUnit)
    }

    @Test
    fun projectsDistanceAndEfficiencyThroughTheImperialUnitsBoundary() {
        val display = PatternsSlideProjection.project(parse(fullRow)!!, imperial, Locale.US)
        // 41.8 km -> 25.97 mi, rounded to whole miles (web `Math.round(convertDistanceFromSI(...))`).
        assertEquals("26", display.distancePerDriveValue)
        assertEquals("mi", display.distanceUnitLabel)
        // 168 Wh/km * 1.609344 km/mi = 270.37 Wh/mi, rounded (web `avg_efficiency_wh_km * KM_PER_MILE`).
        assertEquals("270", display.efficiencyValue)
        assertEquals("Wh/mi", display.efficiencyUnit)
    }

    @Test
    fun drivesPerWeekUsesGroupedOneDecimalFormattingWhileDistanceStaysPlain() {
        val snapshot =
            PatternsSnapshot(
                mostActiveDayOfWeek = "Tuesday",
                mostActiveHour = 0,
                avgDrivesPerWeek = 1234.5,
                avgDistancePerDriveKm = 1234.0,
                avgEfficiencyWhKm = 0.0,
            )
        val display = PatternsSlideProjection.project(snapshot, metric, Locale.US)
        // Web `fmtNumber(_, 1)` groups thousands; `Math.round(...)` + template literal does NOT.
        assertEquals("1,234.5", display.drivesPerWeekValue)
        assertEquals("1234", display.distancePerDriveValue)
    }

    @Test
    fun blankFavoriteDayFallsBackToEmDash() {
        val snapshot = parse("""{"most_active_day_of_week":"","most_active_hour":9}""")!!
        val display = PatternsSlideProjection.project(snapshot, metric, Locale.US)
        assertEquals("\u2014", display.favoriteDay)
    }

    // ── Projection: locale-aware 12-hour clock label (web `hourLabel`) ───────────

    @Test
    fun hourLabelCoversMidnightMorningNoonAndEvening() {
        assertEquals("12 AM", PatternsSlideProjection.hourLabel(0, Locale.US))
        assertEquals("9 AM", PatternsSlideProjection.hourLabel(9, Locale.US))
        assertEquals("11 AM", PatternsSlideProjection.hourLabel(11, Locale.US))
        assertEquals("12 PM", PatternsSlideProjection.hourLabel(12, Locale.US))
        assertEquals("3 PM", PatternsSlideProjection.hourLabel(15, Locale.US))
        assertEquals("11 PM", PatternsSlideProjection.hourLabel(23, Locale.US))
    }

    // ── Lifecycle: state builder + surface classifier (per-state) ────────────────

    @Test
    fun projectUiStateClassifiesLoadingContentAndEmpty() {
        assertEquals(UiPhase.Loading, PatternsSlideProjection.projectUiState(null, isLoading = true).phase)
        assertEquals(UiPhase.Empty, PatternsSlideProjection.projectUiState(null, isLoading = false).phase)
        val content = PatternsSlideProjection.projectUiState(parse(fullRow), isLoading = false)
        assertEquals(UiPhase.Content, content.phase)
        assertEquals("Saturday", content.data?.mostActiveDayOfWeek)
        // The web-parity overload always projects with isLoading=false; an explicit loading flag wins outright.
        assertEquals(UiPhase.Loading, PatternsSlideProjection.projectUiState(parse(fullRow), isLoading = true).phase)
    }

    @Test
    fun surfaceCoversEveryUiStatePhase() {
        assertEquals(PatternsSlideSurface.Loading, patternsSlideSurface(UiState.loading()))
        assertEquals(
            PatternsSlideSurface.Error,
            patternsSlideSurface(UiState(UiPhase.Error, errorKind = ErrorKind.Network)),
        )
        assertEquals(PatternsSlideSurface.Empty, patternsSlideSurface(UiState(UiPhase.Empty)))
        assertEquals(PatternsSlideSurface.Content, patternsSlideSurface(UiState(UiPhase.Content, data = parse(fullRow))))
    }

    @Test
    fun offlineCachedStateStaysContentAndIsFlaggedStale() {
        val offline =
            UiState(
                phase = UiPhase.Content,
                data = parse(fullRow),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            )
        assertEquals(PatternsSlideSurface.Content, patternsSlideSurface(offline))
        assertTrue(offline.isOffline)
        assertTrue(offline.canRetry)
    }

    // ── Diagnostics (P1/S11 `view.opened`) ───────────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()
        recordPatternsSlideOpened(logger)
        assertEquals(1, logger.records.size)
        val record = logger.records.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals("view.opened", record.event)
        assertEquals(mapOf("surface" to "PatternsSlide"), record.fields)
        assertEquals("PatternsSlide", PATTERNS_SLIDE_SLUG)
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
