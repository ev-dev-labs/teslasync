package io.teslasync.android.dashboard.widgets.drivetelemetry

import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.api.generated.DriveTelemetryReading
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.units.UnitPref
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import kotlin.time.Instant

/**
 * Off-device verification of the DriveTelemetryWidget's pure logic — the vehicle/latest-drive
 * resolution, the SI→display distance/speed conversion, the efficiency derivation + unit, the
 * stat-grid + chart-geometry projection across the compact / standard / wide footprints, the
 * dual-axis→single-axis scaling, the registry metadata, the number formatting, and the
 * cache-then-network drives+telemetry `Resource` mappers. Mirrors the web spec
 * (web/src/features/dashboard/widgets/DriveTelemetryWidget.tsx).
 */
class DriveTelemetryProjectionTest {
    private val utc = ZoneId.of("UTC")
    private val prefsMi: UnitPref = UnitPreferences.fromSettings(Json.parseToJsonElement("""{"unit_of_length":"mi"}"""))
    private val prefsKm: UnitPref = UnitPreferences.fromSettings(null)

    private fun labels(): DriveTelemetryLabels =
        DriveTelemetryLabels(
            distance = "Distance",
            duration = "Duration",
            minute = "min",
            efficiency = "Efficiency",
            speed = "Speed",
            power = "Power (kW)",
            battery = "Battery %",
            elevation = "Elevation",
        )

    @Suppress("LongParameterList")
    private fun drive(
        id: Long = 1,
        startTs: String = "2024-01-01T09:00:00Z",
        distanceM: Double = 16_093.44,
        durationS: Long = 1_800,
        energyUsedWh: Double? = 4_000.0,
        startAddress: String? = "123 Main St",
    ): Drive =
        Drive(
            createdAt = Instant.parse(startTs),
            distanceM = distanceM,
            durationS = durationS,
            id = id,
            startTs = Instant.parse(startTs),
            updatedAt = Instant.parse(startTs),
            vehicleId = 7,
            energyUsedWh = energyUsedWh,
            startAddress = startAddress,
        )

    @Suppress("LongParameterList")
    private fun reading(
        ts: String,
        speed: Double? = null,
        power: Double? = null,
        batteryLevel: Long? = null,
        soc: Double? = null,
        elevation: Double? = null,
    ): DriveTelemetryReading =
        DriveTelemetryReading(
            createdAt = Instant.parse(ts),
            driveId = 1,
            id = 1,
            vehicleId = 7,
            speed = speed,
            power = power,
            batteryLevel = batteryLevel,
            soc = soc,
            elevation = elevation,
        )

    private fun vehicle(id: Long): Vehicle =
        Vehicle(
            createdAt = Instant.parse("2024-01-01T00:00:00Z"),
            displayName = "Car $id",
            enrolledAt = Instant.parse("2024-01-01T00:00:00Z"),
            id = id,
            teslaId = id,
            timezone = "UTC",
            updatedAt = Instant.parse("2024-01-01T00:00:00Z"),
            vin = "VIN$id",
        )

    private fun project(
        snapshot: DriveTelemetrySnapshot,
        size: DriveTelemetrySize = DriveTelemetryRegistration.defaultSize,
        prefs: UnitPref = prefsMi,
    ): DriveTelemetryDisplay = DriveTelemetryProjection.project(snapshot, size, labels(), prefs, utc)

    // ---- vehicle + latest-drive resolution (web vehicleId ?? vehicles[0].id, latestDrive reduce) ----

    @Test
    fun firstVehicleId_isTheFirstOrNull() {
        assertEquals(5L, DriveTelemetryProjection.firstVehicleId(listOf(vehicle(5), vehicle(9))))
        assertNull(DriveTelemetryProjection.firstVehicleId(emptyList()))
        assertNull(DriveTelemetryProjection.firstVehicleId(null))
    }

    @Test
    fun latestDrive_isNewestByStartTs() {
        val older = drive(id = 1, startTs = "2024-01-01T08:00:00Z")
        val newer = drive(id = 2, startTs = "2024-01-02T08:00:00Z")
        assertEquals(2L, DriveTelemetryProjection.latestDrive(listOf(older, newer))?.id)
        assertEquals(2L, DriveTelemetryProjection.latestDrive(listOf(newer, older))?.id)
        assertNull(DriveTelemetryProjection.latestDrive(emptyList()))
        assertNull(DriveTelemetryProjection.latestDrive(null))
    }

    // ---- efficiency unit + derivation (web efficiencyUnit + efficiency memo) -----------------------

    @Test
    fun efficiencyUnit_followsDistancePreference() {
        assertEquals("Wh/mi", DriveTelemetryProjection.efficiencyUnit(prefsMi))
        assertEquals("Wh/km", DriveTelemetryProjection.efficiencyUnit(prefsKm))
    }

    @Test
    fun efficiency_isEnergyOverDisplayDistance() {
        // 4000 Wh over 10 mi -> 400 Wh/mi.
        val eff = DriveTelemetryProjection.efficiencyFor(drive(energyUsedWh = 4_000.0, distanceM = 16_093.44), displayDistance = 10.0)
        assertEquals(400.0, requireNotNull(eff), EPS)
    }

    @Test
    fun efficiency_nullWhenNoEnergyOrNoDistance() {
        assertNull(DriveTelemetryProjection.efficiencyFor(drive(energyUsedWh = null), displayDistance = 10.0))
        assertNull(DriveTelemetryProjection.efficiencyFor(drive(distanceM = 0.0), displayDistance = 10.0))
        assertNull(DriveTelemetryProjection.efficiencyFor(drive(distanceM = 16_093.44), displayDistance = 0.0))
    }

    // ---- summary stats (web stats memo) ------------------------------------------------------------

    @Test
    fun stats_distanceDurationEfficiencyInMiles() {
        // 16093.44 m = 10.0 mi; 1800 s = 30 min; 4000 Wh / 10 mi = 400 Wh/mi.
        val stats = DriveTelemetryProjection.buildStats(drive(), labels(), prefsMi)
        assertEquals(3, stats.size)
        assertStat(stats[0], "Distance", "10.0", "mi")
        assertStat(stats[1], "Duration", "30", "min")
        assertStat(stats[2], "Efficiency", "400", "Wh/mi")
    }

    @Test
    fun stats_distanceInKilometresWhenMetric() {
        // 16093.44 m = 16.09344 km -> "16.1" km; efficiency 4000/16.09344 = 249 Wh/km (rounded).
        val stats = DriveTelemetryProjection.buildStats(drive(), labels(), prefsKm)
        assertStat(stats[0], "Distance", "16.1", "km")
        assertEquals("Wh/km", stats[2].unit)
    }

    @Test
    fun stats_omitEfficiencyWhenEnergyMissing() {
        val stats = DriveTelemetryProjection.buildStats(drive(energyUsedWh = null), labels(), prefsMi)
        assertEquals(2, stats.size)
        assertEquals("Duration", stats[1].label)
    }

    // ---- chart geometry (web chartData memo + dual-axis -> single-axis scaling) ---------------------

    @Test
    fun chart_buildsTimeSpeedBatteryAndScaledPower() {
        val telemetry =
            listOf(
                reading(ts = "2024-01-01T09:05:00Z", speed = 0.0, power = 20.0, batteryLevel = 80),
                reading(ts = "2024-01-01T09:06:00Z", speed = 10.0, power = 40.0, soc = 60.0),
            )
        val chart = DriveTelemetryProjection.buildChart(telemetry, wide = false, prefs = prefsMi, zone = utc)

        assertEquals(listOf("09:05", "09:06"), chart.timeLabels)
        // speed: 0 m/s -> 0 mph; 10 m/s -> 22.369... mph.
        assertEquals(0.0, requireNotNull(chart.speedValues[0]), EPS)
        assertEquals(22.369362920544024, requireNotNull(chart.speedValues[1]), EPS)
        // battery: batteryLevel 80 then soc fallback 60.
        assertEquals(listOf(80.0, 60.0), chart.batteryValues)
        // axisMax = max(speed,battery)=80 + headroom 10 = 90; power scaled by max-abs 40 -> [45, 90].
        assertEquals(90.0, chart.axisMax, EPS)
        assertEquals(45.0, requireNotNull(chart.powerValues[0]), EPS)
        assertEquals(90.0, requireNotNull(chart.powerValues[1]), EPS)
        assertFalse(chart.showElevation)
        assertTrue(chart.elevationValues.isEmpty())
    }

    @Test
    fun chart_scalesElevationOnlyWhenWide() {
        val telemetry =
            listOf(
                reading(ts = "2024-01-01T09:05:00Z", speed = 0.0, batteryLevel = 80, elevation = 100.0),
                reading(ts = "2024-01-01T09:06:00Z", speed = 0.0, batteryLevel = 0, elevation = 200.0),
            )
        val wide = DriveTelemetryProjection.buildChart(telemetry, wide = true, prefs = prefsMi, zone = utc)
        assertTrue(wide.showElevation)
        // axisMax = 80 + 10 = 90; elevation scaled by max-abs 200 -> [45, 90].
        assertEquals(45.0, requireNotNull(wide.elevationValues[0]), EPS)
        assertEquals(90.0, requireNotNull(wide.elevationValues[1]), EPS)

        val narrow = DriveTelemetryProjection.buildChart(telemetry, wide = false, prefs = prefsMi, zone = utc)
        assertFalse(narrow.showElevation)
        assertTrue(narrow.elevationValues.isEmpty())
    }

    @Test
    fun chart_emptyTelemetryHasNoPoints() {
        val chart = DriveTelemetryProjection.buildChart(emptyList(), wide = true, prefs = prefsMi, zone = utc)
        assertFalse(chart.hasPoints)
        assertTrue(chart.timeLabels.isEmpty())
    }

    @Test
    fun chart_nullSpeedAndPowerAreGaps() {
        val telemetry = listOf(reading(ts = "2024-01-01T09:05:00Z", speed = null, power = null, batteryLevel = 50))
        val chart = DriveTelemetryProjection.buildChart(telemetry, wide = false, prefs = prefsMi, zone = utc)
        assertNull(chart.speedValues[0])
        assertNull(chart.powerValues[0])
        assertEquals(50.0, requireNotNull(chart.batteryValues[0]), EPS)
    }

    // ---- full projection + footprint gating (web isCompact / isWide branches) -----------------------

    @Test
    fun project_standardHasDriveStatsAndChart() {
        val snapshot = DriveTelemetrySnapshot(drive(), listOf(reading(ts = "2024-01-01T09:05:00Z", speed = 10.0, batteryLevel = 80)))
        val view = project(snapshot)
        assertTrue(view.hasDrive)
        assertFalse(view.isCompact)
        assertFalse(view.isWide)
        assertTrue(view.hasTelemetry)
        assertEquals(3, view.stats.size)
        // Standard (not wide) never shows the address badge.
        assertFalse(view.hasAddressBadge)
    }

    @Test
    fun project_wideShowsAddressBadge() {
        val view = project(DriveTelemetrySnapshot(drive(startAddress = "123 Main St")), size = DriveTelemetrySize(cols = 4, rows = 4))
        assertTrue(view.isWide)
        assertTrue(view.hasAddressBadge)
        assertEquals("123 Main St", view.startAddress)
    }

    @Test
    fun project_wideBlankAddressHasNoBadge() {
        val view = project(DriveTelemetrySnapshot(drive(startAddress = "  ")), size = DriveTelemetrySize(cols = 4, rows = 4))
        assertFalse(view.hasAddressBadge)
        assertNull(view.startAddress)
    }

    @Test
    fun project_noDriveIsEmptyGate() {
        val view = project(DriveTelemetrySnapshot(drive = null))
        assertFalse(view.hasDrive)
        assertTrue(view.stats.isEmpty())
        assertFalse(view.hasTelemetry)
    }

    @Test
    fun project_driveButNoTelemetryKeepsStatsAndChartEmpty() {
        val view = project(DriveTelemetrySnapshot(drive(), emptyList()))
        assertTrue(view.hasDrive)
        assertFalse(view.hasTelemetry)
        assertEquals(3, view.stats.size)
    }

    @Test
    fun project_compactFlagsAtSingleColumn() {
        val view = project(DriveTelemetrySnapshot(drive()), size = DriveTelemetrySize(cols = 1, rows = 4))
        assertTrue(view.isCompact)
        assertTrue(view.compactContentDescription.contains("Distance"))
    }

    @Test
    fun project_chartContentDescriptionListsSeries() {
        val telemetry = listOf(reading(ts = "2024-01-01T09:05:00Z", speed = 1.0, batteryLevel = 1, elevation = 5.0))
        val wide = project(DriveTelemetrySnapshot(drive(), telemetry), size = DriveTelemetrySize(cols = 4, rows = 4))
        assertTrue(wide.chartContentDescription.contains("Speed"))
        assertTrue(wide.chartContentDescription.contains("Elevation"))
    }

    // ---- registry metadata (web registry/driving.ts) -----------------------------------------------

    @Test
    fun registry_metadataMatchesWebRegistry() {
        assertEquals("drive-telemetry", DriveTelemetryRegistration.ID)
        assertEquals("driving", DriveTelemetryRegistration.CATEGORY)
        assertEquals("DriveTelemetryWidget", DriveTelemetryRegistration.SLUG)
        assertEquals(DriveTelemetrySize(cols = 2, rows = 4), DriveTelemetryRegistration.defaultSize)
        assertEquals(DriveTelemetrySize(cols = 2, rows = 4), DriveTelemetryRegistration.minSize)
        assertEquals(DriveTelemetrySize(cols = 4, rows = 40), DriveTelemetryRegistration.maxSize)
    }

    @Test
    fun registry_boundsAndClampHonourMinMax() {
        assertTrue(DriveTelemetryRegistration.withinBounds(DriveTelemetrySize(cols = 2, rows = 4)))
        assertFalse(DriveTelemetryRegistration.withinBounds(DriveTelemetrySize(cols = 1, rows = 2)))
        assertFalse(DriveTelemetryRegistration.withinBounds(DriveTelemetrySize(cols = 5, rows = 50)))
        assertEquals(DriveTelemetrySize(cols = 2, rows = 4), DriveTelemetryRegistration.clamp(DriveTelemetrySize(cols = 1, rows = 1)))
        assertEquals(DriveTelemetrySize(cols = 4, rows = 40), DriveTelemetryRegistration.clamp(DriveTelemetrySize(cols = 9, rows = 99)))
    }

    @Test
    fun size_flagsMatchWeb() {
        assertTrue(DriveTelemetrySize(cols = 1, rows = 4).isCompact)
        assertFalse(DriveTelemetrySize(cols = 2, rows = 4).isCompact)
        assertFalse(DriveTelemetrySize(cols = 2, rows = 4).isWide)
        assertTrue(DriveTelemetrySize(cols = 3, rows = 4).isWide)
        assertTrue(DriveTelemetrySize(cols = 4, rows = 4).isWide)
    }

    // ---- number formatting (web fmtNumber/fmtInt) --------------------------------------------------

    @Test
    fun formatNumber_groupsThousandsAndRoundsHalfUp() {
        // 1234.5 is exactly representable, so HALF_UP rounds the half away from zero (-> 1235) and groups.
        assertEquals("1,235", DriveTelemetryProjection.formatNumber(1_234.5, 0))
        assertEquals("1,234.0", DriveTelemetryProjection.formatNumber(1_234.0, 1))
        assertEquals("400", DriveTelemetryProjection.formatNumber(400.0, 0))
        assertEquals("31", DriveTelemetryProjection.formatInt(30.5))
    }

    @Test
    fun formatNumber_coercesNonFiniteToZero() {
        assertEquals("0.0", DriveTelemetryProjection.formatNumber(Double.NaN, 1))
        assertEquals("0", DriveTelemetryProjection.formatInt(Double.POSITIVE_INFINITY))
    }

    // ---- Resource mappers (cache-then-network drives + telemetry preservation) ---------------------

    @Test
    fun mergeDrives_successPicksLatestAndAttachesTelemetry() {
        val drives = listOf(drive(id = 1, startTs = "2024-01-01T08:00:00Z"), drive(id = 2, startTs = "2024-01-02T08:00:00Z"))
        val telemetry = listOf(reading(ts = "2024-01-02T08:05:00Z", speed = 5.0))
        val mapped = mergeDrivesSnapshot(Resource.Success(drives, NOW, false), telemetry)
        assertTrue(mapped is Resource.Success)
        val snapshot = (mapped as Resource.Success).data
        assertEquals(2L, snapshot.drive?.id)
        assertEquals(1, snapshot.telemetry.size)
    }

    @Test
    fun mergeDrives_emptyListIsDriveLessEmptyGate() {
        val mapped = mergeDrivesSnapshot(Resource.Success(emptyList(), NOW, false), emptyList())
        assertTrue(mapped is Resource.Success)
        assertNull((mapped as Resource.Success).data.drive)
    }

    @Test
    fun mergeDrives_errorWithCachePreservesOfflineDrive() {
        val drives = listOf(drive(id = 3, startTs = "2024-01-03T08:00:00Z"))
        val error = Resource.Error(cached = drives, fetchedAt = NOW, stale = true, error = ApiError.Network())
        val mapped = mergeDrivesSnapshot(error, emptyList())
        assertTrue(mapped is Resource.Error)
        assertEquals(3L, (mapped as Resource.Error).cached?.drive?.id)
        assertTrue(mapped.stale)
    }

    @Test
    fun mergeDrives_loadingWithNoCacheStaysLoading() {
        val mapped = mergeDrivesSnapshot(Resource.Loading(cached = null, fetchedAt = null, stale = false), emptyList())
        assertTrue(mapped is Resource.Loading)
        assertNull((mapped as Resource.Loading).cached)
    }

    @Test
    fun resolutionResource_loadingNoCacheStaysLoadingElseEmpty() {
        val loading = resolutionResource(Resource.Loading<List<Vehicle>>(cached = null, fetchedAt = null, stale = false))
        assertTrue(loading is Resource.Loading)

        val empty = resolutionResource(Resource.Success<List<Vehicle>>(emptyList(), NOW, false))
        assertTrue(empty is Resource.Success)
        assertNull((empty as Resource.Success).data.drive)
    }

    private fun assertStat(
        stat: DriveTelemetryStat,
        label: String,
        value: String,
        unit: String?,
    ) {
        assertEquals(label, stat.label)
        assertEquals(value, stat.value)
        assertEquals(unit, stat.unit)
    }

    private companion object {
        const val EPS = 1e-9
        const val NOW = 1_700_000_000_000L
    }
}
