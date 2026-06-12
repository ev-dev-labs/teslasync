// Off-device unit coverage for the TitleSlide feature view's pure model (P3 acceptance: adapter + a11y-label +
// telemetry tests). Exercises the decode off the raw `/analytics/year-review` JSON (snake_case + unknown-key
// tolerance, web parity), the projection the composable renders (the locale-grouped year hero label that
// doubles as the TalkBack label, the localized title passthrough, and the em-dash fallback for a blank
// vehicle name), the i18n key mirror, and the `view.opened` diagnostic (P1/S11). No Compose / Android / HTTP —
// runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.titleslide

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

class TitleSlideModelTest {
    private val strings = TitleSlideStrings(title = "Year in Review")

    private fun data(
        year: Int = 2024,
        name: String = "My Model 3",
    ) = TitleSlideData(year = year, vehicle = TitleSlideVehicle(id = 1, displayName = name, model = "model3"))

    // ── project — the adapter (decoded payload → render-ready view) ──

    @Test
    fun projectGroupsTheYearLikeTheWebFmtNumber() {
        // Web `fmtNumber(2024, 0)` → "2,024" (grouped) in en-US; the hero label must match exactly.
        val display = TitleSlideProjection.project(data(year = 2024), strings, Locale.US)
        assertEquals(2024, display.year)
        assertEquals("2,024", display.yearLabel)
        assertEquals("Year in Review", display.title)
        assertEquals("My Model 3", display.vehicleName)
    }

    @Test
    fun projectGroupsTheYearForTheActiveLocale() {
        // German groups thousands with a dot (web parity: the figure follows the active locale).
        val display = TitleSlideProjection.project(data(year = 2024), strings, Locale.GERMANY)
        assertEquals("2.024", display.yearLabel)
    }

    @Test
    fun projectFallsBackToEmDashForABlankVehicleName() {
        val blank = TitleSlideProjection.project(data(name = ""), strings, Locale.US)
        assertEquals("\u2014", blank.vehicleName)
        val whitespace = TitleSlideProjection.project(data(name = "   "), strings, Locale.US)
        assertEquals("\u2014", whitespace.vehicleName)
    }

    @Test
    fun projectPassesThroughANonBlankVehicleName() {
        val display = TitleSlideProjection.project(data(name = "Bluey"), strings, Locale.US)
        assertEquals("Bluey", display.vehicleName)
    }

    // ── a11y: the hero's stable TalkBack label is the projected grouped year ──

    @Test
    fun yearLabelDoublesAsTheStableHeroAccessibilityLabel() {
        // The composable clears the count-up's animating semantics and sets contentDescription = yearLabel,
        // so the screen reader announces the final grouped year once — assert the projected label is it.
        val display = TitleSlideProjection.project(data(year = 2026), strings, Locale.US)
        assertEquals("2,026", display.yearLabel)
    }

    // ── decode — the raw /analytics/year-review payload (snake_case + unknown-key tolerance) ──

    @Test
    fun decodeReadsSnakeCaseAndIgnoresTheOtherYearReviewColumns() {
        val json = Json { ignoreUnknownKeys = true }
        val raw =
            """
            {
              "year": 2024,
              "total_drives": 320,
              "total_distance_km": 10000.0,
              "vehicle": { "id": 7, "display_name": "My Model 3", "model": "model3" },
              "co2_offset_kg": 1200.0,
              "monthly_stats": []
            }
            """.trimIndent()
        val decoded = json.decodeFromString(TitleSlideData.serializer(), raw)
        assertEquals(2024, decoded.year)
        assertEquals(7L, decoded.vehicle.id)
        assertEquals("My Model 3", decoded.vehicle.displayName)
        assertEquals("model3", decoded.vehicle.model)
    }

    @Test
    fun decodeDefaultsEveryMissingField() {
        val json = Json { ignoreUnknownKeys = true }
        val decoded = json.decodeFromString(TitleSlideData.serializer(), "{}")
        assertEquals(0, decoded.year)
        assertEquals("", decoded.vehicle.displayName)
        // A fully-defaulted payload projects the em-dash fallback rather than an empty line.
        assertEquals("\u2014", TitleSlideProjection.project(decoded, strings, Locale.US).vehicleName)
    }

    // ── telemetry (P1/S11) + identifier mirrors ──

    @Test
    fun recordViewOpenedEmitsTheSurfaceSlugAndNothingElse() {
        val logger = RecordingLogger()
        TitleSlideDiagnostics.recordViewOpened(logger)
        assertEquals(1, logger.records.size)
        val record = logger.records.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals("view.opened", record.event)
        assertEquals(mapOf("surface" to "TitleSlide"), record.fields)
    }

    @Test
    fun identifiersAreStable() {
        assertEquals("TitleSlide", TitleSlideDiagnostics.SLUG)
        // The native catalog mirror of the web `yearReview.title` i18n key.
        assertEquals("translation_yearReview_title", TitleSlideDiagnostics.KEY_TITLE)
        // The slug never carries PII (no year, no vehicle name).
        assertTrue(TitleSlideDiagnostics.SLUG.all { it.isLetterOrDigit() })
    }

    /** Captures every record handed to the logger so the diagnostic's event + fields can be asserted. */
    private class RecordingLogger : Logger {
        data class Record(
            val level: LogLevel,
            val event: String,
            val fields: Map<String, String>,
        )

        val records = mutableListOf<Record>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records.add(Record(level, event, fields))
        }
    }
}
