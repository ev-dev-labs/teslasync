package io.teslasync.android.dashboard.widgets.vehiclehero

import io.teslasync.shared.core.api.generated.VehicleState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the VehicleHeroWidget's pure logic — the registry metadata + footprint clamp
 * (web/src/features/dashboard/widgets/registry/vehicle.ts `vehicle-hero`) and the firmware-fallback chain the
 * web widget resolves before handing it to `VehicleHero`
 * (web `live.version || live.swUpdateVersion || stateData?.state?.software_version || '\u2014'`).
 */
class VehicleHeroWidgetModelTest {
    @Test
    fun registrationMirrorsWebRegistry() {
        assertEquals("vehicle-hero", VehicleHeroWidgetRegistration.ID)
        assertEquals("vehicle", VehicleHeroWidgetRegistration.CATEGORY)
        assertEquals("VehicleHeroWidget", VehicleHeroWidgetRegistration.SLUG)
        assertEquals(VehicleHeroWidgetSize(cols = 2, rows = 9), VehicleHeroWidgetRegistration.defaultSize)
        assertEquals(VehicleHeroWidgetSize(cols = 2, rows = 4), VehicleHeroWidgetRegistration.minSize)
        assertEquals(VehicleHeroWidgetSize(cols = 4, rows = 40), VehicleHeroWidgetRegistration.maxSize)
    }

    @Test
    fun registrationClampsAndChecksBounds() {
        assertEquals(VehicleHeroWidgetSize(cols = 4, rows = 40), VehicleHeroWidgetRegistration.clamp(VehicleHeroWidgetSize(9, 99)))
        assertEquals(VehicleHeroWidgetSize(cols = 2, rows = 4), VehicleHeroWidgetRegistration.clamp(VehicleHeroWidgetSize(0, 0)))
        assertTrue(VehicleHeroWidgetRegistration.isWithinBounds(VehicleHeroWidgetSize(2, 9)))
        assertFalse(VehicleHeroWidgetRegistration.isWithinBounds(VehicleHeroWidgetSize(1, 9)))
        assertFalse(VehicleHeroWidgetRegistration.isWithinBounds(VehicleHeroWidgetSize(2, 41)))
    }

    @Test
    fun firmwarePrefersLiveRunningVersion() {
        assertEquals(
            "2025.20.5",
            resolveFirmwareVersion(LiveFirmware(version = "2025.20.5", swUpdateVersion = "2025.21.0"), state("2025.1.0")),
        )
    }

    @Test
    fun firmwareFallsBackToStagedOtaVersionWhenRunningBlank() {
        assertEquals(
            "2025.21.0",
            resolveFirmwareVersion(LiveFirmware(version = "", swUpdateVersion = "2025.21.0"), state("2025.1.0")),
        )
    }

    @Test
    fun firmwareFallsBackToStateSoftwareVersionWhenLiveBlank() {
        assertEquals("2025.1.0", resolveFirmwareVersion(LiveFirmware.Empty, state("2025.1.0")))
    }

    @Test
    fun firmwareFallsBackToEmDashWhenEverythingAbsent() {
        assertEquals("\u2014", resolveFirmwareVersion(LiveFirmware.Empty, state("")))
        assertEquals("\u2014", resolveFirmwareVersion(LiveFirmware.Empty, null))
    }

    @Test
    fun firmwareResolvesFromLiveWhenStateIsNull() {
        assertEquals("2025.20.5", resolveFirmwareVersion(LiveFirmware(version = "2025.20.5", swUpdateVersion = ""), null))
    }

    @Test
    fun liveFirmwareEmptyHasBlankFields() {
        assertEquals("", LiveFirmware.Empty.version)
        assertEquals("", LiveFirmware.Empty.swUpdateVersion)
    }

    private fun state(softwareVersion: String): VehicleState =
        VehicleState(
            batteryLevel = 72,
            chargeRate = 0.0,
            chargerPower = 0.0,
            idealRange = 402_336.0,
            insideTemp = 21.0,
            isCharging = false,
            isClimateOn = false,
            isLocked = true,
            latitude = 0.0,
            longitude = 0.0,
            odometer = 0.0,
            outsideTemp = 9.0,
            power = 0.0,
            ratedRange = 402_336.0,
            sentryMode = false,
            softwareVersion = softwareVersion,
            speed = 0.0,
            state = "online",
            timeToFullCharge = 0.0,
            vehicleId = 5,
        )
}
