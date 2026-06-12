package io.teslasync.android.featureviews.drivetimeline

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.util.Locale

/**
 * Off-device verification of the DriveTimeline's pure logic — the native mirror of every derivation the web
 * component performs (web/src/features/driving/components/drive-detail/DriveTimeline.tsx + its `./helpers`
 * `formatDuration` and `@/lib/dateFormat` `formatTime`): the `Hh Mm` / `Mm` duration split
 * (`Math.floor(min / 60)` + `Math.round(min % 60)`), the SI seconds → minutes scaling (`duration_s / 60`),
 * the tolerant ISO-8601 → localized short-time rendering with the `'—'` invalid-date guard, and the
 * `drive.endTs ? formatTime(endTs) : t('inProgress')` branch (here surfaced as
 * [DriveTimelineDisplay.inProgress]). Because the surface is purely presentational, each
 * [DriveTimelineDisplay] field is exactly what the thin composable renders, so these assertions double as the
 * per-state "snapshot" of both branches. Runs in the :android:testReleaseUnitTest gate.
 */
class DriveTimelineProjectionTest {
    private val lenientJson = Json { ignoreUnknownKeys = true }

    private val utc = ZoneId.of("UTC")

    // ── Duration: web `h > 0 ? '{h}h {m}m' : '{m}m'` over floor/round of the minutes ────────────────

    @Test
    fun durationUnderOneHourOmitsTheHourSegment() {
        assertEquals("0m", DriveTimelineProjection.formatDuration(0.0))
        assertEquals("25m", DriveTimelineProjection.formatDuration(25.0))
        assertEquals("59m", DriveTimelineProjection.formatDuration(59.0))
    }

    @Test
    fun durationOfAnHourOrMoreShowsBothSegments() {
        assertEquals("1h 0m", DriveTimelineProjection.formatDuration(60.0))
        assertEquals("1h 30m", DriveTimelineProjection.formatDuration(90.0))
        assertEquals("2h 5m", DriveTimelineProjection.formatDuration(125.0))
        assertEquals("2h 30m", DriveTimelineProjection.formatDuration(150.0))
    }

    @Test
    fun durationMinutesRoundHalfUpLikeMathRound() {
        // Web `Math.round(min % 60)` rounds ties towards +∞: 0.5 -> 1, 1.5 -> 2, 25.5 -> 26.
        assertEquals("1m", DriveTimelineProjection.formatDuration(0.5))
        assertEquals("2m", DriveTimelineProjection.formatDuration(1.5))
        assertEquals("2m", DriveTimelineProjection.formatDuration(2.4))
        assertEquals("26m", DriveTimelineProjection.formatDuration(25.5))
    }

    @Test
    fun wholeMinuteDurationNeverGainsATrailingDecimal() {
        // JavaScript `${30}` renders "30", not "30.0" — the duration string must match.
        val rendered = DriveTimelineProjection.formatDuration(90.0)
        assertEquals("1h 30m", rendered)
        assertFalse(rendered.contains("."))
    }

    // ── Clock time: tolerant parse + localized short time, '—' on blank/unparseable ─────────────────

    @Test
    fun clockTimeFormatsAValidUtcInstantInTheGivenZone() {
        val rendered = DriveTimelineProjection.formatClockTime("2026-03-14T09:15:00Z", utc, Locale.US)
        assertTrue("expected the UTC wall-clock 9:15 in '$rendered'", rendered.contains("9:15"))
    }

    @Test
    fun clockTimeConvertsToTheRequestedZoneOffset() {
        // 09:15Z rendered at a fixed +05:30 offset is 14:45 local -> "2:45 PM" in a 12-hour locale.
        val rendered = DriveTimelineProjection.formatClockTime("2026-03-14T09:15:00Z", ZoneId.of("+05:30"), Locale.US)
        assertTrue("expected the +05:30 wall-clock 2:45 in '$rendered'", rendered.contains("2:45"))
    }

    @Test
    fun clockTimeHonoursAnExplicitOffsetInTheInput() {
        // Web `new Date('…+02:00')` normalizes to the same instant; at UTC that is 07:15.
        val rendered = DriveTimelineProjection.formatClockTime("2026-03-14T09:15:00+02:00", utc, Locale.US)
        assertTrue("expected the normalized 7:15 in '$rendered'", rendered.contains("7:15"))
    }

    @Test
    fun clockTimeAcceptsAZonelessLocalTimestampAsUtc() {
        val rendered = DriveTimelineProjection.formatClockTime("2026-03-14T09:15:00", utc, Locale.US)
        assertTrue("expected the zoneless 9:15 in '$rendered'", rendered.contains("9:15"))
    }

    @Test
    fun clockTimeFallsBackToAnEmDashForBlankOrUnparseableInput() {
        assertEquals(DRIVE_TIMELINE_EM_DASH, DriveTimelineProjection.formatClockTime("", utc, Locale.US))
        assertEquals(DRIVE_TIMELINE_EM_DASH, DriveTimelineProjection.formatClockTime("   ", utc, Locale.US))
        assertEquals(DRIVE_TIMELINE_EM_DASH, DriveTimelineProjection.formatClockTime("not-a-timestamp", utc, Locale.US))
    }

    // ── Projection: finished (end time) vs in-progress (no end_ts) ──────────────────────────────────

    @Test
    fun finishedDriveProjectsBothTimesAndIsNotInProgress() {
        val drive =
            DriveTimelineDrive(
                startTs = "2026-03-14T09:15:00Z",
                endTs = "2026-03-14T11:45:00Z",
                durationS = 9000,
            )

        val display = DriveTimelineProjection.project(drive, utc, Locale.US)

        assertFalse(display.inProgress)
        assertTrue("expected start 9:15 in '${display.startTime}'", display.startTime.contains("9:15"))
        assertTrue("expected end 11:45 in '${display.endTime}'", display.endTime.contains("11:45"))
        assertEquals("2h 30m", display.duration)
    }

    @Test
    fun driveWithNullEndTsIsInProgressAndHidesTheEndTime() {
        // Web `drive.endTs ? … : t('inProgress')` — a null end_ts is the in-progress branch.
        val drive = DriveTimelineDrive(startTs = "2026-03-14T07:42:00Z", endTs = null, durationS = 720)

        val display = DriveTimelineProjection.project(drive, utc, Locale.US)

        assertTrue(display.inProgress)
        assertEquals(DRIVE_TIMELINE_EM_DASH, display.endTime)
        assertEquals("12m", display.duration)
        assertTrue("expected start 7:42 in '${display.startTime}'", display.startTime.contains("7:42"))
    }

    @Test
    fun driveWithBlankEndTsIsAlsoInProgress() {
        // A blank string is falsy in the web `drive.endTs ?` guard, so it is the in-progress branch too.
        val drive = DriveTimelineDrive(startTs = "2026-03-14T07:42:00Z", endTs = "", durationS = 600)

        val display = DriveTimelineProjection.project(drive, utc, Locale.US)

        assertTrue(display.inProgress)
        assertEquals(DRIVE_TIMELINE_EM_DASH, display.endTime)
    }

    @Test
    fun finishedDriveWithUnparseableEndTsShowsAnEmDashEndTime() {
        // Web calls `formatTime(endTs)` for any present end_ts; an invalid date yields '—', not in-progress.
        val drive =
            DriveTimelineDrive(
                startTs = "2026-03-14T09:15:00Z",
                endTs = "garbage",
                durationS = 3600,
            )

        val display = DriveTimelineProjection.project(drive, utc, Locale.US)

        assertFalse(display.inProgress)
        assertEquals(DRIVE_TIMELINE_EM_DASH, display.endTime)
        assertEquals("1h 0m", display.duration)
    }

    // ── Data adapter: decode the cached snake_case API row (extra columns ignored) and project ──────

    @Test
    fun projectsStraightOffTheCachedApiJsonIgnoringUnknownColumns() {
        val json =
            """
            {
              "start_ts": "2026-07-04T13:00:00Z",
              "end_ts": "2026-07-04T14:30:00Z",
              "duration_s": 5400,
              "distance_m": 42000,
              "score": 88
            }
            """.trimIndent()

        val decoded = lenientJson.decodeFromString<DriveTimelineDrive>(json)

        assertEquals("2026-07-04T13:00:00Z", decoded.startTs)
        assertEquals("2026-07-04T14:30:00Z", decoded.endTs)
        assertEquals(5400L, decoded.durationS)

        val display = DriveTimelineProjection.project(decoded, utc, Locale.US)
        assertFalse(display.inProgress)
        assertEquals("1h 30m", display.duration)
        assertTrue("expected start 1:00 in '${display.startTime}'", display.startTime.contains("1:00"))
        assertTrue("expected end 2:30 in '${display.endTime}'", display.endTime.contains("2:30"))
    }

    @Test
    fun decodesANullEndTsRowAsInProgress() {
        val json = """{ "start_ts": "2026-07-04T13:00:00Z", "end_ts": null, "duration_s": 300 }"""

        val decoded = lenientJson.decodeFromString<DriveTimelineDrive>(json)
        assertEquals(null, decoded.endTs)

        val display = DriveTimelineProjection.project(decoded, utc, Locale.US)
        assertTrue(display.inProgress)
        assertEquals("5m", display.duration)
    }
}
