package io.teslasync.android.featureviews.quiethourspanel

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.QuietHoursWindow
import io.teslasync.shared.core.presentation.notifications.QuietHoursWindowInput
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Exercises every pure derivation the [QuietHoursPanel] composable leans on, off-device — the draft model +
 * `makeDraft` / `draftFromSeed`, the `validateDraft` matrix, `parseHhMm`, `summarizeWindow`, the verbatim
 * `nextWindowChange` port (wrap / non-wrap / disabled / not-today / malformed), the curated timezone list, the
 * draft mutators, and the PII-safe `view.opened` diagnostic. Mirrors the web component's logic
 * (web/src/features/settings/components/QuietHoursPanel.tsx).
 */
class QuietHoursPanelProjectionTest {
    private fun window(
        enabled: Boolean = true,
        start: String = "23:00",
        end: String = "07:00",
        weekdays: Int = ALL_WEEKDAYS,
        bypass: List<String> = listOf("critical"),
    ): QuietHoursWindow =
        QuietHoursWindow(
            id = 1,
            enabled = enabled,
            startLocal = start,
            endLocal = end,
            timezone = "Europe/London",
            weekdays = weekdays,
            bypassSeverities = bypass,
        )

    @Test
    fun makeDraftCreateUsesDefaults() {
        val draft = makeDraft(defaultTimezone = "Europe/London")
        assertNull(draft.id)
        assertTrue(draft.enabled)
        assertEquals("23:00", draft.startLocal)
        assertEquals("07:00", draft.endLocal)
        assertEquals("Europe/London", draft.timezone)
        assertEquals(ALL_WEEKDAYS, draft.weekdays)
        assertEquals(listOf("critical"), draft.bypassSeverities)
    }

    @Test
    fun makeDraftCreateBlankTimezoneFallsBackToUtc() {
        assertEquals("UTC", makeDraft(defaultTimezone = "").timezone)
    }

    @Test
    fun makeDraftFromWindowCopiesFields() {
        val source = window(enabled = false, weekdays = 62, bypass = listOf("warn")).copy(id = 9, timezone = "Asia/Tokyo")
        val draft = makeDraft(source)
        assertEquals(9L, draft.id)
        assertFalse(draft.enabled)
        assertEquals("Asia/Tokyo", draft.timezone)
        assertEquals(62, draft.weekdays)
        assertEquals(listOf("warn"), draft.bypassSeverities)
    }

    @Test
    fun draftFromSeedFillsMissingWithDefaults() {
        val draft = draftFromSeed(QuietHoursWindowInput(startLocal = "22:30"), defaultTimezone = "America/Denver")
        assertNull(draft.id)
        assertTrue(draft.enabled)
        assertEquals("22:30", draft.startLocal)
        assertEquals("07:00", draft.endLocal)
        assertEquals("America/Denver", draft.timezone)
        assertEquals(ALL_WEEKDAYS, draft.weekdays)
        assertEquals(listOf("critical"), draft.bypassSeverities)
    }

    @Test
    fun draftFromSeedUsesProvidedValuesButNeverAnId() {
        val seed =
            QuietHoursWindowInput(
                enabled = false,
                startLocal = "01:00",
                endLocal = "02:00",
                timezone = "UTC",
                weekdays = 1,
                bypassSeverities = listOf("info"),
            )
        val draft = draftFromSeed(seed)
        assertNull(draft.id)
        assertFalse(draft.enabled)
        assertEquals(1, draft.weekdays)
        assertEquals(listOf("info"), draft.bypassSeverities)
    }

    @Test
    fun validateValidDraftReturnsNull() {
        assertNull(validateDraft(makeDraft(window())))
    }

    @Test
    fun validateStartInvalid() {
        assertEquals(QuietHoursValidationError.StartInvalid, validateDraft(makeDraft().copy(startLocal = "9:00")))
    }

    @Test
    fun validateEndInvalid() {
        assertEquals(QuietHoursValidationError.EndInvalid, validateDraft(makeDraft().copy(endLocal = "24:00")))
    }

    @Test
    fun validateEndEqual() {
        val draft = makeDraft().copy(startLocal = "07:00", endLocal = "07:00")
        assertEquals(QuietHoursValidationError.EndEqual, validateDraft(draft))
    }

    @Test
    fun validateTimezoneRequired() {
        assertEquals(QuietHoursValidationError.TimezoneRequired, validateDraft(makeDraft().copy(timezone = "")))
    }

    @Test
    fun validateWeekdaysRequiredWhenZero() {
        assertEquals(QuietHoursValidationError.WeekdaysRequired, validateDraft(makeDraft().copy(weekdays = 0)))
    }

    @Test
    fun validateWeekdaysRequiredWhenOutOfRange() {
        assertEquals(QuietHoursValidationError.WeekdaysRequired, validateDraft(makeDraft().copy(weekdays = 200)))
    }

    @Test
    fun validateAllowsEmptyBypass() {
        assertNull(validateDraft(makeDraft().copy(bypassSeverities = emptyList())))
    }

    @Test
    fun parseHhMmValid() {
        assertEquals(23 * 60, parseHhMm("23:00"))
        assertEquals(7 * 60 + 30, parseHhMm("07:30"))
    }

    @Test
    fun parseHhMmInvalid() {
        assertNull(parseHhMm("24:00"))
        assertNull(parseHhMm("9:00"))
        assertNull(parseHhMm("nope"))
    }

    @Test
    fun summarizeWindowFormats() {
        assertEquals("23:00 \u2192 07:00 (Europe/London)", summarizeWindow(window()))
    }

    @Test
    fun nextChangeNullWhenDisabled() {
        assertNull(nextWindowChange(window(enabled = false), nowMinutes = 600, todayDow = 0))
    }

    @Test
    fun nextChangeNullWhenNotToday() {
        // Window runs Monday only (bit 1<<1); today is Sunday (dow 0).
        assertNull(nextWindowChange(window(weekdays = 1 shl 1), nowMinutes = 600, todayDow = 0))
    }

    @Test
    fun nextChangeNullWhenTimesMalformed() {
        assertNull(nextWindowChange(window(start = "9:00"), nowMinutes = 600, todayDow = 0))
    }

    @Test
    fun nextChangeWrapsEndsToday() {
        val change = nextWindowChange(window(), nowMinutes = 300, todayDow = 0)
        assertEquals(NextWindowChange(NextWindowChangeKind.EndsToday, "07:00"), change)
    }

    @Test
    fun nextChangeWrapsEndsTomorrow() {
        val change = nextWindowChange(window(), nowMinutes = 1410, todayDow = 0)
        assertEquals(NextWindowChange(NextWindowChangeKind.EndsTomorrow, "07:00"), change)
    }

    @Test
    fun nextChangeWrapsStartsToday() {
        val change = nextWindowChange(window(), nowMinutes = 600, todayDow = 0)
        assertEquals(NextWindowChange(NextWindowChangeKind.StartsToday, "23:00"), change)
    }

    @Test
    fun nextChangeNonWrapStartsToday() {
        val change = nextWindowChange(window(start = "09:00", end = "17:00"), nowMinutes = 480, todayDow = 0)
        assertEquals(NextWindowChange(NextWindowChangeKind.StartsToday, "09:00"), change)
    }

    @Test
    fun nextChangeNonWrapEndsToday() {
        val change = nextWindowChange(window(start = "09:00", end = "17:00"), nowMinutes = 720, todayDow = 0)
        assertEquals(NextWindowChange(NextWindowChangeKind.EndsToday, "17:00"), change)
    }

    @Test
    fun nextChangeNonWrapStartsTomorrow() {
        val change = nextWindowChange(window(start = "09:00", end = "17:00"), nowMinutes = 1080, todayDow = 0)
        assertEquals(NextWindowChange(NextWindowChangeKind.StartsTomorrow, "09:00"), change)
    }

    @Test
    fun toggleWeekdayFlipsBit() {
        val base = makeDraft().copy(weekdays = 0)
        assertEquals(2, base.toggleWeekday(2).weekdays)
        assertEquals(0, base.toggleWeekday(2).toggleWeekday(2).weekdays)
    }

    @Test
    fun toggleSeverityAddsAndRemoves() {
        val base = makeDraft().copy(bypassSeverities = emptyList())
        assertEquals(listOf("warn"), base.toggleSeverity("warn").bypassSeverities)
        val added = base.toggleSeverity("critical")
        val removed = added.toggleSeverity("critical")
        assertTrue(removed.bypassSeverities.isEmpty())
    }

    @Test
    fun toInputMapsAllFields() {
        val input = makeDraft(window(enabled = false, weekdays = 62, bypass = listOf("warn"))).toInput()
        assertEquals(false, input.enabled)
        assertEquals("23:00", input.startLocal)
        assertEquals(62, input.weekdays)
        assertEquals(listOf("warn"), input.bypassSeverities)
    }

    @Test
    fun timezonesPrependCurrentWhenAbsent() {
        val zones = quietHoursTimezones("Pacific/Auckland")
        assertEquals("Pacific/Auckland", zones.first())
        assertTrue(zones.contains("UTC"))
    }

    @Test
    fun timezonesUnchangedWhenPresentOrBlank() {
        assertEquals(quietHoursTimezones(""), quietHoursTimezones("UTC"))
        assertTrue(quietHoursTimezones("UTC").contains("UTC"))
    }

    @Test
    fun recordViewOpenedEmitsSlugOnce() {
        val logger = RecordingLogger()
        recordQuietHoursPanelViewOpened(logger)
        assertEquals(1, logger.events.size)
        assertEquals("view.opened", logger.events.single().first)
        assertEquals(mapOf("surface" to "QuietHoursPanel"), logger.events.single().second)
    }

    @Test
    fun registrationSlugIsStable() {
        assertEquals("QuietHoursPanel", QuietHoursPanelRegistration.SLUG)
    }

    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }
}
