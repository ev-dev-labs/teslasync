package io.teslasync.android.featureviews.batterycomparison

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Off-device unit coverage of the pure [BatteryComparisonProjection] + the [foldBatteryReadings] reducer —
 * the native port of every derivation the web component performs before returning JSX
 * (the `batteryColor` band, the `${level}%` meter width, the `display_name || vin` label, and the `bars`
 * null-state filter). Run by the `:android:testReleaseUnitTest` gate; no Compose, no Android, no coroutines.
 */
class BatteryComparisonProjectionTest {
    // ── BatteryBand: the web `batteryColor` STRICT `>` thresholds (60 / 25) ───────────────────────────────
    @Test
    fun bandIsGoodOnlyAboveSixty() {
        assertEquals(BatteryBand.Good, BatteryBand.fromLevel(61))
        assertEquals(BatteryBand.Good, BatteryBand.fromLevel(100))
    }

    @Test
    fun bandIsWarningFromTwentySixThroughSixty() {
        // Strictly greater-than: 60 itself is NOT good (web `level > 60`), and 26 is the first warning.
        assertEquals(BatteryBand.Warning, BatteryBand.fromLevel(60))
        assertEquals(BatteryBand.Warning, BatteryBand.fromLevel(26))
    }

    @Test
    fun bandIsCriticalAtOrBelowTwentyFive() {
        // Strictly greater-than: 25 itself is NOT warning (web `level > 25`).
        assertEquals(BatteryBand.Critical, BatteryBand.fromLevel(25))
        assertEquals(BatteryBand.Critical, BatteryBand.fromLevel(0))
    }

    // ── barFraction: the web `${level}%` width clamped to [0,100]/100 ─────────────────────────────────────
    @Test
    fun barFractionMapsLevelToZeroToOne() {
        assertEquals(0.82f, BatteryComparisonProjection.barFraction(82), 1e-6f)
        assertEquals(0f, BatteryComparisonProjection.barFraction(0), 1e-6f)
        assertEquals(1f, BatteryComparisonProjection.barFraction(100), 1e-6f)
    }

    @Test
    fun barFractionClampsOutOfRangeLevels() {
        assertEquals(1f, BatteryComparisonProjection.barFraction(150), 1e-6f)
        assertEquals(0f, BatteryComparisonProjection.barFraction(-10), 1e-6f)
    }

    // ── displayName: the web `display_name || vin` ───────────────────────────────────────────────────────
    @Test
    fun displayNamePrefersDisplayNameThenFallsBackToVin() {
        assertEquals("Garage Car", BatteryComparisonProjection.displayName("Garage Car", "VIN123"))
        assertEquals("VIN123", BatteryComparisonProjection.displayName("", "VIN123"))
        assertEquals("VIN123", BatteryComparisonProjection.displayName("   ", "VIN123"))
    }

    @Test
    fun percentLabelIsRawLevelPlusSign() {
        assertEquals("82%", BatteryComparisonProjection.percentLabel(82))
        assertEquals("0%", BatteryComparisonProjection.percentLabel(0))
    }

    // ── project: the web `bars` filter + per-row derivation ──────────────────────────────────────────────
    @Test
    fun projectDropsVehiclesWithNoState() {
        val readings =
            listOf(
                VehicleBatteryReading(1L, "Online", vehicleState(batteryLevel = 70)),
                VehicleBatteryReading(2L, "Offline", state = null),
                VehicleBatteryReading(3L, "Low", vehicleState(batteryLevel = 12)),
            )

        val rows = BatteryComparisonProjection.project(readings)

        assertEquals(listOf(1L, 3L), rows.map { it.vehicleId })
        assertEquals(BatteryBand.Good, rows.first().band)
        assertEquals(BatteryBand.Critical, rows.last().band)
    }

    @Test
    fun projectCarriesSiRangeAndLevelUnchanged() {
        val rows =
            BatteryComparisonProjection.project(
                listOf(VehicleBatteryReading(9L, "Car", vehicleState(batteryLevel = 47, ratedRange = 230_000.0))),
            )

        val row = rows.single()
        assertEquals(47, row.level)
        assertEquals(BatteryBand.Warning, row.band)
        assertEquals(230_000.0, row.rangeMeters, 1e-6)
    }

    @Test
    fun isEmptyReflectsRowPresence() {
        assertTrue(BatteryComparisonProjection.isEmpty(emptyList()))
        assertFalse(
            BatteryComparisonProjection.isEmpty(
                BatteryComparisonProjection.project(listOf(VehicleBatteryReading(1L, "Car", vehicleState(50)))),
            ),
        )
    }

    // ── foldBatteryReadings: the cache-then-network reduction (pure) ──────────────────────────────────────
    @Test
    fun foldEmitsLoadingWithNoCacheWhileStatesFirstLoad() {
        val vehicles = listOf(vehicle(1L))
        val result =
            foldBatteryReadings(
                vehiclesRes = success(vehicles),
                vehicles = vehicles,
                states = listOf(Resource.Loading(cached = null, fetchedAt = null, stale = false)),
            )
        assertTrue(result is Resource.Loading)
        assertEquals(null, result.cached)
    }

    @Test
    fun foldEmitsEmptySuccessWhenEveryVehicleIsOffline() {
        val vehicles = listOf(vehicle(1L), vehicle(2L))
        val result =
            foldBatteryReadings(
                vehiclesRes = success(vehicles),
                vehicles = vehicles,
                states = listOf(successEnvelope(state = null), successEnvelope(state = null)),
            )
        assertTrue(result is Resource.Success)
        assertTrue(result.cached!!.isEmpty())
    }

    @Test
    fun foldEmitsSuccessRowsWhenStatesResolve() {
        val vehicles = listOf(vehicle(1L), vehicle(2L))
        val result =
            foldBatteryReadings(
                vehiclesRes = success(vehicles),
                vehicles = vehicles,
                states = listOf(successEnvelope(vehicleState(80)), successEnvelope(vehicleState(20))),
            )
        assertTrue(result is Resource.Success)
        assertEquals(listOf(1L, 2L), result.cached!!.map { it.vehicleId })
    }

    @Test
    fun foldKeepsCachedRowsAsOfflineWhenAStateFails() {
        val vehicles = listOf(vehicle(1L))
        val result =
            foldBatteryReadings(
                vehiclesRes = success(vehicles),
                vehicles = vehicles,
                states =
                    listOf(
                        Resource.Error(
                            cached = VehicleStateEnvelope(vehicleState(55), true),
                            fetchedAt = 5L,
                            stale = true,
                            error = ApiError.Network(),
                        ),
                    ),
            )
        assertTrue(result is Resource.Error)
        assertEquals(1, result.cached!!.size)
        assertTrue(result.stale)
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────────────
    private fun success(vehicles: List<Vehicle>): Resource<List<Vehicle>> = Resource.Success(vehicles, fetchedAt = 100L, stale = false)

    private fun successEnvelope(state: VehicleState?): Resource<VehicleStateEnvelope> =
        Resource.Success(VehicleStateEnvelope(state, live = false), fetchedAt = 100L, stale = false)

    private fun vehicleState(
        batteryLevel: Long,
        ratedRange: Double = 300_000.0,
        vehicleId: Long = 1L,
    ): VehicleState =
        VehicleState(
            batteryLevel = batteryLevel,
            chargeRate = 0.0,
            chargerPower = 0.0,
            idealRange = ratedRange,
            insideTemp = 20.0,
            isCharging = false,
            isClimateOn = false,
            isLocked = true,
            latitude = 0.0,
            longitude = 0.0,
            odometer = 0.0,
            outsideTemp = 15.0,
            power = 0.0,
            ratedRange = ratedRange,
            sentryMode = false,
            softwareVersion = "2026.4.1",
            speed = 0.0,
            state = "online",
            timeToFullCharge = 0.0,
            vehicleId = vehicleId,
        )

    private fun vehicle(id: Long): Vehicle =
        Vehicle(
            createdAt = Instant.parse("2026-01-01T00:00:00Z"),
            displayName = "Car $id",
            enrolledAt = Instant.parse("2026-01-01T00:00:00Z"),
            id = id,
            teslaId = 1000 + id,
            timezone = "UTC",
            updatedAt = Instant.parse("2026-01-01T00:00:00Z"),
            vin = "VIN$id",
        )
}
