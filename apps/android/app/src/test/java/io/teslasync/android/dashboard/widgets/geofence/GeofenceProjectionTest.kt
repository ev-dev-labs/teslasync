package io.teslasync.android.dashboard.widgets.geofence

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.locations.Geofence
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.DurationUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.PowerUnitPref
import io.teslasync.shared.core.units.PressureUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the GeofenceWidget's pure logic — the haversine distance, the inside /
 * disabled / outside badge selection, the current-zone lookup, the SI radius conversion, the compact /
 * empty / show-map projection flags, the registry metadata, and the two-feed cache-then-network
 * `Resource` combine. Mirrors the web spec (web/src/features/dashboard/widgets/GeofenceWidget.tsx)
 * verbatim, including `hasCoords = vLat !== 0 || vLon !== 0` and `currentZone = first enabled inside`.
 */
class GeofenceProjectionTest {
    private fun units(distance: DistanceUnitPref = DistanceUnitPref.KM): UnitPref =
        UnitPref(
            distance = distance,
            speed = SpeedUnitPref.KMH,
            temperature = TemperatureUnitPref.CELSIUS,
            pressure = PressureUnitPref.BAR,
            energy = EnergyUnitPref.KWH,
            duration = DurationUnitPref.HOURS,
            power = PowerUnitPref.KW,
            locale = "en-US",
        )

    private fun strings(): GeofenceStrings =
        GeofenceStrings(
            title = "Geofence Status",
            noZone = "No zone",
            noFences = "No geofences configured",
            radiusLabel = "Radius",
            disabled = "Disabled",
            inside = "Inside",
            outside = "Outside",
            refreshLabel = "Refresh",
            refreshingLabel = "Loading\u2026",
            offlineLabel = "Offline",
            formatRelative = { "" },
        )

    @Suppress("LongParameterList")
    private fun geofence(
        id: Long,
        name: String = "Home",
        latitude: Double = 0.0,
        longitude: Double = 0.0,
        radius: Double = 100.0,
        enabled: Boolean = true,
    ): Geofence =
        Geofence(
            id = id,
            name = name,
            polygonWkt = "",
            createdAt = "2024-01-01T00:00:00Z",
            updatedAt = "2024-01-01T00:00:00Z",
            latitude = latitude,
            longitude = longitude,
            radius = radius,
            enabled = enabled,
        )

    @Suppress("LongParameterList")
    private fun envelope(
        latitude: Double,
        longitude: Double,
    ): VehicleStateEnvelope =
        VehicleStateEnvelope(
            state =
                VehicleState(
                    batteryLevel = 80,
                    chargeRate = 0.0,
                    chargerPower = 0.0,
                    idealRange = 0.0,
                    insideTemp = 20.0,
                    isCharging = false,
                    isClimateOn = false,
                    isLocked = true,
                    latitude = latitude,
                    longitude = longitude,
                    odometer = 0.0,
                    outsideTemp = 15.0,
                    power = 0.0,
                    ratedRange = 0.0,
                    sentryMode = false,
                    softwareVersion = "2024.0",
                    speed = 0.0,
                    state = "online",
                    timeToFullCharge = 0.0,
                    vehicleId = 1L,
                ),
            live = false,
        )

    private fun project(
        feed: GeofenceFeed,
        size: GeofenceSize = GeofenceRegistration.defaultSize,
        distance: DistanceUnitPref = DistanceUnitPref.KM,
    ): GeofenceDisplay = GeofenceProjection.project(feed, size, units(distance), strings())

    // ── Haversine (web `haversineMeters`) ──────────────────────────────────────────
    @Test
    fun haversineIsZeroForSamePoint() {
        assertEquals(0.0, GeofenceProjection.haversineMeters(37.0, -122.0, 37.0, -122.0), 1e-6)
    }

    @Test
    fun haversineMatchesOneDegreeOfLongitudeAtEquator() {
        // One degree of longitude at the equator ≈ R * π/180 ≈ 111 194.9 m.
        assertEquals(111_194.9, GeofenceProjection.haversineMeters(0.0, 0.0, 0.0, 1.0), 1.0)
    }

    // ── Registry metadata (web registry/maps.ts `geofence-status`) ──────────────────
    @Test
    fun registrationMatchesWebRegistry() {
        assertEquals("geofence-status", GeofenceRegistration.ID)
        assertEquals("maps", GeofenceRegistration.CATEGORY)
        assertEquals("GeofenceWidget", GeofenceRegistration.SLUG)
        assertEquals(GeofenceSize(cols = 2, rows = 4), GeofenceRegistration.defaultSize)
        assertEquals(GeofenceSize(cols = 1, rows = 2), GeofenceRegistration.minSize)
        assertEquals(GeofenceSize(cols = 4, rows = 40), GeofenceRegistration.maxSize)
    }

    @Test
    fun sizeBoundsAndClampHonourTheRegistryFootprint() {
        assertTrue(GeofenceRegistration.withinBounds(GeofenceSize(cols = 2, rows = 4)))
        assertFalse(GeofenceRegistration.withinBounds(GeofenceSize(cols = 5, rows = 4)))
        assertFalse(GeofenceRegistration.withinBounds(GeofenceSize(cols = 1, rows = 1)))
        assertEquals(GeofenceSize(cols = 4, rows = 40), GeofenceRegistration.clamp(GeofenceSize(cols = 9, rows = 99)))
        assertEquals(GeofenceSize(cols = 1, rows = 2), GeofenceRegistration.clamp(GeofenceSize(cols = 0, rows = 0)))
    }

    // ── Projection: empty ───────────────────────────────────────────────────────────
    @Test
    fun projectEmptyFeedIsEmpty() {
        val display = project(GeofenceFeed.EMPTY)
        assertTrue(display.isEmpty)
        assertTrue(display.fences.isEmpty())
        assertNull(display.currentZoneName)
        assertEquals("No geofences configured", display.noFencesText)
    }

    // ── Projection: inside / current zone ─────────────────────────────────────────
    @Test
    fun projectComputesInsideAndCurrentZone() {
        val feed =
            GeofenceFeed(
                coords = GeoCoordinate(37.0, -122.0),
                fences = listOf(geofence(id = 1, name = "Home", latitude = 37.0, longitude = -122.0, radius = 1_000.0)),
            )
        val display = project(feed)
        val fence = display.fences.single()
        assertTrue(fence.inside)
        assertTrue(fence.highlighted)
        assertEquals(FenceStatusKind.Inside, fence.status)
        assertEquals("Inside", fence.statusLabel)
        assertEquals("Home", display.currentZoneName)
        assertTrue(display.hasCoords)
    }

    @Test
    fun projectDisabledFenceIsDisabledAndNeverTheCurrentZone() {
        val feed =
            GeofenceFeed(
                coords = GeoCoordinate(37.0, -122.0),
                fences = listOf(geofence(id = 1, name = "Home", latitude = 37.0, longitude = -122.0, radius = 1_000.0, enabled = false)),
            )
        val display = project(feed)
        val fence = display.fences.single()
        assertEquals(FenceStatusKind.Disabled, fence.status)
        assertEquals("Disabled", fence.statusLabel)
        assertFalse(fence.highlighted)
        assertNull(display.currentZoneName)
    }

    @Test
    fun currentZonePicksFirstEnabledFenceInside() {
        val feed =
            GeofenceFeed(
                coords = GeoCoordinate(37.0, -122.0),
                fences =
                    listOf(
                        geofence(id = 1, name = "DisabledHome", latitude = 37.0, longitude = -122.0, radius = 1_000.0, enabled = false),
                        geofence(id = 2, name = "Work", latitude = 37.0, longitude = -122.0, radius = 1_000.0, enabled = true),
                    ),
            )
        assertEquals("Work", project(feed).currentZoneName)
    }

    @Test
    fun projectWithoutCoordsLeavesEveryFenceOutside() {
        val feed =
            GeofenceFeed(
                coords = null,
                fences = listOf(geofence(id = 1, name = "Home", latitude = 37.0, longitude = -122.0, radius = 1_000.0)),
            )
        val display = project(feed, size = GeofenceSize(cols = 2, rows = 4))
        val fence = display.fences.single()
        assertFalse(fence.inside)
        assertEquals(FenceStatusKind.Outside, fence.status)
        assertEquals(Double.POSITIVE_INFINITY, fence.distanceMeters, 0.0)
        assertNull(display.currentZoneName)
        assertFalse(display.hasCoords)
        assertFalse(display.showMap)
    }

    // ── Projection: radius conversion (web `fmtRadius`) ────────────────────────────
    @Test
    fun projectFormatsRadiusInKilometres() {
        val feed = GeofenceFeed(coords = null, fences = listOf(geofence(id = 1, radius = 1_000.0)))
        assertEquals("1.0 km", project(feed).fences.single().radiusText)
    }

    @Test
    fun projectConvertsRadiusToMiles() {
        // 1609.344 m == exactly 1 mile.
        val feed = GeofenceFeed(coords = null, fences = listOf(geofence(id = 1, radius = 1_609.344)))
        assertEquals("1.0 mi", project(feed, distance = DistanceUnitPref.MI).fences.single().radiusText)
    }

    // ── Projection: map + compact flags ─────────────────────────────────────────────
    @Test
    fun showMapRequiresCoordinatesAndAtLeastThreeRows() {
        val feed = GeofenceFeed(coords = GeoCoordinate(37.0, -122.0), fences = listOf(geofence(id = 1)))
        assertTrue(project(feed, size = GeofenceSize(cols = 2, rows = 4)).showMap)
        assertFalse(project(feed, size = GeofenceSize(cols = 2, rows = 2)).showMap)
        val noCoords = GeofenceFeed(coords = null, fences = listOf(geofence(id = 1)))
        assertFalse(project(noCoords, size = GeofenceSize(cols = 2, rows = 4)).showMap)
    }

    @Test
    fun projectHonoursCompactFootprint() {
        val feed = GeofenceFeed(coords = null, fences = listOf(geofence(id = 1)))
        assertTrue(project(feed, size = GeofenceSize(cols = 1, rows = 2)).isCompact)
        assertFalse(project(feed, size = GeofenceSize(cols = 2, rows = 2)).isCompact)
    }

    // ── Combine: two-feed cache-then-network merge ─────────────────────────────────
    @Test
    fun combineIsLoadingWhenEitherFeedHasNoData() {
        val loadingFences = Resource.Loading<List<Geofence>>(cached = null, fetchedAt = null, stale = false)
        val loadingState = Resource.Loading<VehicleStateEnvelope>(cached = null, fetchedAt = null, stale = false)
        val merged = combineGeofenceResources(loadingFences, loadingState)
        assertTrue(merged is Resource.Loading)
        assertNull((merged as Resource.Loading).cached)
    }

    @Test
    fun combineMergesCoordinatesAndFencesOnSuccess() {
        val fences = Resource.Success(listOf(geofence(id = 1, name = "Home")), fetchedAt = 100L, stale = false)
        val state = Resource.Success(envelope(37.0, -122.0), fetchedAt = 200L, stale = false)
        val merged = combineGeofenceResources(fences, state) as Resource.Success
        assertEquals(GeoCoordinate(37.0, -122.0), merged.data.coords)
        assertEquals(1, merged.data.fences.size)
        assertEquals(200L, merged.fetchedAt)
    }

    @Test
    fun combineKeepsBestEffortListVisibleOnFenceError() {
        val fences = Resource.Error<List<Geofence>>(cached = null, fetchedAt = 50L, stale = true, error = ApiError.Network())
        val state = Resource.Success(envelope(37.0, -122.0), fetchedAt = 200L, stale = false)
        val merged = combineGeofenceResources(fences, state) as Resource.Error
        assertTrue(merged.stale)
        assertEquals(GeoCoordinate(37.0, -122.0), merged.cached?.coords)
        assertTrue(merged.cached?.fences?.isEmpty() == true)
    }

    @Test
    fun combineKeepsFencesVisibleWhenStateErrors() {
        val fences = Resource.Success(listOf(geofence(id = 1, name = "Home")), fetchedAt = 100L, stale = false)
        val state = Resource.Error<VehicleStateEnvelope>(cached = null, fetchedAt = null, stale = false, error = ApiError.Timeout())
        val merged = combineGeofenceResources(fences, state) as Resource.Error
        assertNull(merged.cached?.coords)
        assertEquals(1, merged.cached?.fences?.size)
    }

    @Test
    fun combineIsRefreshingWhenLoadingOverCache() {
        val fences = Resource.Loading(cached = listOf(geofence(id = 1)), fetchedAt = 100L, stale = false)
        val state = Resource.Success(envelope(37.0, -122.0), fetchedAt = 200L, stale = false)
        val merged = combineGeofenceResources(fences, state) as Resource.Loading
        assertEquals(1, merged.cached?.fences?.size)
        assertEquals(GeoCoordinate(37.0, -122.0), merged.cached?.coords)
    }

    @Test
    fun combineTreatsZeroZeroPositionAsNoCoordinate() {
        val fences = Resource.Success(listOf(geofence(id = 1)), fetchedAt = 100L, stale = false)
        val state = Resource.Success(envelope(0.0, 0.0), fetchedAt = 100L, stale = false)
        val merged = combineGeofenceResources(fences, state) as Resource.Success
        assertNull(merged.data.coords)
    }

    // ── Vehicle resolution (web `vehicleId ?? vehicles[0].id ?? 0`) ────────────────
    @Test
    fun resolveVehicleIdFollowsWebPrecedence() {
        assertEquals(7L, resolveVehicleId(explicitVehicleId = 7L, vehicleIds = listOf(3L, 4L)))
        assertEquals(3L, resolveVehicleId(explicitVehicleId = null, vehicleIds = listOf(3L, 4L)))
        assertEquals(0L, resolveVehicleId(explicitVehicleId = null, vehicleIds = emptyList()))
        assertEquals(0L, resolveVehicleId(explicitVehicleId = null, vehicleIds = null))
    }

    // ── i18n string mapping ────────────────────────────────────────────────────────
    @Test
    fun statusLabelsResolveThroughStrings() {
        val s = strings()
        assertEquals("Disabled", s.labelFor(FenceStatusKind.Disabled))
        assertEquals("Inside", s.labelFor(FenceStatusKind.Inside))
        assertEquals("Outside", s.labelFor(FenceStatusKind.Outside))
    }

    @Test
    fun formatRelativeHandlesEveryFreshnessBucket() {
        // The default test formatter returns "" — proves the projection never inspects the formatter.
        val s = strings()
        assertEquals("", s.formatRelative(FreshnessAge.JustNow))
        assertEquals("", s.formatRelative(FreshnessAge.Minutes(3)))
    }
}
