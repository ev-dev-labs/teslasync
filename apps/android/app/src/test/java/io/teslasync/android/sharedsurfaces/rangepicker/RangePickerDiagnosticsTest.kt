package io.teslasync.android.sharedsurfaces.rangepicker

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the PII-safe diagnostics (P1/S11): `view.opened` emits only the surface slug, and the interaction
 * events (preset applied / custom applied / canceled / compare toggled) carry only the surface slug plus a
 * constant identifier (a preset id, a boolean) — NEVER the selected start/end dates — so a diagnostics line can
 * never leak the range a user picked. Runs in the :android:testReleaseUnitTest gate.
 */
class RangePickerDiagnosticsTest {
    private class RecordingLogger : Logger {
        val events = mutableListOf<Triple<LogLevel, String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += Triple(level, event, fields)
        }
    }

    @Test
    fun slugMatchesTheSurfaceContract() {
        assertEquals("RangePicker", RangePickerDiagnostics.SLUG)
        assertEquals("RangePicker", RangePickerRegistration.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsTheSlugAndNothingElse() {
        val logger = RecordingLogger()

        RangePickerDiagnostics.recordViewOpened(logger)

        val opened = logger.events.single { it.second == "view.opened" }
        assertEquals(LogLevel.Info, opened.first)
        assertEquals(mapOf("surface" to "RangePicker"), opened.third)
    }

    @Test
    fun recordPresetAppliedCarriesOnlyTheSlugAndPresetId() {
        val logger = RecordingLogger()

        RangePickerDiagnostics.recordPresetApplied(logger, "7d")

        val applied = logger.events.single { it.second == "dateRange.presetApplied" }
        assertEquals(LogLevel.Info, applied.first)
        assertEquals(mapOf("surface" to "RangePicker", "preset" to "7d"), applied.third)
    }

    @Test
    fun recordCustomAppliedCarriesTheSlugButNeverTheStagedDates() {
        val logger = RecordingLogger()

        RangePickerDiagnostics.recordCustomApplied(logger)

        val applied = logger.events.single { it.second == "dateRange.customApplied" }
        assertEquals(mapOf("surface" to "RangePicker"), applied.third)
    }

    @Test
    fun recordCanceledCarriesOnlyTheSlug() {
        val logger = RecordingLogger()

        RangePickerDiagnostics.recordCanceled(logger)

        val canceled = logger.events.single { it.second == "dateRange.canceled" }
        assertEquals(mapOf("surface" to "RangePicker"), canceled.third)
    }

    @Test
    fun recordCompareToggledCarriesTheSlugAndTheNewBoolean() {
        val logger = RecordingLogger()

        RangePickerDiagnostics.recordCompareToggled(logger, enabled = true)
        RangePickerDiagnostics.recordCompareToggled(logger, enabled = false)

        val events = logger.events.filter { it.second == "dateRange.compareToggled" }
        assertEquals(2, events.size)
        assertEquals(mapOf("surface" to "RangePicker", "enabled" to "true"), events[0].third)
        assertEquals(mapOf("surface" to "RangePicker", "enabled" to "false"), events[1].third)
    }

    @Test
    fun noDiagnosticEverCarriesADateValue() {
        val logger = RecordingLogger()

        RangePickerDiagnostics.recordViewOpened(logger)
        RangePickerDiagnostics.recordPresetApplied(logger, "30d")
        RangePickerDiagnostics.recordCustomApplied(logger)
        RangePickerDiagnostics.recordCanceled(logger)
        RangePickerDiagnostics.recordCompareToggled(logger, enabled = true)

        val isoDate = Regex("""\d{4}-\d{2}-\d{2}""")
        val leaked = logger.events.flatMap { it.third.values }.filter { isoDate.containsMatchIn(it) }
        assertTrue("no diagnostic field may carry an ISO date: $leaked", leaked.isEmpty())
    }
}
