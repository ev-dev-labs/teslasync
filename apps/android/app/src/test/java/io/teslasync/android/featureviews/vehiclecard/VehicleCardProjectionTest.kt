// Off-device unit coverage for the VehicleCard feature view's pure model (P3 acceptance: adapter +
// per-state + a11y-label tests). Exercises the vehicle → display projection (the web `getVehicleStatus`
// derivation, the `batteryColor` accent thresholds, the `display_name || vin` name and the model/trim/vin
// subtitle, and the SI→display range / interior / odometer conversions through the shared UnitFormatter /
// `useUnits`), the always-rendered car-viz defaults when no live state is present (web `?? 50 / ?? true`), and
// the stats-region surface classifier the composable switches on (per-state coverage). No Compose / Android /
// HTTP — runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehiclecard

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale
import kotlin.time.Instant

class VehicleCardProjectionTest {
    private val metric = UnitFormatter.default()
    private val imperial =
        UnitFormatter(UnitPreferences.fromSettings(Json.parseToJsonElement("""{"unit_of_length":"mi","unit_of_temp":"F"}""")))

    private val strings =
        VehicleCardStrings(
            interior = "Interior",
            charging = "Charging",
            viewDetails = "View details",
            removeVehicle = "Remove vehicle",
            asleep = "Vehicle asleep",
        )

    // ── deriveVehicleCardStatus (web getVehicleStatus) ───────────────────────────
    @Test
    fun statusIsOfflineWhenNoState() {
        assertEquals(CARD_STATUS_OFFLINE, deriveVehicleCardStatus(null))
    }

    @Test
    fun statusIsChargingWhenCharging() {
        assertEquals(CARD_STATUS_CHARGING, deriveVehicleCardStatus(vehicleState(isCharging = true, state = "online")))
    }

    @Test
    fun statusIsDrivingWhenMoving() {
        assertEquals(CARD_STATUS_DRIVING, deriveVehicleCardStatus(vehicleState(speed = 12.0, state = "online")))
    }

    @Test
    fun statusPassesThroughKnownFsmState() {
        assertEquals("parked", deriveVehicleCardStatus(vehicleState(state = "parked")))
        assertEquals("asleep", deriveVehicleCardStatus(vehicleState(state = "ASLEEP")))
    }

    @Test
    fun statusFallsBackToOnlineForUnknownState() {
        assertEquals(CARD_STATUS_ONLINE, deriveVehicleCardStatus(vehicleState(state = "something-weird")))
    }

    // ── batteryAccentFor (web batteryColor thresholds) ───────────────────────────
    @Test
    fun batteryAccentThresholds() {
        assertEquals(BatteryAccent.Good, batteryAccentFor(80))
        assertEquals(BatteryAccent.Good, batteryAccentFor(61))
        assertEquals(BatteryAccent.Warn, batteryAccentFor(60))
        assertEquals(BatteryAccent.Warn, batteryAccentFor(26))
        assertEquals(BatteryAccent.Danger, batteryAccentFor(25))
        assertEquals(BatteryAccent.Danger, batteryAccentFor(5))
    }

    // ── name / subtitle ──────────────────────────────────────────────────────────
    @Test
    fun nameFallsBackToVinWhenDisplayNameBlank() {
        assertEquals("My Car", vehicleCardName(vehicle(displayName = "My Car")))
        assertEquals("VIN1", vehicleCardName(vehicle(displayName = "  ", vin = "VIN1")))
    }

    @Test
    fun subtitleJoinsModelTrimAndVin() {
        val subtitle = vehicleCardSubtitle(vehicle(model = "Model 3", trim = "Long Range", vin = "VIN1"))
        assertEquals("Model 3 Long Range $CARD_DOT VIN1", subtitle)
    }

    @Test
    fun subtitleIsBareVinWhenNoModelOrTrim() {
        assertEquals("VIN9", vehicleCardSubtitle(vehicle(model = null, trim = null, vin = "VIN9")))
    }

    // ── project: content ─────────────────────────────────────────────────────────
    @Test
    fun projectsContentFromLiveState() {
        val display =
            VehicleCardProjection.project(
                vehicle = vehicle(),
                state =
                    vehicleState(
                        batteryLevel = 72,
                        ratedRange = 350_000.0,
                        idealRange = 380_000.0,
                        insideTemp = 21.5,
                        outsideTemp = 12.0,
                    ),
                formatter = metric,
                strings = strings,
                locale = Locale.US,
            )

        assertTrue(display.hasState)
        assertEquals(CARD_STATUS_ONLINE, display.status)
        assertEquals(72, display.batteryLevel)
        assertEquals("72%", display.batteryPercentText)
        assertEquals(BatteryAccent.Good, display.batteryAccent)
        // Range reads rated_range (not ideal_range) and is SI→display formatted with its unit.
        assertEquals(metric.distance(350_000.0), display.rangeText)
        assertNotEquals(metric.distance(380_000.0), display.rangeText)
        // Interior reads inside_temp (not outside_temp).
        assertEquals(metric.temperature(21.5), display.interiorText)
        assertNotEquals(metric.temperature(12.0), display.interiorText)
        // Odometer is whole-number + grouped in the user's distance unit.
        assertEquals("42,000", display.odometerText)
        assertEquals("km", display.distanceUnitLabel)
        assertFalse(display.isCharging)
        assertTrue(display.isLocked)
        assertEquals(72.0, display.vizBatteryLevel, 0.0)
    }

    @Test
    fun projectsChargingFiguresAndStatus() {
        val display =
            VehicleCardProjection.project(
                vehicle = vehicle(),
                state = vehicleState(batteryLevel = 54, isCharging = true, chargerPower = 48.4, state = "charging"),
                formatter = metric,
                strings = strings,
                locale = Locale.US,
            )

        assertEquals(CARD_STATUS_CHARGING, display.status)
        assertTrue(display.isCharging)
        assertEquals("48.4 kW", display.chargerPowerText)
        assertEquals(BatteryAccent.Warn, display.batteryAccent)
    }

    @Test
    fun imperialFormatterChangesUnitsButNotTheSiSource() {
        val display =
            VehicleCardProjection.project(
                vehicle = vehicle(),
                state = vehicleState(insideTemp = 20.0),
                formatter = imperial,
                strings = strings,
                locale = Locale.US,
            )

        assertEquals("mi", display.distanceUnitLabel)
        assertTrue(display.interiorText.endsWith("\u00B0F"))
    }

    // ── project: asleep / no state (the never-blank header-only presentation) ─────
    @Test
    fun projectsAsleepHeaderWhenNoState() {
        val display =
            VehicleCardProjection.project(
                vehicle = vehicle(displayName = "Asleep Car"),
                state = null,
                formatter = metric,
                strings = strings,
                locale = Locale.US,
            )

        assertEquals("Asleep Car", display.name)
        assertEquals(CARD_STATUS_OFFLINE, display.status)
        assertFalse(display.hasState)
        assertEquals(CARD_EM_DASH, display.batteryPercentText)
        assertEquals(CARD_EM_DASH, display.rangeText)
        assertEquals(CARD_EM_DASH, display.interiorText)
        assertEquals(CARD_EM_DASH, display.odometerText)
        // Car-viz defaults so the viz never renders empty (web `?? 50 / ?? true`).
        assertEquals(CARD_VIZ_DEFAULT_BATTERY, display.vizBatteryLevel, 0.0)
        assertTrue(display.isLocked)
        assertFalse(display.isCharging)
        assertFalse(display.sentryMode)
    }

    @Test
    fun accessibleSummaryCarriesNameStatusAndBatteryButNeverTheVin() {
        val display =
            VehicleCardProjection.project(
                vehicle = vehicle(displayName = "Aria", vin = "SECRETVIN"),
                state = vehicleState(batteryLevel = 80, isCharging = true),
                formatter = metric,
                strings = strings,
                locale = Locale.US,
            )

        assertTrue(display.accessibleSummary.contains("Aria"))
        assertTrue(display.accessibleSummary.contains("80%"))
        assertTrue(display.accessibleSummary.contains(strings.charging))
        assertFalse(display.accessibleSummary.contains("SECRETVIN"))
    }

    // ── vehicleCardStatsSurface (per-state classifier) ───────────────────────────
    @Test
    fun statsSurfaceClassifiesEveryState() {
        assertEquals(VehicleCardStatsSurface.Loading, vehicleCardStatsSurface(UiState.loading()))
        assertEquals(
            VehicleCardStatsSurface.Error,
            vehicleCardStatsSurface(UiState(UiPhase.Error, errorKind = ErrorKind.Network)),
        )
        assertEquals(
            VehicleCardStatsSurface.Content,
            vehicleCardStatsSurface(UiState(UiPhase.Content, data = VehicleStateEnvelope(vehicleState(), live = true))),
        )
        assertEquals(
            VehicleCardStatsSurface.Empty,
            vehicleCardStatsSurface(UiState(UiPhase.Empty, data = VehicleStateEnvelope(null, live = false))),
        )
    }

    @Test
    fun staleCachedStateStaysContentNotBlanked() {
        val offline =
            UiState(
                phase = UiPhase.Content,
                data = VehicleStateEnvelope(vehicleState(batteryLevel = 40), live = true),
                stale = true,
                errorKind = ErrorKind.Network,
            )
        assertEquals(VehicleCardStatsSurface.Content, vehicleCardStatsSurface(offline))
        assertTrue(offline.isOffline)
        assertTrue(offline.canRetry)
    }

    // ── helpers ──────────────────────────────────────────────────────────────────
    private fun vehicle(
        displayName: String = "My Model 3",
        vin: String = "5YJ3E1EA7KF000001",
        model: String? = "Model 3",
        trim: String? = "Long Range",
    ): Vehicle =
        Vehicle(
            createdAt = Instant.parse("2026-01-01T00:00:00Z"),
            displayName = displayName,
            enrolledAt = Instant.parse("2026-01-01T00:00:00Z"),
            id = 1L,
            teslaId = 42L,
            timezone = "UTC",
            updatedAt = Instant.parse("2026-06-01T00:00:00Z"),
            vin = vin,
            model = model,
            trimLevel = trim,
        )

    @Suppress("LongParameterList")
    private fun vehicleState(
        batteryLevel: Long = 60,
        ratedRange: Double = 300_000.0,
        idealRange: Double = 320_000.0,
        insideTemp: Double = 20.0,
        outsideTemp: Double = 10.0,
        speed: Double = 0.0,
        isCharging: Boolean = false,
        chargerPower: Double = 0.0,
        isLocked: Boolean = true,
        sentryMode: Boolean = false,
        state: String = "online",
    ): VehicleState =
        VehicleState(
            batteryLevel = batteryLevel,
            chargeRate = 0.0,
            chargerPower = chargerPower,
            idealRange = idealRange,
            insideTemp = insideTemp,
            isCharging = isCharging,
            isClimateOn = false,
            isLocked = isLocked,
            latitude = 0.0,
            longitude = 0.0,
            odometer = 42_000_000.0,
            outsideTemp = outsideTemp,
            power = 0.0,
            ratedRange = ratedRange,
            sentryMode = sentryMode,
            softwareVersion = "2026.20.1",
            speed = speed,
            state = state,
            timeToFullCharge = 0.0,
            vehicleId = 1L,
        )
}
