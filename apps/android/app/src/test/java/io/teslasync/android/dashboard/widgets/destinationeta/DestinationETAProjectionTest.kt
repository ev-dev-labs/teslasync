package io.teslasync.android.dashboard.widgets.destinationeta

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.DurationUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.PowerUnitPref
import io.teslasync.shared.core.units.PressureUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the DestinationETAWidget's pure logic — the JSON parse adapter, the
 * `isNavigating` gate, the location-badge precedence, the SI distance conversion, the arrival-countdown
 * formatter, the route-completion progress formula, the compact / standard projection, the registry
 * metadata, and the cache-then-network `Resource` mapper. Mirrors the web spec
 * (web/src/features/dashboard/widgets/DestinationETAWidget.tsx) verbatim, including the proto-identifier
 * paradox (the `miles_to_arrival` wire key carries SI metres) and the no-carry ETA edge.
 */
class DestinationETAProjectionTest {
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

    private fun strings(): DestinationETAStrings =
        DestinationETAStrings(
            title = "Destination ETA",
            home = "Home",
            work = "Work",
            favorite = "Favorite",
            other = "Other",
            noData = "No location data",
            min = "min",
            eta = "ETA",
            noNav = "No active navigation",
            remaining = "Remaining",
            refreshLabel = "Refresh",
            refreshingLabel = "Loading\u2026",
            offlineLabel = "Offline",
            formatRelative = { "" },
        )

    // The fixture builder legitimately mirrors the location snapshot's fields; the parameter count is
    // intentional for readable, named test setup.
    @Suppress("LongParameterList")
    private fun navigating(
        destination: String? = "Tesla HQ",
        meters: Double = 5_000.0,
        minutes: Double = 90.0,
        home: Boolean = false,
        work: Boolean = false,
        favorite: Boolean = false,
    ): LocationSnapshotData =
        LocationSnapshotData(
            destinationName = destination,
            distanceToArrivalMeters = meters,
            minutesToArrival = minutes,
            locatedAtHome = home,
            locatedAtWork = work,
            locatedAtFavorite = favorite,
        )

    private fun project(
        snapshot: LocationSnapshotData?,
        size: DestinationETASize = DestinationETARegistration.defaultSize,
        distance: DistanceUnitPref = DistanceUnitPref.KM,
    ): DestinationETADisplay = DestinationETAProjection.project(snapshot, size, units(distance), strings())

    // ── JSON parse ───────────────────────────────────────────────────────────────
    @Test
    fun fromJsonParsesNavigatingSnapshot() {
        val element =
            Json.parseToJsonElement(
                """{"destination_name":"Tesla HQ","miles_to_arrival":5000,"minutes_to_arrival":90,"located_at_home":false}""",
            )
        val snapshot = LocationSnapshotData.fromJson(element)!!
        assertEquals("Tesla HQ", snapshot.destinationName)
        // The wire key is `miles_to_arrival` but its content is SI metres (proto-identifier paradox).
        assertEquals(5_000.0, snapshot.distanceToArrivalMeters, 0.0)
        assertEquals(90.0, snapshot.minutesToArrival, 0.0)
        assertTrue(snapshot.isNavigating)
    }

    @Test
    fun fromJsonReturnsNullForNonObject() {
        assertNull(LocationSnapshotData.fromJson(Json.parseToJsonElement("\"oops\"")))
        assertNull(LocationSnapshotData.fromJson(Json.parseToJsonElement("42")))
    }

    @Test
    fun fromJsonToleratesMissingFields() {
        val snapshot = LocationSnapshotData.fromJson(Json.parseToJsonElement("{}"))!!
        assertNull(snapshot.destinationName)
        assertEquals(0.0, snapshot.distanceToArrivalMeters, 0.0)
        assertEquals(0.0, snapshot.minutesToArrival, 0.0)
        assertFalse(snapshot.isNavigating)
        assertFalse(snapshot.locatedAtHome)
    }

    @Test
    fun isNavigatingFalseForEmptyDestination() {
        assertFalse(navigating(destination = "").isNavigating)
        assertFalse(navigating(destination = null).isNavigating)
        assertTrue(navigating(destination = "Work").isNavigating)
    }

    // ── Location badge precedence (web `locationBadge`) ────────────────────────────
    @Test
    fun locationKindFollowsHomeWorkFavoriteOtherPrecedence() {
        assertEquals(DestinationLocationKind.Home, DestinationETAProjection.locationKindFor(navigating(home = true, work = true)))
        assertEquals(DestinationLocationKind.Work, DestinationETAProjection.locationKindFor(navigating(work = true, favorite = true)))
        assertEquals(DestinationLocationKind.Favorite, DestinationETAProjection.locationKindFor(navigating(favorite = true)))
        assertEquals(DestinationLocationKind.Other, DestinationETAProjection.locationKindFor(navigating()))
        assertEquals(DestinationLocationKind.Other, DestinationETAProjection.locationKindFor(null))
    }

    @Test
    fun locationKindCarriesItsEmoji() {
        assertEquals("\uD83C\uDFE0", DestinationLocationKind.Home.emoji)
        assertEquals("\uD83C\uDFE2", DestinationLocationKind.Work.emoji)
        assertEquals("\u2B50", DestinationLocationKind.Favorite.emoji)
        assertEquals("\uD83D\uDCCD", DestinationLocationKind.Other.emoji)
    }

    // ── Progress formula (web `progressPercent`) ───────────────────────────────────
    @Test
    fun progressPercentMatchesWebFormula() {
        // 100 - (m / (m + 1)) * 100
        assertEquals(50.0, DestinationETAProjection.progressPercent(true, 1.0), 1e-6)
        assertEquals(25.0, DestinationETAProjection.progressPercent(true, 3.0), 1e-6)
    }

    @Test
    fun progressPercentIsZeroWhenNotNavigatingOrNoDistance() {
        assertEquals(0.0, DestinationETAProjection.progressPercent(false, 100.0), 0.0)
        assertEquals(0.0, DestinationETAProjection.progressPercent(true, 0.0), 0.0)
        assertEquals(0.0, DestinationETAProjection.progressPercent(true, -5.0), 0.0)
    }

    // ── ETA countdown (web `etaDisplay`) ───────────────────────────────────────────
    @Test
    fun formatEtaCountdownDropsHourWhenUnderAnHour() {
        assertEquals("0m", DestinationETAProjection.formatEtaCountdown(0.0))
        assertEquals("30m", DestinationETAProjection.formatEtaCountdown(30.0))
        assertEquals("59m", DestinationETAProjection.formatEtaCountdown(59.0))
    }

    @Test
    fun formatEtaCountdownShowsHoursAndMinutes() {
        assertEquals("1h 30m", DestinationETAProjection.formatEtaCountdown(90.0))
        assertEquals("2h 5m", DestinationETAProjection.formatEtaCountdown(125.0))
    }

    @Test
    fun formatEtaCountdownReproducesWebNoCarryEdge() {
        // floor(119.7/60)=1h, round(119.7%60)=round(59.7)=60m -> the web's no-carry "1h 60m".
        assertEquals("1h 60m", DestinationETAProjection.formatEtaCountdown(119.7))
    }

    // ── Projection: navigating ─────────────────────────────────────────────────────
    @Test
    fun projectNavigatingInKilometres() {
        val display = project(navigating(meters = 5_000.0, minutes = 90.0))
        assertTrue(display.hasSnapshot)
        assertTrue(display.isNavigating)
        assertEquals("Tesla HQ", display.destinationName)
        assertEquals(90, display.minutesToArrivalRounded)
        assertEquals("1h 30m", display.etaCountdownText)
        assertEquals("5.0", display.distanceText)
        assertEquals("km", display.distanceUnitLabel)
        assertEquals("90 min, ETA", display.compactEtaContentDescription)
        assertEquals("Remaining 5.0 km", display.remainingContentDescription)
    }

    @Test
    fun projectNavigatingConvertsDistanceToMiles() {
        // 1609.344 m == exactly 1 mile.
        val display = project(navigating(meters = 1_609.344), distance = DistanceUnitPref.MI)
        assertEquals("1.0", display.distanceText)
        assertEquals("mi", display.distanceUnitLabel)
    }

    @Test
    fun projectNavigatingGroupsLargeDistance() {
        // 1,500,000 m -> 1,500.0 km, grouped en-US.
        val display = project(navigating(meters = 1_500_000.0))
        assertEquals("1,500.0", display.distanceText)
    }

    @Test
    fun projectRoundsArrivalMinutes() {
        assertEquals(46, project(navigating(minutes = 45.6)).minutesToArrivalRounded)
    }

    // ── Projection: idle (present snapshot, not navigating) ────────────────────────
    @Test
    fun projectIdleSnapshotShowsLocationBadgeNotEmpty() {
        val display = project(navigating(destination = null, home = true))
        assertTrue(display.hasSnapshot)
        assertFalse(display.isNavigating)
        assertEquals(DestinationLocationKind.Home, display.locationKind)
        assertEquals("Home", display.locationLabel)
    }

    // ── Projection: null snapshot (web `!snapshot` empty body) ─────────────────────
    @Test
    fun projectNullSnapshotIsEmptyBody() {
        val display = project(null)
        assertFalse(display.hasSnapshot)
        assertFalse(display.isNavigating)
        assertEquals(DestinationLocationKind.Other, display.locationKind)
        assertEquals("\u2014", display.destinationName)
        assertEquals("No location data", display.noDataText)
    }

    @Test
    fun projectHonoursCompactFootprint() {
        assertTrue(project(navigating(), size = DestinationETASize(cols = 1, rows = 2)).isCompact)
        assertFalse(project(navigating(), size = DestinationETASize(cols = 2, rows = 2)).isCompact)
    }

    // ── Registry metadata (web registry/maps.ts `destination-eta`) ─────────────────
    @Test
    fun registrationMatchesWebRegistry() {
        assertEquals("destination-eta", DestinationETARegistration.ID)
        assertEquals("maps", DestinationETARegistration.CATEGORY)
        assertEquals("DestinationETAWidget", DestinationETARegistration.SLUG)
        assertEquals(DestinationETASize(cols = 2, rows = 2), DestinationETARegistration.defaultSize)
        assertEquals(DestinationETASize(cols = 1, rows = 2), DestinationETARegistration.minSize)
        assertEquals(DestinationETASize(cols = 3, rows = 40), DestinationETARegistration.maxSize)
    }

    @Test
    fun sizeBoundsAndClampHonourTheRegistryFootprint() {
        assertTrue(DestinationETARegistration.withinBounds(DestinationETASize(cols = 2, rows = 4)))
        assertFalse(DestinationETARegistration.withinBounds(DestinationETASize(cols = 4, rows = 4)))
        assertFalse(DestinationETARegistration.withinBounds(DestinationETASize(cols = 1, rows = 1)))
        assertEquals(DestinationETASize(cols = 3, rows = 40), DestinationETARegistration.clamp(DestinationETASize(cols = 9, rows = 99)))
        assertEquals(DestinationETASize(cols = 1, rows = 2), DestinationETARegistration.clamp(DestinationETASize(cols = 0, rows = 0)))
    }

    // ── Resource mapper preserves freshness ────────────────────────────────────────
    @Test
    fun resourceMapperPreservesSuccessFlags() {
        val element = Json.parseToJsonElement("""{"destination_name":"Tesla HQ","minutes_to_arrival":10}""")
        val mapped = Resource.Success(element, fetchedAt = 100L, stale = false).toLocationSnapshot()
        val success = mapped as Resource.Success
        assertEquals("Tesla HQ", success.data?.destinationName)
        assertEquals(100L, success.fetchedAt)
    }

    @Test
    fun resourceMapperPreservesErrorAndCachedFlags() {
        val element = Json.parseToJsonElement("""{"destination_name":"Tesla HQ"}""")
        val mapped = Resource.Error(element, fetchedAt = 50L, stale = true, error = ApiError.Timeout()).toLocationSnapshot()
        val error = mapped as Resource.Error
        assertEquals("Tesla HQ", error.cached?.destinationName)
        assertTrue(error.stale)
        assertEquals(50L, error.fetchedAt)
    }

    @Test
    fun resourceMapperPreservesLoadingCache() {
        val element = Json.parseToJsonElement("""{"destination_name":"Tesla HQ"}""")
        val mapped = Resource.Loading(cached = element, fetchedAt = 10L, stale = false).toLocationSnapshot()
        val loading = mapped as Resource.Loading
        assertEquals("Tesla HQ", loading.cached?.destinationName)
    }
}
