package io.teslasync.android.featureviews.conditionbuilder

import io.teslasync.shared.core.presentation.locations.Geofence
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the ConditionBuilder's pure adapter logic — the native port of the web spec
 * (web/src/features/automations/pages/ConditionBuilder.tsx): createDefaultCondition, conditionValueFromInput,
 * the signal/operator change transitions, the value-string derivation, the boolean operator filtering, the
 * numeric helpers, and the geofence option projection. Each test mirrors a branch of the web source so the
 * three platforms cannot drift.
 */
class ConditionBuilderModelTest {
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
        )

    // ── createDefaultCondition (web createDefaultCondition) ────────────────────────────────────────────

    @Test
    fun defaultSignalConditionMatchesWeb() {
        val c = createDefaultCondition(ConditionKind.Signal) as ConditionInput.Signal
        assertEquals("battery_level", c.signal)
        assertEquals(SignalOp.LessThan, c.op)
        assertEquals(20.0, c.valueNum!!, 0.0)
    }

    @Test
    fun defaultTimeWindowConditionMatchesWeb() {
        val c = createDefaultCondition(ConditionKind.TimeWindow) as ConditionInput.TimeWindow
        assertEquals("06:00", c.startTime)
        assertEquals("09:00", c.endTime)
        assertEquals("UTC", c.timezone)
        assertEquals(listOf(1, 2, 3, 4, 5), c.daysOfWeek)
    }

    @Test
    fun defaultGeofenceAndOtherAutomationConditionsMatchWeb() {
        val g = createDefaultCondition(ConditionKind.Geofence) as ConditionInput.Geofence
        assertEquals(0L, g.placeId)
        assertEquals(GeofenceConditionState.Inside, g.state)

        val o = createDefaultCondition(ConditionKind.OtherAutomation) as ConditionInput.OtherAutomation
        assertEquals(0L, o.otherAutomationId)
        assertEquals(OtherAutomationState.Enabled, o.state)
    }

    // ── conditionValueFromInput (web conditionValueFromInput) ──────────────────────────────────────────

    @Test
    fun valueFromInputParsesBooleanForBoolSignals() {
        val base = ConditionInput.Signal(signal = "is_locked", op = SignalOp.Equals)
        assertEquals(true, conditionValueFromInput(base, "true").valueBool)
        assertEquals(false, conditionValueFromInput(base, "false").valueBool)
        // Only the boolean field is populated.
        assertEquals(null, conditionValueFromInput(base, "true").valueNum)
        assertEquals(null, conditionValueFromInput(base, "true").valueText)
    }

    @Test
    fun valueFromInputKeepsTextForStateSignalOrInOperator() {
        val stateSignal = ConditionInput.Signal(signal = "state", op = SignalOp.Equals)
        assertEquals("online", conditionValueFromInput(stateSignal, "online").valueText)

        val inOperator = ConditionInput.Signal(signal = "speed", op = SignalOp.In)
        assertEquals("10,20,30", conditionValueFromInput(inOperator, "10,20,30").valueText)
    }

    @Test
    fun valueFromInputParsesNumberOtherwiseAndFallsBackToZero() {
        val numeric = ConditionInput.Signal(signal = "battery_level", op = SignalOp.LessThan)
        assertEquals(42.5, conditionValueFromInput(numeric, "42.5").valueNum!!, 0.0)
        assertEquals(0.0, conditionValueFromInput(numeric, "").valueNum!!, 0.0)
        assertEquals(0.0, conditionValueFromInput(numeric, "abc").valueNum!!, 0.0)
    }

    // ── signal change reset (web signal select onChange) ───────────────────────────────────────────────

    @Test
    fun signalChangeResetsToKindSpecificDefault() {
        val bool = conditionForSignalChange("sentry_mode")
        assertEquals(SignalOp.Equals, bool.op)
        assertEquals(true, bool.valueBool)

        val state = conditionForSignalChange("state")
        assertEquals(SignalOp.Equals, state.op)
        assertEquals("online", state.valueText)

        val numeric = conditionForSignalChange("inside_temp")
        assertEquals(SignalOp.LessThan, numeric.op)
        assertEquals(20.0, numeric.valueNum!!, 0.0)
    }

    // ── operator change (web operator select onChange) ─────────────────────────────────────────────────

    @Test
    fun operatorChangeToBetweenSeedsMinMaxFromPriorValue() {
        val prior = ConditionInput.Signal(signal = "battery_level", op = SignalOp.LessThan, valueNum = 55.0)
        val ranged = conditionForOperatorChange(prior, SignalOp.Between)
        assertEquals(SignalOp.Between, ranged.op)
        assertEquals(55.0, ranged.valueMin!!, 0.0)
        assertEquals(100.0, ranged.valueMax!!, 0.0)
    }

    @Test
    fun operatorChangeToInConvertsValueToText() {
        val prior = ConditionInput.Signal(signal = "battery_level", op = SignalOp.LessThan, valueNum = 20.0)
        val asIn = conditionForOperatorChange(prior, SignalOp.In)
        assertEquals(SignalOp.In, asIn.op)
        assertEquals("20", asIn.valueText)
        assertEquals(null, asIn.valueNum)
    }

    @Test
    fun operatorChangeBetweenToComparisonReparsesNumber() {
        val ranged = ConditionInput.Signal(signal = "battery_level", op = SignalOp.Between, valueMin = 10.0, valueMax = 90.0)
        val cmp = conditionForOperatorChange(ranged, SignalOp.GreaterThan)
        assertEquals(SignalOp.GreaterThan, cmp.op)
        // The value-string derivation of a between condition is the default 20, re-parsed under the new op.
        assertEquals(20.0, cmp.valueNum!!, 0.0)
    }

    // ── signalValueString (web `value` derivation) ─────────────────────────────────────────────────────

    @Test
    fun signalValueStringCoversAllBranches() {
        assertEquals("true", signalValueString(ConditionInput.Signal("is_locked", SignalOp.Equals, valueBool = true)))
        assertEquals("false", signalValueString(ConditionInput.Signal("is_locked", SignalOp.Equals, valueBool = false)))
        // Boolean default is true when unset (web `value_bool ?? true`).
        assertEquals("true", signalValueString(ConditionInput.Signal("is_locked", SignalOp.Equals)))
        assertEquals("online", signalValueString(ConditionInput.Signal("state", SignalOp.Equals, valueText = "online")))
        assertEquals("", signalValueString(ConditionInput.Signal("state", SignalOp.Equals)))
        assertEquals("20", signalValueString(ConditionInput.Signal("battery_level", SignalOp.LessThan)))
        assertEquals("33.5", signalValueString(ConditionInput.Signal("battery_level", SignalOp.LessThan, valueNum = 33.5)))
    }

    // ── operator filtering (web `!isBool || !operator.numericOnly`) ────────────────────────────────────

    @Test
    fun booleanSignalsOnlyOfferNonNumericOperators() {
        val boolOps = operatorsFor(isBool = true)
        assertEquals(listOf(SignalOp.Equals, SignalOp.NotEquals, SignalOp.In), boolOps)
        assertTrue(boolOps.none { it.numericOnly })
    }

    @Test
    fun numericSignalsOfferEveryOperator() {
        assertEquals(SignalOp.ordered, operatorsFor(isBool = false))
        assertEquals(8, operatorsFor(isBool = false).size)
    }

    @Test
    fun isRangeOnlyForBetween() {
        assertTrue(isRange(ConditionInput.Signal("battery_level", SignalOp.Between)))
        assertFalse(isRange(ConditionInput.Signal("battery_level", SignalOp.LessThan)))
    }

    // ── numeric helpers (web numericValue / String(number) / parseFloat||0 / parseInt||0) ──────────────

    @Test
    fun numericValueFallsBackForNullAndNonFinite() {
        assertEquals(7.0, numericValue(7.0, 0.0), 0.0)
        assertEquals(3.0, numericValue(null, 3.0), 0.0)
        assertEquals(5.0, numericValue(Double.NaN, 5.0), 0.0)
        assertEquals(5.0, numericValue(Double.POSITIVE_INFINITY, 5.0), 0.0)
    }

    @Test
    fun formatNumberInputDropsTrailingZero() {
        assertEquals("20", formatNumberInput(20.0))
        assertEquals("100", formatNumberInput(100.0))
        assertEquals("20.5", formatNumberInput(20.5))
        assertEquals("0", formatNumberInput(Double.NaN))
    }

    @Test
    fun parseHelpersFallBackToZero() {
        assertEquals(12.5, parseNumberOrZero(" 12.5 "), 0.0)
        assertEquals(0.0, parseNumberOrZero(""), 0.0)
        assertEquals(7L, parseIdOrZero("7"))
        assertEquals(0L, parseIdOrZero("x"))
    }

    // ── geofence option projection (web geofenceOptions memo) ──────────────────────────────────────────

    @Test
    fun geofenceOptionsPrependSentinelThenMapFences() {
        val options = geofenceOptions("Select geofence...", listOf(geofence(3, "Home"), geofence(7, "Work")))
        assertEquals(3, options.size)
        assertEquals("", options[0].value)
        assertEquals("Select geofence...", options[0].label)
        assertEquals("3", options[1].value)
        assertEquals("Home", options[1].label)
        assertEquals("7", options[2].value)
    }

    @Test
    fun geofenceOptionsWithNoFencesIsJustSentinel() {
        val options = geofenceOptions("Select geofence...", emptyList())
        assertEquals(1, options.size)
        assertEquals("", options[0].value)
    }

    @Test
    fun geofenceSelectValueAndPlaceIdRoundTrip() {
        assertEquals("", geofenceSelectValue(ConditionInput.Geofence(0L, GeofenceConditionState.Inside)))
        assertEquals("5", geofenceSelectValue(ConditionInput.Geofence(5L, GeofenceConditionState.Inside)))
        assertEquals(0L, geofencePlaceIdFromValue(""))
        assertEquals(5L, geofencePlaceIdFromValue("5"))
    }

    // ── day toggle (web day button onClick) ────────────────────────────────────────────────────────────

    @Test
    fun toggleDayAddsSortedAndRemoves() {
        assertEquals(listOf(1, 3, 5), toggleDay(listOf(1, 5), 3))
        assertEquals(listOf(1, 5), toggleDay(listOf(1, 3, 5), 3))
        assertEquals(listOf(0), toggleDay(emptyList(), 0))
    }

    // ── enum wire round trips (serialization parity) ───────────────────────────────────────────────────

    @Test
    fun enumWireValuesRoundTrip() {
        ConditionKind.entries.forEach { assertEquals(it, ConditionKind.fromWire(it.wire)) }
        SignalOp.entries.forEach { assertEquals(it, SignalOp.fromWire(it.wire)) }
        GeofenceConditionState.entries.forEach { assertEquals(it, GeofenceConditionState.fromWire(it.wire)) }
        OtherAutomationState.entries.forEach { assertEquals(it, OtherAutomationState.fromWire(it.wire)) }
        assertEquals("condition_signal", ConditionKind.Signal.wire)
        assertEquals("recently_triggered", OtherAutomationState.RecentlyTriggered.wire)
    }

    @Test
    fun boolFieldKeysMatchWebRegistry() {
        assertEquals(setOf("is_locked", "is_charging", "is_climate_on", "sentry_mode"), BOOL_FIELD_KEYS)
        assertTrue(isBoolSignal("sentry_mode"))
        assertFalse(isBoolSignal("battery_level"))
    }
}
