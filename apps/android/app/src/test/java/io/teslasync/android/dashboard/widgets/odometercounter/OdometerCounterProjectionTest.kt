package io.teslasync.android.dashboard.widgets.odometercounter

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.DurationUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.PowerUnitPref
import io.teslasync.shared.core.units.PressureUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the OdometerCounterWidget's pure logic — the SI→display unit conversion, the
 * web `fmtNumber` number contract (en-US grouping, fixed digits, half-expand rounding), the
 * `useVehicleState` + `useDrivingStats` state fold (loading / content / empty / error / offline / stats-error
 * tolerance), the `total_distance_km` parse, and the registry metadata. Mirrors the web spec
 * (web/src/features/dashboard/widgets/OdometerCounterWidget.tsx).
 */
class OdometerCounterProjectionTest {
    private fun prefs(distance: DistanceUnitPref = DistanceUnitPref.MI): UnitPref =
        UnitPref(
            distance = distance,
            speed = if (distance == DistanceUnitPref.MI) SpeedUnitPref.MPH else SpeedUnitPref.KMH,
            temperature = TemperatureUnitPref.CELSIUS,
            pressure = PressureUnitPref.KPA,
            energy = EnergyUnitPref.KWH,
            duration = DurationUnitPref.HOURS,
            power = PowerUnitPref.KW,
        )

    // SI inputs chosen to land on round display values: odometer 402336 m = 250 mi = 402.336 km;
    // total_distance_km field 80467.2 → 50 mi (it is passed verbatim through convertDistanceFromSI, exactly
    // as the web widget does — see OdometerCounterModel's PARITY NOTE) and 80.4672 km.
    private fun snapshot(
        odometerMeters: Double? = 402_336.0,
        totalDistanceKm: Double? = 80_467.2,
    ): OdometerSnapshot = OdometerSnapshot(odometerMeters, totalDistanceKm)

    private fun statsJson(totalDistanceKm: Double = 80_467.2): JsonElement = buildJsonObject { put("total_distance_km", totalDistanceKm) }

    private fun vehicleState(odometer: Double = 402_336.0): VehicleState =
        VehicleState(
            batteryLevel = 72,
            chargeRate = 0.0,
            chargerPower = 0.0,
            idealRange = 0.0,
            insideTemp = 0.0,
            isCharging = false,
            isClimateOn = false,
            isLocked = true,
            latitude = 0.0,
            longitude = 0.0,
            odometer = odometer,
            outsideTemp = 0.0,
            power = 0.0,
            ratedRange = 0.0,
            sentryMode = false,
            softwareVersion = "2025.1.0",
            speed = 0.0,
            state = "online",
            timeToFullCharge = 0.0,
            vehicleId = 5,
        )

    private fun envelope(state: VehicleState?): VehicleStateEnvelope = VehicleStateEnvelope(state = state, live = false)

    private fun loadingState(): Resource<VehicleStateEnvelope> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

    private fun loadingStats(): Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

    // ── project ───────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun projectConvertsOdometerAndTotalDrivenInMiles() {
        val display = OdometerCounterProjection.project(snapshot(), prefs(DistanceUnitPref.MI))
        assertEquals(250.0, display.odometerValue, 1e-6)
        assertEquals("250", display.odometerText)
        assertEquals("mi", display.unit)
        assertEquals("50 mi", display.totalDrivenText)
    }

    @Test
    fun projectHonorsKilometersUnit() {
        val display = OdometerCounterProjection.project(snapshot(), prefs(DistanceUnitPref.KM))
        assertEquals(402.336, display.odometerValue, 1e-6)
        assertEquals("402", display.odometerText)
        assertEquals("km", display.unit)
        assertEquals("80 km", display.totalDrivenText)
    }

    @Test
    fun projectShowsEmDashWhenNoTotalDriven() {
        val display = OdometerCounterProjection.project(snapshot(totalDistanceKm = null), prefs())
        assertEquals("\u2014", display.totalDrivenText)
    }

    @Test
    fun projectIsNullSafeWhenOdometerMissing() {
        val display = OdometerCounterProjection.project(snapshot(odometerMeters = null), prefs())
        assertEquals(0.0, display.odometerValue, 1e-6)
        assertEquals("0", display.odometerText)
    }

    // ── foldState (the useVehicleState + useDrivingStats shell) ─────────────────────────────────────────

    @Test
    fun foldStateLoadsWhileEitherFeedFirstLoads() {
        assertEquals(UiPhase.Loading, OdometerCounterProjection.foldState(loadingState(), loadingStats()).phase)
        // stats still first-loading keeps the skeleton even after the state feed resolves (web `stateLoading || statsLoading`).
        val stateReady = OdometerCounterProjection.foldState(Resource.Success(envelope(vehicleState()), 100L, false), loadingStats())
        assertEquals(UiPhase.Loading, stateReady.phase)
    }

    @Test
    fun foldStateProjectsContentWithParsedStats() {
        val result =
            OdometerCounterProjection.foldState(
                Resource.Success(envelope(vehicleState()), 100L, false),
                Resource.Success(statsJson(), 100L, false),
            )
        assertEquals(UiPhase.Content, result.phase)
        assertEquals(100L, result.fetchedAt)
        val data = requireNotNull(result.data)
        assertEquals(402_336.0, requireNotNull(data.odometerMeters), 1e-6)
        assertEquals(80_467.2, requireNotNull(data.totalDistanceKm), 1e-6)
    }

    @Test
    fun foldStateEmptyWhenNoDecodableVehicleState() {
        val result =
            OdometerCounterProjection.foldState(
                Resource.Success(envelope(null), 100L, false),
                Resource.Success(statsJson(), 100L, false),
            )
        assertEquals(UiPhase.Empty, result.phase)
    }

    @Test
    fun foldStateHardErrorWhenStateFailsWithNoCache() {
        val result =
            OdometerCounterProjection.foldState(
                Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network()),
                Resource.Success(statsJson(), 100L, false),
            )
        assertEquals(UiPhase.Error, result.phase)
        assertEquals(ErrorKind.Network, result.errorKind)
        assertTrue(result.canRetry)
    }

    @Test
    fun foldStateOfflineKeepsCachedStateWithRetry() {
        val result =
            OdometerCounterProjection.foldState(
                Resource.Error(cached = envelope(vehicleState()), fetchedAt = 100L, stale = true, error = ApiError.Timeout()),
                Resource.Success(statsJson(), 100L, false),
            )
        assertEquals(UiPhase.Content, result.phase)
        assertTrue(result.stale)
        assertTrue(result.isOffline)
        assertEquals(ErrorKind.Timeout, result.errorKind)
        assertTrue(result.canRetry)
    }

    @Test
    fun foldStateToleratesStatsErrorWithoutBlankingTheWidget() {
        val result =
            OdometerCounterProjection.foldState(
                Resource.Success(envelope(vehicleState()), 100L, false),
                Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network()),
            )
        // A stats failure never surfaces as the widget's error/offline chrome — vehicle state is primary.
        assertEquals(UiPhase.Content, result.phase)
        assertFalse(result.hasError)
        assertNull(result.data?.totalDistanceKm)
        // The breakdown shows the em-dash fallback, exactly as the web `stats?.totalDistanceKm ?? null` does.
        assertEquals("\u2014", OdometerCounterProjection.project(result.data!!, prefs()).totalDrivenText)
    }

    @Test
    fun foldStateKeepsContentWhenStatsRefreshesOverCache() {
        val result =
            OdometerCounterProjection.foldState(
                Resource.Success(envelope(vehicleState()), 100L, false),
                Resource.Loading(cached = statsJson(), fetchedAt = 90L, stale = false),
            )
        assertEquals(UiPhase.Content, result.phase)
        assertEquals(80_467.2, result.data?.totalDistanceKm!!, 1e-6)
    }

    @Test
    fun emptyStateIsEmptyWithNoOdometer() {
        val result = OdometerCounterProjection.emptyState()
        assertEquals(UiPhase.Empty, result.phase)
        assertNull(result.data?.odometerMeters)
    }

    // ── Registry + formatters ───────────────────────────────────────────────────────────────────────────

    @Test
    fun registrationMirrorsWebRegistry() {
        assertEquals("odometer-counter", OdometerCounterRegistration.ID)
        assertEquals("vehicle", OdometerCounterRegistration.CATEGORY)
        assertEquals("OdometerCounterWidget", OdometerCounterRegistration.SLUG)
        assertEquals(OdometerCounterSize(cols = 1, rows = 2), OdometerCounterRegistration.defaultSize)
        assertEquals(OdometerCounterSize(cols = 1, rows = 2), OdometerCounterRegistration.minSize)
        assertEquals(OdometerCounterSize(cols = 2, rows = 40), OdometerCounterRegistration.maxSize)
    }

    @Test
    fun registrationClampsChecksBoundsAndLayout() {
        assertEquals(OdometerCounterSize(cols = 2, rows = 40), OdometerCounterRegistration.clamp(OdometerCounterSize(9, 99)))
        assertEquals(OdometerCounterSize(cols = 1, rows = 2), OdometerCounterRegistration.clamp(OdometerCounterSize(0, 0)))
        assertTrue(OdometerCounterRegistration.isWithinBounds(OdometerCounterSize(1, 2)))
        assertFalse(OdometerCounterRegistration.isWithinBounds(OdometerCounterSize(3, 2)))
        assertTrue(OdometerCounterRegistration.isCompact(OdometerCounterSize(1, 1)))
        assertFalse(OdometerCounterRegistration.isCompact(OdometerCounterSize(1, 2)))
        assertTrue(OdometerCounterRegistration.isWide(OdometerCounterSize(2, 2)))
        assertFalse(OdometerCounterRegistration.isWide(OdometerCounterSize(1, 2)))
    }

    @Test
    fun formattersReproduceWebEnUsHalfExpandContract() {
        assertEquals("1,234.5", OdometerCounterProjection.formatNumber(1234.5, decimals = 1))
        // Half-expand (round half away from zero), not Java's default banker's rounding.
        assertEquals("1,235", OdometerCounterProjection.formatInt(1234.5))
        assertEquals("13", OdometerCounterProjection.formatInt(12.5))
    }
}
