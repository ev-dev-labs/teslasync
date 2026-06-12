package io.teslasync.android.featureviews.triggerconfigurator

import io.teslasync.shared.core.presentation.automations.AutomationTriggerInput
import io.teslasync.shared.core.presentation.locations.Geofence
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Locks the pure model + projection that keeps [TriggerConfigurator] a thin render layer — the JavaScript
 * parse semantics of the cron helpers, the signal-value transitions, the day toggle, the default-trigger
 * factory, the i18n key folding, and the option projections. Runs in the :android:testReleaseUnitTest gate.
 * Every case is anchored to the web source (web/src/features/automations/pages/TriggerConfigurator.tsx and
 * its lib helpers) so a drift from the web behaviour fails here.
 */
class TriggerConfiguratorModelTest {
    // ── parseCronExpr ─────────────────────────────────────────────────────────────

    @Test
    fun parseCronExprReadsSimpleEveryDaySchedule() {
        val parsed = parseCronExpr("0 8 * * *")
        assertEquals(CronParts(hour = 8, minute = 0, days = emptyList()), parsed)
    }

    @Test
    fun parseCronExprReadsSpecificDays() {
        val parsed = parseCronExpr("30 6 * * 1,3,5")
        assertEquals(CronParts(hour = 6, minute = 30, days = listOf(1, 3, 5)), parsed)
    }

    @Test
    fun parseCronExprRejectsNonFiveFieldExpression() {
        assertNull(parseCronExpr("0 8 * *"))
        assertNull(parseCronExpr(""))
        assertNull(parseCronExpr("0 8 * * * *"))
    }

    @Test
    fun parseCronExprRejectsDayOfMonthOrMonthConstraint() {
        assertNull(parseCronExpr("0 8 5 * *"))
        assertNull(parseCronExpr("0 8 * 6 *"))
    }

    @Test
    fun parseCronExprRejectsNonNumericMinuteOrHour() {
        assertNull(parseCronExpr("*/5 * * * *"))
    }

    @Test
    fun parseCronExprDropsUnparseableDayTokensLikeTheWeb() {
        // Web `dow.split(',').map(Number).filter(!isNaN)`: Number("1-5") is NaN, so the range is dropped and
        // the schedule reads as "every day" — the exact (quirky) web behaviour for the placeholder example.
        val parsed = parseCronExpr("0 8 * * 1-5")
        assertEquals(CronParts(hour = 8, minute = 0, days = emptyList()), parsed)
    }

    // ── buildCronExpr ─────────────────────────────────────────────────────────────

    @Test
    fun buildCronExprCollapsesEmptyOrFullWeekToWildcard() {
        assertEquals("0 8 * * *", buildCronExpr(8, 0, emptyList()))
        assertEquals("0 8 * * *", buildCronExpr(8, 0, listOf(0, 1, 2, 3, 4, 5, 6)))
    }

    @Test
    fun buildCronExprJoinsSortedDays() {
        assertEquals("30 7 * * 1,3,5", buildCronExpr(7, 30, listOf(5, 1, 3)))
    }

    @Test
    fun buildAndParseRoundTrip() {
        val expr = buildCronExpr(9, 15, listOf(2, 4))
        assertEquals(CronParts(hour = 9, minute = 15, days = listOf(2, 4)), parseCronExpr(expr))
    }

    // ── toggleDay / isDayActive ───────────────────────────────────────────────────

    @Test
    fun toggleDayFromEveryDayDeselectsOnlyThatDay() {
        assertEquals(listOf(0, 1, 3, 4, 5, 6), toggleDay(emptyList(), 2))
    }

    @Test
    fun toggleDayRemovesAnExistingDay() {
        assertEquals(listOf(1, 5), toggleDay(listOf(1, 3, 5), 3))
    }

    @Test
    fun toggleDayAddsAndSortsANewDay() {
        assertEquals(listOf(1, 3, 5), toggleDay(listOf(5, 1), 3))
    }

    @Test
    fun toggleDayCollapsesToEveryDayWhenAllSelected() {
        assertEquals(emptyList<Int>(), toggleDay(listOf(0, 1, 2, 3, 4, 5), 6))
    }

    @Test
    fun isDayActiveTreatsEmptyAsAllSelected() {
        assertTrue(isDayActive(emptyList(), 0))
        assertTrue(isDayActive(emptyList(), 6))
        assertTrue(isDayActive(listOf(2, 4), 2))
        assertFalse(isDayActive(listOf(2, 4), 3))
    }

    // ── createDefaultTrigger / kind discriminator ─────────────────────────────────

    @Test
    fun createDefaultTriggerMatchesWebDefaults() {
        assertEquals(
            AutomationTriggerInput.Schedule(cronExpr = "0 8 * * *", timezone = "UTC"),
            createDefaultTrigger(TriggerKind.Schedule),
        )
        assertEquals(AutomationTriggerInput.Event(eventType = "online"), createDefaultTrigger(TriggerKind.Event))
        assertEquals(
            AutomationTriggerInput.Geofence(placeId = 0L, event = "enter"),
            createDefaultTrigger(TriggerKind.Geofence),
        )
        assertEquals(
            AutomationTriggerInput.Signal(signal = "battery_level", op = "<", valueNum = 20.0),
            createDefaultTrigger(TriggerKind.Signal),
        )
    }

    @Test
    fun triggerKindOfDiscriminatesEachVariant() {
        assertEquals(
            TriggerKind.Schedule,
            TriggerKind.of(AutomationTriggerInput.Schedule(cronExpr = "0 8 * * *", timezone = "UTC")),
        )
        assertEquals(TriggerKind.Event, TriggerKind.of(AutomationTriggerInput.Event(eventType = "online")))
        assertEquals(TriggerKind.Geofence, TriggerKind.of(AutomationTriggerInput.Geofence(placeId = 1L, event = "enter")))
        assertEquals(
            TriggerKind.Signal,
            TriggerKind.of(AutomationTriggerInput.Signal(signal = "speed", op = ">", valueNum = 50.0)),
        )
    }

    // ── Signal value transitions ──────────────────────────────────────────────────

    @Test
    fun isBoolSignalMatchesBooleanFields() {
        assertTrue(isBoolSignal("is_locked"))
        assertTrue(isBoolSignal("sentry_mode"))
        assertFalse(isBoolSignal("battery_level"))
        assertFalse(isBoolSignal("state"))
    }

    @Test
    fun signalValueStringFormatsByType() {
        assertEquals("true", signalValueString(AutomationTriggerInput.Signal(signal = "is_locked", op = "=", valueBool = true)))
        assertEquals("false", signalValueString(AutomationTriggerInput.Signal(signal = "is_locked", op = "=", valueBool = false)))
        assertEquals("online", signalValueString(AutomationTriggerInput.Signal(signal = "state", op = "=", valueText = "online")))
        assertEquals("20", signalValueString(AutomationTriggerInput.Signal(signal = "battery_level", op = "<", valueNum = 20.0)))
        assertEquals("12.5", signalValueString(AutomationTriggerInput.Signal(signal = "battery_level", op = "<", valueNum = 12.5)))
    }

    @Test
    fun signalValueStringUsesDefaultsWhenMissing() {
        assertEquals("true", signalValueString(AutomationTriggerInput.Signal(signal = "is_locked", op = "=")))
        assertEquals("online", signalValueString(AutomationTriggerInput.Signal(signal = "state", op = "=")))
        assertEquals("20", signalValueString(AutomationTriggerInput.Signal(signal = "speed", op = "<")))
    }

    @Test
    fun signalValueFromInputClearsValuesWhenChanged() {
        val base = AutomationTriggerInput.Signal(signal = "battery_level", op = "changed", valueNum = 5.0, stepOrder = 3)
        val next = signalValueFromInput(base, "ignored")
        assertEquals(AutomationTriggerInput.Signal(stepOrder = 3, signal = "battery_level", op = "changed"), next)
        assertNull(next.valueNum)
        assertNull(next.valueText)
        assertNull(next.valueBool)
    }

    @Test
    fun signalValueFromInputSetsOnlyTheRelevantValueField() {
        val boolNext = signalValueFromInput(AutomationTriggerInput.Signal(signal = "is_locked", op = "="), "true")
        assertEquals(true, boolNext.valueBool)
        assertNull(boolNext.valueNum)

        val textNext = signalValueFromInput(AutomationTriggerInput.Signal(signal = "state", op = "="), "asleep")
        assertEquals("asleep", textNext.valueText)
        assertNull(textNext.valueNum)

        val numNext = signalValueFromInput(AutomationTriggerInput.Signal(signal = "battery_level", op = "<"), "42")
        assertEquals(42.0, numNext.valueNum!!, 0.0001)
        assertNull(numNext.valueBool)
    }

    @Test
    fun signalValueFromInputPreservesStepOrder() {
        val next = signalValueFromInput(AutomationTriggerInput.Signal(signal = "battery_level", op = "<", stepOrder = 7), "10")
        assertEquals(7, next.stepOrder)
    }

    @Test
    fun signalForFieldPicksTheRightDefaultPerType() {
        val base = AutomationTriggerInput.Signal(signal = "battery_level", op = "<", valueNum = 20.0, stepOrder = 2)
        val bool = signalForField(base, "is_charging")
        assertEquals(AutomationTriggerInput.Signal(stepOrder = 2, signal = "is_charging", op = "=", valueBool = true), bool)
        val state = signalForField(base, "state")
        assertEquals(AutomationTriggerInput.Signal(stepOrder = 2, signal = "state", op = "=", valueText = "online"), state)
        val num = signalForField(base, "speed")
        assertEquals(AutomationTriggerInput.Signal(stepOrder = 2, signal = "speed", op = "<", valueNum = 20.0), num)
    }

    // ── JavaScript numeric-parse parity ───────────────────────────────────────────

    @Test
    fun jsParseIntReadsLeadingInteger() {
        assertEquals(8, jsParseInt("08"))
        assertEquals(8, jsParseInt("8abc"))
        assertEquals(3, jsParseInt("+3"))
        assertNull(jsParseInt("abc"))
        assertNull(jsParseInt("*/5"))
    }

    @Test
    fun jsNumberIsStrictWithBlankAsZero() {
        assertEquals(0.0, jsNumber("")!!, 0.0)
        assertEquals(0.0, jsNumber("   ")!!, 0.0)
        assertEquals(12.0, jsNumber("12")!!, 0.0)
        assertNull(jsNumber("1-5"))
    }

    @Test
    fun jsParseFloatOrZeroFoldsNonNumericToZero() {
        assertEquals(20.0, jsParseFloatOrZero("20"), 0.0)
        assertEquals(20.5, jsParseFloatOrZero("20.5"), 0.0)
        assertEquals(12.0, jsParseFloatOrZero("12px"), 0.0)
        assertEquals(0.0, jsParseFloatOrZero("abc"), 0.0)
        assertEquals(0.0, jsParseFloatOrZero(""), 0.0)
    }

    @Test
    fun jsNumberToStringDropsTrailingZeroDecimal() {
        assertEquals("20", jsNumberToString(20.0))
        assertEquals("0", jsNumberToString(0.0))
        assertEquals("12.5", jsNumberToString(12.5))
    }

    @Test
    fun dwellMinutesFromInputFallsBackToOne() {
        assertEquals(5, dwellMinutesFromInput("5"))
        assertEquals(1, dwellMinutesFromInput(""))
        assertEquals(1, dwellMinutesFromInput("0"))
        assertEquals(1, dwellMinutesFromInput("abc"))
    }

    // ── i18n key folding + resolution ─────────────────────────────────────────────

    @Test
    fun foldCatalogKeyMatchesGeneratedResourceNames() {
        assertEquals("translation_automations_builder_time", foldCatalogKey("automations.builder.time"))
        assertEquals("translation_timezones_America_New_York", foldCatalogKey("timezones.America/New_York"))
        assertEquals("translation_timezones_utc", foldCatalogKey("timezones.utc"))
        assertEquals("translation_common_days_short_0", foldCatalogKey("common.days.short.0"))
    }

    @Test
    fun buildStringsResolvesPresentKeysAndFallsBackOtherwise() {
        val catalog = mapOf("automations.builder.time" to "Heure")
        val resolve: StringResolver = { key, fallback -> catalog[key] ?: fallback }
        val strings = buildTriggerConfiguratorStrings(resolve)
        assertEquals("Heure", strings.time)
        assertEquals("Cron Expression", strings.cronExpr)
        assertEquals("Fire on any change", strings.changedOnly)
        assertEquals("Select geofence...", strings.selectGeofence)
    }

    // ── Option projections ────────────────────────────────────────────────────────

    private val passthrough: StringResolver = { _, fallback -> fallback }

    @Test
    fun eventOptionsMatchTheWebTable() {
        val options = eventOptions(passthrough)
        assertEquals(9, options.size)
        assertEquals(OptionItem("online", "Comes Online"), options.first { it.value == "online" })
        assertEquals(OptionItem("sentry_alert", "Sentry Alert"), options.last())
    }

    @Test
    fun geofenceEventOptionsAreEnterExitDwell() {
        assertEquals(listOf("enter", "exit", "dwell"), geofenceEventOptions(passthrough).map { it.value })
    }

    @Test
    fun signalOperatorOptionsCoverAllNineComparisons() {
        val options = signalOperatorOptions(passthrough)
        assertEquals(9, options.size)
        assertEquals(OptionItem("changed", "Changed"), options.first { it.value == "changed" })
    }

    @Test
    fun signalFieldOptionsUseRawLabels() {
        val options = signalFieldOptions()
        assertEquals(9, options.size)
        assertEquals(OptionItem("battery_level", "Battery Level"), options.first())
    }

    @Test
    fun timezoneOptionsFoldEmptyValueToUtcKey() {
        val seen = mutableListOf<String>()
        val recording: StringResolver = { key, fallback ->
            seen += key
            fallback
        }
        val options = timezoneOptions(recording)
        assertEquals(11, options.size)
        assertEquals(OptionItem("", "UTC (Default)"), options.first())
        assertTrue(seen.contains("timezones.utc"))
        assertTrue(seen.contains("timezones.America/New_York"))
    }

    @Test
    fun geofenceOptionsPrependThePlaceholder() {
        val fences = listOf(geofence(7, "Home"), geofence(9, "Office"))
        val options = geofenceOptions(fences, "Select geofence...")
        assertEquals(OptionItem("", "Select geofence..."), options.first())
        assertEquals(OptionItem("7", "Home"), options[1])
        assertEquals(OptionItem("9", "Office"), options[2])
    }

    @Test
    fun triggerTypeOptionsMapToKinds() {
        val options = triggerTypeOptions(passthrough)
        assertEquals(
            listOf(TriggerKind.Schedule, TriggerKind.Event, TriggerKind.Geofence, TriggerKind.Signal),
            options.map { it.kind },
        )
        assertEquals("Signal Threshold", options.last().label)
    }

    @Test
    fun dayShortLabelFallsBackToTheWebDayName() {
        assertEquals("Sun", dayShortLabel(passthrough, 0))
        assertEquals("Wed", dayShortLabel(passthrough, 3))
        assertEquals("Sat", dayFullLabel(6))
    }

    private fun geofence(
        id: Long,
        name: String,
    ): Geofence =
        Geofence(
            id = id,
            name = name,
            polygonWkt = "",
            createdAt = "2024-01-01T00:00:00Z",
            updatedAt = "2024-01-01T00:00:00Z",
            latitude = 37.0,
            longitude = -122.0,
            radius = 500.0,
            enabled = true,
        )
}
