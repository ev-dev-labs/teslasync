package io.teslasync.android.dashboard.widgets.locationmap

import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the LocationMapWidget's pure logic — the envelope parse adapter, the
 * `hasCoords` gate, the `isCompact` / `isExpanded` footprint branches, the map center + zoom, the three
 * status-overlay chip gates, the `toFixed(4)` coordinate + `Math.round` heading formatting, the map
 * accessible description, the registry metadata, and the cache-then-network `Resource` mapper. Mirrors
 * the web spec (web/src/features/dashboard/widgets/LocationMapWidget.tsx) verbatim, including the
 * combined `!hasCoords` empty gate (no fix OR a 0,0 reading) and the coordinates-are-not-converted rule.
 */
class LocationMapProjectionTest {
    private fun strings(): LocationMapStrings =
        LocationMapStrings(
            title = "Vehicle Location Map",
            noData = "No location data available",
            lastKnown = "Last known position",
            heading = "Heading",
            refreshLabel = "Refresh",
            refreshingLabel = "Loading\u2026",
            offlineLabel = "Offline",
            formatRelative = { "" },
        )

    // A full VehicleState with only the map-relevant fields varied; the rest are inert defaults.
    private fun state(
        latitude: Double,
        longitude: Double,
        heading: Double? = null,
    ): VehicleState =
        VehicleState(
            batteryLevel = 0L,
            chargeRate = 0.0,
            chargerPower = 0.0,
            idealRange = 0.0,
            insideTemp = 0.0,
            isCharging = false,
            isClimateOn = false,
            isLocked = false,
            latitude = latitude,
            longitude = longitude,
            odometer = 0.0,
            outsideTemp = 0.0,
            power = 0.0,
            ratedRange = 0.0,
            sentryMode = false,
            softwareVersion = "",
            speed = 0.0,
            state = "online",
            timeToFullCharge = 0.0,
            vehicleId = 1L,
            heading = heading,
        )

    private fun located(
        latitude: Double = 37.5,
        longitude: Double = -122.25,
        heading: Double? = 270.0,
        isLive: Boolean = false,
    ): VehicleLocationData = VehicleLocationData(latitude, longitude, heading, isLive)

    // ---- Envelope parse adapter ----------------------------------------------------

    @Test
    fun fromEnvelopeNullEnvelopeIsNull() {
        assertNull(VehicleLocationData.fromEnvelope(null))
    }

    @Test
    fun fromEnvelopeNullStateIsNull() {
        assertNull(VehicleLocationData.fromEnvelope(VehicleStateEnvelope(state = null, live = true)))
    }

    @Test
    fun fromEnvelopeMapsStateAndLiveFlag() {
        val data = VehicleLocationData.fromEnvelope(VehicleStateEnvelope(state = state(37.5, -122.3, 90.0), live = true))
        assertEquals(VehicleLocationData(37.5, -122.3, 90.0, isLive = true), data)
    }

    @Test
    fun hasCoordsTrueForNonZeroFalseForZero() {
        assertTrue(located(37.5, -122.25).hasCoords)
        assertFalse(located(0.0, 0.0).hasCoords)
        assertFalse(located(0.0, -122.25).hasCoords)
    }

    // ---- Projection: empty gate ----------------------------------------------------

    @Test
    fun projectNullDataIsEmptyWithNoOverlay() {
        val display = LocationMapProjection.project(null, LocationMapSize.Default, strings())
        assertFalse(display.hasCoords)
        assertFalse(display.showStatusOverlay)
        assertFalse(display.showCoordsChip)
        assertEquals("No location data available", display.noDataText)
    }

    @Test
    fun projectZeroCoordsIsEmpty() {
        val display = LocationMapProjection.project(located(0.0, 0.0), LocationMapSize.Default, strings())
        assertFalse(display.hasCoords)
        assertFalse(display.showStatusOverlay)
    }

    // ---- Projection: standard footprint --------------------------------------------

    @Test
    fun projectStandardShowsOverlayHeadingAndCoordinateChips() {
        val display =
            LocationMapProjection.project(
                located(37.4419, -122.143, heading = 270.0, isLive = false),
                LocationMapSize.Default,
                strings(),
            )
        assertTrue(display.hasCoords)
        assertFalse(display.isCompact)
        assertTrue(display.isExpanded)
        assertTrue(display.showStatusOverlay)
        assertTrue(display.showCoordsChip)
        assertTrue(display.showHeadingChip)
        assertTrue(display.showLastKnownChip)
        assertEquals("37.4419, -122.1430", display.coordsText)
        assertEquals("Heading: 270\u00B0", display.headingChipText)
        assertEquals(LocationMapProjection.STANDARD_ZOOM, display.zoom)
    }

    // ---- Projection: compact footprint hides the overlay ---------------------------

    @Test
    fun projectCompactHidesOverlayAndUsesCompactZoom() {
        val display = LocationMapProjection.project(located(), LocationMapSize.MinSize, strings())
        assertTrue(display.isCompact)
        assertEquals(LocationMapProjection.COMPACT_ZOOM, display.zoom)
        assertFalse(display.showStatusOverlay)
        assertFalse(display.showCoordsChip)
        assertFalse(display.showHeadingChip)
        assertFalse(display.showLastKnownChip)
    }

    // ---- Projection: non-expanded footprint shows only the last-known chip ---------

    @Test
    fun projectUnexpandedShowsOnlyLastKnownChip() {
        val display = LocationMapProjection.project(located(isLive = false), LocationMapSize(cols = 2, rows = 2), strings())
        assertFalse(display.isExpanded)
        assertTrue(display.showStatusOverlay)
        assertTrue(display.showLastKnownChip)
        assertFalse(display.showCoordsChip)
        assertFalse(display.showHeadingChip)
    }

    @Test
    fun projectLiveReadingHidesLastKnownChip() {
        val display = LocationMapProjection.project(located(isLive = true), LocationMapSize.Default, strings())
        assertFalse(display.showLastKnownChip)
        assertTrue(display.showCoordsChip)
    }

    @Test
    fun projectNullHeadingHidesHeadingChip() {
        val display = LocationMapProjection.project(located(heading = null), LocationMapSize.Default, strings())
        assertFalse(display.showHeadingChip)
        assertEquals("", display.headingChipText)
        assertNull(display.headingDegrees)
    }

    // ---- Heading rounding + coordinate formatting ----------------------------------

    @Test
    fun headingRoundsLikeMathRound() {
        assertEquals(270, LocationMapProjection.roundHeading(269.6))
        assertEquals(0, LocationMapProjection.roundHeading(0.4))
        assertEquals(360, LocationMapProjection.roundHeading(359.7))
        assertNull(LocationMapProjection.roundHeading(null))
        assertNull(LocationMapProjection.roundHeading(Double.NaN))
    }

    @Test
    fun formatCoordinateMatchesToFixed4() {
        assertEquals("37.5000", LocationMapProjection.formatCoordinate(37.5))
        assertEquals("-122.1430", LocationMapProjection.formatCoordinate(-122.143))
        assertEquals("12.3457", LocationMapProjection.formatCoordinate(12.34567))
        assertEquals("0.0000", LocationMapProjection.formatCoordinate(0.0))
        assertEquals("0.0000", LocationMapProjection.formatCoordinate(Double.NaN))
    }

    @Test
    fun mapContentDescriptionCarriesPositionHeadingAndStatus() {
        val description =
            LocationMapProjection
                .project(located(37.5, -122.25, heading = 90.0, isLive = false), LocationMapSize.Default, strings())
                .mapContentDescription
        assertTrue(description.contains("Vehicle Location Map"))
        assertTrue(description.contains("37.5000, -122.2500"))
        assertTrue(description.contains("Heading: 90\u00B0"))
        assertTrue(description.contains("Last known position"))
    }

    @Test
    fun mapContentDescriptionForEmptyIsTitleOnly() {
        val description = LocationMapProjection.project(null, LocationMapSize.Default, strings()).mapContentDescription
        assertEquals("Vehicle Location Map", description)
    }

    // ---- Registry metadata ---------------------------------------------------------

    @Test
    fun registrationMatchesWebRegistry() {
        assertEquals("location-map", LocationMapRegistration.ID)
        assertEquals("maps", LocationMapRegistration.CATEGORY)
        assertEquals("LocationMapWidget", LocationMapRegistration.SLUG)
        assertEquals(LocationMapSize(cols = 2, rows = 4), LocationMapRegistration.defaultSize)
        assertEquals(LocationMapSize(cols = 1, rows = 4), LocationMapRegistration.minSize)
        assertEquals(LocationMapSize(cols = 4, rows = 40), LocationMapRegistration.maxSize)
    }

    @Test
    fun sizeWithinBoundsAndClamp() {
        assertTrue(LocationMapRegistration.withinBounds(LocationMapSize(cols = 2, rows = 4)))
        assertFalse(LocationMapRegistration.withinBounds(LocationMapSize(cols = 5, rows = 50)))
        assertFalse(LocationMapRegistration.withinBounds(LocationMapSize(cols = 1, rows = 2)))
        assertEquals(LocationMapSize(cols = 4, rows = 40), LocationMapRegistration.clamp(LocationMapSize(cols = 9, rows = 99)))
        assertEquals(LocationMapSize(cols = 1, rows = 4), LocationMapRegistration.clamp(LocationMapSize(cols = 0, rows = 1)))
    }

    // ---- Cache-then-network Resource mapper ----------------------------------------

    @Test
    fun toVehicleLocationPreservesLoadingFreshness() {
        val resource: Resource<VehicleStateEnvelope> =
            Resource.Loading(cached = VehicleStateEnvelope(state(37.5, -122.25), live = true), fetchedAt = 100L, stale = false)
        val mapped = resource.toVehicleLocation()
        assertTrue(mapped is Resource.Loading)
        assertEquals(VehicleLocationData(37.5, -122.25, null, isLive = true), mapped.cached)
        assertEquals(100L, (mapped as Resource.Loading).fetchedAt)
    }

    @Test
    fun toVehicleLocationPreservesSuccess() {
        val resource: Resource<VehicleStateEnvelope> =
            Resource.Success(data = VehicleStateEnvelope(state(1.0, 2.0, 45.0), live = false), fetchedAt = 200L, stale = false)
        val mapped = resource.toVehicleLocation()
        assertTrue(mapped is Resource.Success)
        assertEquals(VehicleLocationData(1.0, 2.0, 45.0, isLive = false), (mapped as Resource.Success).data)
        assertEquals(200L, mapped.fetchedAt)
    }

    @Test
    fun toVehicleLocationPreservesErrorAndCache() {
        val cause = ApiError.Timeout()
        val resource: Resource<VehicleStateEnvelope> =
            Resource.Error(cached = VehicleStateEnvelope(state(3.0, 4.0), live = false), fetchedAt = 300L, stale = true, error = cause)
        val mapped = resource.toVehicleLocation()
        assertTrue(mapped is Resource.Error)
        mapped as Resource.Error
        assertEquals(VehicleLocationData(3.0, 4.0, null, isLive = false), mapped.cached)
        assertTrue(mapped.stale)
        assertEquals(cause, mapped.error)
    }

    @Test
    fun toVehicleLocationMapsNullStateToNull() {
        val resource: Resource<VehicleStateEnvelope> =
            Resource.Success(data = VehicleStateEnvelope(state = null, live = false), fetchedAt = 1L, stale = false)
        val mapped = resource.toVehicleLocation()
        assertNull((mapped as Resource.Success).data)
    }
}
