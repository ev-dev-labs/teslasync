package io.teslasync.android.dashboard.widgets.chargingschedule

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.presentation.signals.SignalEnvelope
import io.teslasync.shared.core.presentation.signals.SignalKind
import io.teslasync.shared.core.presentation.signals.SignalValue
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Off-device verification of the ChargingScheduleWidget's pure logic — the signal parse (typed-kind
 * guards + pending coercion), the `hasScheduleData` gate, the mode label/tone maps, the timeline
 * projection (order, glyph/tone, pending sub-label, charge-limit row, a11y), the compact hero + tall
 * state row, the SOC formatter, the registry metadata, and the vehicle-id resolution. Mirrors the web
 * spec (web/src/features/dashboard/widgets/ChargingScheduleWidget.tsx).
 */
class ChargingScheduleProjectionTest {
    private val ts = "2026-06-11T10:00:00Z"

    private fun text(value: String) = SignalEnvelope(SignalKind.String, SignalValue.Text(value), ts)

    private fun bool(value: Boolean) = SignalEnvelope(SignalKind.Bool, SignalValue.Bool(value), ts)

    private fun num(value: Double) = SignalEnvelope(SignalKind.Float, SignalValue.Num(value), ts)

    private fun strings(): ChargingScheduleStrings =
        ChargingScheduleStrings(
            title = "Charging Schedule",
            modeStartAt = "Start At",
            modeDepartBy = "Depart By",
            modeOff = "Off",
            modeUnknown = "Unknown",
            startCharging = "Start Charging",
            pending = "Pending",
            departure = "Departure",
            targetLimit = "Target Limit",
            limit = "Charge Limit",
            noData = "No schedule data",
            noTimes = "No scheduled times set",
            currentLevel = "Current Level",
            status = "Status",
            charging = "Charging",
            notCharging = "Not Charging",
            refreshLabel = "Refresh",
            refreshingLabel = "Loading",
            offlineLabel = "Offline",
            // Echo the raw value so timeline-time projection is deterministically asserted.
            formatTime = { it ?: EM_DASH },
            formatRelative = ::renderRelative,
        )

    private fun vehicleState(
        batteryLevel: Long = 58,
        isCharging: Boolean = false,
    ): VehicleState =
        VehicleState(
            batteryLevel = batteryLevel,
            chargeRate = 0.0,
            chargerPower = 0.0,
            idealRange = 0.0,
            insideTemp = 21.0,
            isCharging = isCharging,
            isClimateOn = false,
            isLocked = true,
            latitude = 0.0,
            longitude = 0.0,
            odometer = 0.0,
            outsideTemp = 18.0,
            power = 0.0,
            ratedRange = 0.0,
            sentryMode = false,
            softwareVersion = "2026.0",
            speed = 0.0,
            state = "online",
            timeToFullCharge = 0.0,
            vehicleId = 1,
        )

    private fun data(
        signals: Map<String, SignalEnvelope> = emptyMap(),
        state: VehicleState? = null,
    ): ChargingScheduleData = ChargingScheduleData(signals = signals, state = state)

    private fun project(
        data: ChargingScheduleData,
        size: ChargingScheduleSize = ChargingScheduleRegistration.defaultSize,
    ): ChargingScheduleDisplay = ChargingScheduleProjection.project(data, size, strings())

    // ---- signal parse ---------------------------------------------------------------

    @Test
    fun parseExtractsAllTypedFields() {
        val signals =
            mapOf(
                ScheduleSignalKeys.MODE to text("StartAt"),
                ScheduleSignalKeys.PENDING to bool(true),
                ScheduleSignalKeys.START_TIME to text("2026-06-11T23:00:00Z"),
                ScheduleSignalKeys.DEPARTURE_TIME to text("2026-06-12T07:30:00Z"),
                ScheduleSignalKeys.CHARGE_LIMIT to num(80.0),
            )
        val parsed = ChargingScheduleProjection.parseScheduleSignals(signals)
        assertEquals("StartAt", parsed.mode)
        assertTrue(parsed.pending)
        assertEquals("2026-06-11T23:00:00Z", parsed.startTime)
        assertEquals("2026-06-12T07:30:00Z", parsed.departureTime)
        assertEquals(80.0, parsed.chargeLimit!!, 0.0001)
    }

    @Test
    fun pendingCoercionMatchesWeb() {
        assertTrue(parsePending(bool(true)))
        assertFalse(parsePending(bool(false)))
        assertTrue(parsePending(text("true")))
        assertFalse(parsePending(text("false")))
        assertFalse(ChargingScheduleProjection.parseScheduleSignals(emptyMap()).pending)
    }

    @Test
    fun wrongTypedFieldsCollapseToNull() {
        val signals =
            mapOf(
                // mode is numeric (not a string) and chargeLimit is textual (not a number).
                ScheduleSignalKeys.MODE to num(3.0),
                ScheduleSignalKeys.CHARGE_LIMIT to text("80"),
            )
        val parsed = ChargingScheduleProjection.parseScheduleSignals(signals)
        assertNull(parsed.mode)
        assertNull(parsed.chargeLimit)
    }

    // ---- hasScheduleData (web `hasScheduleData`) ------------------------------------

    @Test
    fun hasScheduleDataTrueForAnyOfModeStartLimit() {
        assertTrue(ChargingScheduleProjection.hasScheduleData(parse(ScheduleSignalKeys.MODE to text("Off"))))
        assertTrue(ChargingScheduleProjection.hasScheduleData(parse(ScheduleSignalKeys.START_TIME to text("t"))))
        assertTrue(ChargingScheduleProjection.hasScheduleData(parse(ScheduleSignalKeys.CHARGE_LIMIT to num(70.0))))
    }

    @Test
    fun hasScheduleDataFalseWhenOnlyDepartureOrPending() {
        // Departure time + pending alone do NOT count as schedule data (web omits them from the gate).
        val parsed =
            ChargingScheduleProjection.parseScheduleSignals(
                mapOf(
                    ScheduleSignalKeys.DEPARTURE_TIME to text("2026-06-12T07:30:00Z"),
                    ScheduleSignalKeys.PENDING to bool(true),
                ),
            )
        assertFalse(ChargingScheduleProjection.hasScheduleData(parsed))
        assertFalse(ChargingScheduleProjection.hasScheduleData(ChargingScheduleProjection.parseScheduleSignals(emptyMap())))
    }

    // ---- mode label + tone (web modeLabel / modeBadgeVariant) -----------------------

    @Test
    fun modeLabelMapsKnownUnknownAndNull() {
        val s = strings()
        assertEquals("Start At", ChargingScheduleProjection.modeLabel("StartAt", s))
        assertEquals("Depart By", ChargingScheduleProjection.modeLabel("DepartBy", s))
        assertEquals("Off", ChargingScheduleProjection.modeLabel("Off", s))
        assertEquals("Weird", ChargingScheduleProjection.modeLabel("Weird", s))
        assertEquals("Unknown", ChargingScheduleProjection.modeLabel(null, s))
    }

    @Test
    fun modeToneMatchesWeb() {
        assertEquals(ChargeScheduleModeTone.Success, ChargingScheduleProjection.modeTone("StartAt"))
        assertEquals(ChargeScheduleModeTone.Success, ChargingScheduleProjection.modeTone("DepartBy"))
        assertEquals(ChargeScheduleModeTone.Neutral, ChargingScheduleProjection.modeTone("Off"))
        assertEquals(ChargeScheduleModeTone.Warning, ChargingScheduleProjection.modeTone("Weird"))
        assertEquals(ChargeScheduleModeTone.Warning, ChargingScheduleProjection.modeTone(null))
    }

    // ---- timeline projection (web timelineItems) ------------------------------------

    @Test
    fun timelineProjectsOrderGlyphToneAndContent() {
        val display =
            project(
                data(
                    mapOf(
                        ScheduleSignalKeys.MODE to text("StartAt"),
                        ScheduleSignalKeys.PENDING to bool(true),
                        ScheduleSignalKeys.START_TIME to text("start-iso"),
                        ScheduleSignalKeys.DEPARTURE_TIME to text("depart-iso"),
                        ScheduleSignalKeys.CHARGE_LIMIT to num(80.0),
                    ),
                ),
            )
        assertEquals(3, display.timelineRows.size)

        val start = display.timelineRows[0]
        assertEquals(ScheduleGlyph.Zap, start.glyph)
        assertEquals(ScheduleTone.Success, start.tone)
        assertEquals("Start Charging", start.title)
        assertEquals("Pending", start.subtitle)
        assertEquals("start-iso", start.time)
        assertEquals("Start Charging, start-iso, Pending", start.contentDescription)

        val depart = display.timelineRows[1]
        assertEquals(ScheduleGlyph.Clock, depart.glyph)
        assertEquals(ScheduleTone.Info, depart.tone)
        assertEquals("Departure", depart.title)
        assertNull(depart.subtitle)
        assertEquals("depart-iso", depart.time)

        val target = display.timelineRows[2]
        assertEquals(ScheduleGlyph.BatteryFull, target.glyph)
        assertEquals(ScheduleTone.Warning, target.tone)
        assertEquals("Target Limit", target.title)
        assertEquals("80%", target.time)
        assertEquals("Target Limit, 80%", target.contentDescription)
    }

    @Test
    fun startRowSubtitleNullWhenNotPending() {
        val display = project(data(mapOf(ScheduleSignalKeys.START_TIME to text("start-iso"))))
        assertEquals(1, display.timelineRows.size)
        assertNull(display.timelineRows.single().subtitle)
    }

    @Test
    fun timelineOmitsAbsentRows() {
        val display = project(data(mapOf(ScheduleSignalKeys.CHARGE_LIMIT to num(90.0))))
        assertEquals(1, display.timelineRows.size)
        assertEquals(ScheduleGlyph.BatteryFull, display.timelineRows.single().glyph)
        assertTrue(display.hasTimelineRows)
    }

    @Test
    fun noTimelineRowsWhenModeOnly() {
        // mode='Off' alone ⇒ has schedule data but no scheduled times ⇒ the "no times" note.
        val display = project(data(mapOf(ScheduleSignalKeys.MODE to text("Off"))))
        assertTrue(display.hasScheduleData)
        assertFalse(display.hasTimelineRows)
        assertEquals("No scheduled times set", display.noTimesLabel)
    }

    // ---- compact hero + charge-limit formatting -------------------------------------

    @Test
    fun compactValueTextIsLimitOrEmDash() {
        val withLimit = project(data(mapOf(ScheduleSignalKeys.CHARGE_LIMIT to num(80.0))))
        assertEquals("80%", withLimit.compactValueText)
        assertEquals("Charge Limit, 80%", withLimit.compactContentDescription)

        val noLimit = project(data(mapOf(ScheduleSignalKeys.MODE to text("StartAt"))))
        assertEquals(EM_DASH, noLimit.compactValueText)
    }

    @Test
    fun formatSocMatchesWebNumberInterpolation() {
        assertEquals("80", ChargingScheduleProjection.formatSoc(80.0))
        assertEquals("90", ChargingScheduleProjection.formatSoc(90.0))
        assertEquals("80.5", ChargingScheduleProjection.formatSoc(80.5))
    }

    // ---- tall state row (web isTall && state) ---------------------------------------

    @Test
    fun stateRowOnlyWhenTallAndStatePresent() {
        val signals = mapOf(ScheduleSignalKeys.MODE to text("StartAt"))
        assertTrue(project(data(signals, vehicleState()), ChargingScheduleSize(2, 2)).showStateRow)
        assertFalse(project(data(signals, state = null), ChargingScheduleSize(2, 2)).showStateRow)
        // 1×1 is not "tall", so no detail row even with state.
        assertFalse(project(data(signals, vehicleState()), ChargingScheduleSize(1, 1)).showStateRow)
    }

    @Test
    fun stateRowValuesReflectVehicleState() {
        val signals = mapOf(ScheduleSignalKeys.MODE to text("StartAt"))
        val charging = project(data(signals, vehicleState(batteryLevel = 58, isCharging = true)))
        assertEquals("58%", charging.currentLevelValue)
        assertEquals("Current Level", charging.currentLevelLabel)
        assertEquals("Charging", charging.statusValue)

        val idle = project(data(signals, vehicleState(batteryLevel = 42, isCharging = false)))
        assertEquals("42%", idle.currentLevelValue)
        assertEquals("Not Charging", idle.statusValue)
    }

    @Test
    fun emptyDataProjectsNoScheduleData() {
        val display = project(data())
        assertFalse(display.hasScheduleData)
        assertFalse(display.hasTimelineRows)
    }

    // ---- size semantics -------------------------------------------------------------

    @Test
    fun sizeCompactAndTallFollowWeb() {
        assertTrue(ChargingScheduleSize(1, 1).isCompact)
        assertFalse(ChargingScheduleSize(1, 2).isCompact)
        assertFalse(ChargingScheduleSize(2, 1).isCompact)
        assertTrue(ChargingScheduleSize(2, 2).isTall)
        assertFalse(ChargingScheduleSize(1, 1).isTall)
    }

    // ---- registry metadata (web registry/charging.ts) -------------------------------

    @Test
    fun registryMetadataMatchesWebRegistry() {
        assertEquals("charging-schedule", ChargingScheduleRegistration.ID)
        assertEquals("charging", ChargingScheduleRegistration.CATEGORY)
        assertEquals("ChargingScheduleWidget", ChargingScheduleRegistration.SLUG)
        assertEquals(ChargingScheduleSize(cols = 2, rows = 2), ChargingScheduleRegistration.defaultSize)
        assertEquals(ChargingScheduleSize(cols = 1, rows = 2), ChargingScheduleRegistration.minSize)
        assertEquals(ChargingScheduleSize(cols = 4, rows = 40), ChargingScheduleRegistration.maxSize)
    }

    @Test
    fun registryBoundsAndClampHonourMinMax() {
        assertTrue(ChargingScheduleRegistration.isWithinBounds(ChargingScheduleSize(2, 2)))
        assertFalse(ChargingScheduleRegistration.isWithinBounds(ChargingScheduleSize(0, 1)))
        assertFalse(ChargingScheduleRegistration.isWithinBounds(ChargingScheduleSize(5, 50)))
        assertEquals(
            ChargingScheduleSize(cols = 1, rows = 2),
            ChargingScheduleRegistration.clamp(ChargingScheduleSize(0, 0)),
        )
        assertEquals(
            ChargingScheduleSize(cols = 4, rows = 40),
            ChargingScheduleRegistration.clamp(ChargingScheduleSize(9, 99)),
        )
    }

    // ---- vehicle-id resolution (web `vehicleId ?? vehicles[0].id ?? 0`) -------------

    @Test
    fun resolveVehicleIdMatchesWebFallback() {
        assertEquals(7L, resolveVehicleId(7L, listOf(vehicle(3), vehicle(4))))
        assertEquals(0L, resolveVehicleId(0L, listOf(vehicle(3)))) // explicit 0 wins (JS `??`)
        assertEquals(3L, resolveVehicleId(null, listOf(vehicle(3), vehicle(4))))
        assertEquals(0L, resolveVehicleId(null, emptyList()))
        assertEquals(0L, resolveVehicleId(null, null))
    }

    // ---- helpers --------------------------------------------------------------------

    private fun parse(pair: Pair<String, SignalEnvelope>): ScheduleSignals = ChargingScheduleProjection.parseScheduleSignals(mapOf(pair))

    private fun parsePending(envelope: SignalEnvelope): Boolean =
        ChargingScheduleProjection.parseScheduleSignals(mapOf(ScheduleSignalKeys.PENDING to envelope)).pending

    private fun vehicle(id: Long): Vehicle =
        Vehicle(
            createdAt = EPOCH,
            displayName = "Car $id",
            enrolledAt = EPOCH,
            id = id,
            teslaId = id,
            timezone = "UTC",
            updatedAt = EPOCH,
            vin = "VIN$id",
        )

    private fun renderRelative(age: FreshnessAge): String =
        when (age) {
            FreshnessAge.Unknown -> EM_DASH
            FreshnessAge.JustNow -> "just now"
            is FreshnessAge.Seconds -> "${age.value}s ago"
            is FreshnessAge.Minutes -> "${age.value}m ago"
            is FreshnessAge.Hours -> "${age.value}h ago"
            is FreshnessAge.Days -> "${age.value}d ago"
            is FreshnessAge.Weeks -> "${age.value}w ago"
        }

    private companion object {
        val EPOCH: Instant = Instant.fromEpochMilliseconds(0)
    }
}
