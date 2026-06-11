package io.teslasync.android.dashboard.widgets.tripsummary

import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.presentation.trips.Trip
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneOffset
import java.util.Locale

/**
 * Off-device verification of the TripSummaryWidget's pure logic — the empty / last-trip / recent-rows
 * projection, the SI-metres → display-unit distance conversion (km default + miles preference), the
 * `formatDurationRange` whole-minute derivation, the short-date formatting, the `name ?? 'Unnamed trip'`
 * fallback, the `recentTrips.slice(0,3).slice(1)` selection, the folded TalkBack content descriptions,
 * and the registry metadata. Mirrors the web spec
 * (web/src/features/dashboard/widgets/TripSummaryWidget.tsx); locale + zone are pinned for determinism.
 */
class TripSummaryProjectionTest {
    private val strings =
        TripSummaryStrings(
            title = "Trip Summary",
            noTrips = "No trips recorded yet",
            lastTrip = "Last Trip",
            tripUnnamed = "Unnamed trip",
            distance = "Distance",
            duration = "Duration",
            drives = "Drives",
            chargeStops = "Charge Stops",
            recentTrips = "Recent Trips",
            drivesShort = "drv",
        )

    private val metricUnits = UnitFormatter.default()
    private val imperialUnits =
        UnitFormatter(UnitPreferences.fromSettings(buildJsonObject { put("unit_of_length", "mi") }))

    // Each field is independently overridden per test case; @Suppress keeps this fixture builder readable.
    @Suppress("LongParameterList")
    private fun trip(
        id: Long = 1L,
        name: String? = "Trip $id",
        distanceMeters: Double = 10_000.0,
        startDate: String = "2026-06-09T08:00:00Z",
        endDate: String? = "2026-06-09T09:00:00Z",
        driveCount: Long = 1L,
        chargeCount: Long = 0L,
    ): Trip =
        Trip(
            id = id,
            vehicleId = 1L,
            name = name,
            startDate = startDate,
            endDate = endDate,
            startedAt = startDate,
            endedAt = endDate,
            totalDistanceM = distanceMeters,
            totalEnergyWh = 0.0,
            totalDurationS = 0L,
            totalCost = 0.0,
            driveCount = driveCount,
            chargeCount = chargeCount,
            createdAt = startDate,
        )

    private fun project(
        trips: List<Trip>,
        units: UnitFormatter = metricUnits,
    ) = TripSummaryProjection.project(trips, strings, units, ZoneOffset.UTC, Locale.US)

    // ---- empty ------------------------------------------------------------------------

    @Test
    fun emptyListIsEmptyProjection() {
        val display = project(emptyList())
        assertFalse(display.hasTrips)
        assertNull(display.lastTrip)
        assertTrue(display.recentRows.isEmpty())
        assertEquals("No trips recorded yet", display.emptyMessage)
        assertEquals("Recent Trips", display.recentTitle)
    }

    // ---- last trip --------------------------------------------------------------------

    @Test
    fun lastTripIsFirstTrip() {
        val display = project(listOf(trip(id = 1, name = "Home → Office"), trip(id = 2, name = "Errand")))
        val card = display.lastTrip!!
        assertTrue(display.hasTrips)
        assertEquals("Last Trip", card.badge)
        assertEquals("Home → Office", card.title)
        assertEquals("Jun 9", card.date)
    }

    @Test
    fun unnamedFallbackWhenNameNull() {
        val card = project(listOf(trip(name = null))).lastTrip!!
        assertEquals("Unnamed trip", card.title)
    }

    @Test
    fun lastTripStatLabelsComeFromStrings() {
        val card = project(listOf(trip())).lastTrip!!
        assertEquals("Distance", card.distance.label)
        assertEquals("Duration", card.duration.label)
        assertEquals("Drives", card.drives.label)
        assertEquals("Charge Stops", card.chargeStops.label)
    }

    // ---- distance (SI → display) ------------------------------------------------------

    @Test
    fun distanceFormattedAsKilometresByDefault() {
        val card = project(listOf(trip(distanceMeters = 23_400.0))).lastTrip!!
        assertEquals("23.4 km", card.distance.value)
    }

    @Test
    fun distanceGroupsThousandsAtOneDecimal() {
        val card = project(listOf(trip(distanceMeters = 1_234_560.0))).lastTrip!!
        assertEquals("1,234.6 km", card.distance.value)
    }

    @Test
    fun distanceFormattedAsMilesWhenPreferred() {
        val card = project(listOf(trip(distanceMeters = 23_400.0)), imperialUnits).lastTrip!!
        assertEquals("14.5 mi", card.distance.value)
    }

    // ---- duration (formatDurationRange) -----------------------------------------------

    @Test
    fun durationIsWholeMinuteGapWithHours() {
        val card =
            project(listOf(trip(startDate = "2026-06-09T08:05:00Z", endDate = "2026-06-09T09:10:00Z"))).lastTrip!!
        assertEquals("1h 5m", card.duration.value)
    }

    @Test
    fun durationSubHourOmitsHours() {
        val card =
            project(listOf(trip(startDate = "2026-06-09T18:20:00Z", endDate = "2026-06-09T18:46:00Z"))).lastTrip!!
        assertEquals("26m", card.duration.value)
    }

    @Test
    fun durationEmDashWhenEndMissingOrNonPositive() {
        assertEquals(EM_DASH, project(listOf(trip(endDate = null))).lastTrip!!.duration.value)
        assertEquals(
            EM_DASH,
            project(listOf(trip(startDate = "2026-06-09T09:00:00Z", endDate = "2026-06-09T08:00:00Z")))
                .lastTrip!!
                .duration.value,
        )
    }

    @Test
    fun formatDurationMinutesMatchesWebShape() {
        assertEquals("0m", TripSummaryProjection.formatDurationMinutes(0))
        assertEquals("5m", TripSummaryProjection.formatDurationMinutes(5))
        assertEquals("1h 0m", TripSummaryProjection.formatDurationMinutes(60))
        assertEquals("2h 5m", TripSummaryProjection.formatDurationMinutes(125))
        assertEquals(EM_DASH, TripSummaryProjection.formatDurationMinutes(-1))
    }

    // ---- counts -----------------------------------------------------------------------

    @Test
    fun driveAndChargeCountsRender() {
        val card = project(listOf(trip(driveCount = 3, chargeCount = 2))).lastTrip!!
        assertEquals("3", card.drives.value)
        assertEquals("2", card.chargeStops.value)
    }

    @Test
    fun countGroupsThousands() {
        assertEquals("1,234", TripSummaryProjection.formatCount(1_234, Locale.US))
    }

    // ---- short date -------------------------------------------------------------------

    @Test
    fun shortDateIsMonthAndDay() {
        assertEquals("Jun 9", TripSummaryProjection.formatDateShort("2026-06-09T08:00:00Z", ZoneOffset.UTC, Locale.US))
    }

    @Test
    fun shortDateEmDashForMissingOrGarbage() {
        assertEquals(EM_DASH, TripSummaryProjection.formatDateShort(null, ZoneOffset.UTC, Locale.US))
        assertEquals(EM_DASH, TripSummaryProjection.formatDateShort("not-a-date", ZoneOffset.UTC, Locale.US))
    }

    // ---- recent rows (slice(0,3).slice(1)) --------------------------------------------

    @Test
    fun recentRowsAreSecondAndThirdTrips() {
        val display =
            project(
                listOf(
                    trip(id = 1, name = "First"),
                    trip(id = 2, name = "Second"),
                    trip(id = 3, name = "Third"),
                ),
            )
        assertEquals(listOf(2L, 3L), display.recentRows.map { it.id })
        assertEquals(listOf("Second", "Third"), display.recentRows.map { it.title })
    }

    @Test
    fun recentRowsEmptyWhenSingleTrip() {
        assertTrue(project(listOf(trip(id = 1))).recentRows.isEmpty())
    }

    @Test
    fun recentRowsCappedAtTwo() {
        val display = (1L..5L).map { trip(id = it, name = "Trip $it") }.let { project(it) }
        // web slices the first three then drops the head → at most two recent rows.
        assertEquals(2, display.recentRows.size)
        assertEquals(listOf(2L, 3L), display.recentRows.map { it.id })
    }

    @Test
    fun recentRowDrivesBadgeUsesShortLabel() {
        val display = project(listOf(trip(id = 1), trip(id = 2, driveCount = 4)))
        assertEquals("4 drv", display.recentRows.single().drivesBadge)
    }

    @Test
    fun recentRowUnnamedFallback() {
        val display = project(listOf(trip(id = 1), trip(id = 2, name = null)))
        assertEquals("Unnamed trip", display.recentRows.single().title)
    }

    // ---- accessibility ----------------------------------------------------------------

    @Test
    fun lastTripContentDescriptionFoldsEveryFact() {
        val card =
            project(
                listOf(
                    trip(
                        name = "Home → Office",
                        distanceMeters = 23_400.0,
                        startDate = "2026-06-09T08:05:00Z",
                        endDate = "2026-06-09T09:10:00Z",
                        driveCount = 2,
                        chargeCount = 1,
                    ),
                ),
            ).lastTrip!!
        assertEquals(
            "Last Trip: Home → Office, Jun 9, Distance 23.4 km, Duration 1h 5m, Drives 2, Charge Stops 1",
            card.contentDescription,
        )
    }

    @Test
    fun recentRowContentDescriptionFoldsRowFacts() {
        val display =
            project(
                listOf(
                    trip(id = 1, name = "First"),
                    trip(
                        id = 2,
                        name = "Errand",
                        distanceMeters = 9_100.0,
                        startDate = "2026-06-04T18:20:00Z",
                        endDate = "2026-06-04T18:46:00Z",
                        driveCount = 1,
                    ),
                ),
            )
        assertEquals("Errand, Jun 4, 9.1 km, 26m, 1 drv", display.recentRows.single().contentDescription)
    }

    // ---- registry metadata ------------------------------------------------------------

    @Test
    fun registrationMatchesWebRegistry() {
        assertEquals("trip-summary", TripSummaryRegistration.ID)
        assertEquals("driving", TripSummaryRegistration.CATEGORY)
        assertEquals("TripSummaryWidget", TripSummaryRegistration.SLUG)
        assertEquals(5, TripSummaryRegistration.FETCH_LIMIT)
        assertEquals(TripSummarySize(2, 4), TripSummaryRegistration.DEFAULT_SIZE)
        assertEquals(TripSummarySize(1, 2), TripSummaryRegistration.MIN_SIZE)
        assertEquals(TripSummarySize(4, 40), TripSummaryRegistration.MAX_SIZE)
    }

    @Test
    fun registrationClampAndBounds() {
        assertEquals(TripSummarySize(1, 2), TripSummaryRegistration.clamp(TripSummarySize(0, 1)))
        assertEquals(TripSummarySize(4, 40), TripSummaryRegistration.clamp(TripSummarySize(9, 99)))
        assertTrue(TripSummaryRegistration.isWithinBounds(TripSummarySize(2, 4)))
        assertFalse(TripSummaryRegistration.isWithinBounds(TripSummarySize(5, 4)))
    }

    @Test
    fun sizeCompactFlag() {
        assertTrue(TripSummarySize(1, 2).isCompact)
        assertFalse(TripSummarySize(2, 4).isCompact)
        assertFalse(TripSummarySize(4, 40).isCompact)
    }
}
