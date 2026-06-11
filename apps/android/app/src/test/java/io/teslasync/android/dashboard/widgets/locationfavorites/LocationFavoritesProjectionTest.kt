package io.teslasync.android.dashboard.widgets.locationfavorites

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.shared.core.presentation.locations.VisitedLocation
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.util.Locale

/**
 * Off-device verification of the LocationFavoritesWidget's pure logic — the snapshot JSON parse adapter,
 * the location-badge precedence, the visited-location sort/slice/bar math, the visit-count + relative
 * "last visited" formatting, the registry metadata, and the footprint bounds. Mirrors the web spec
 * (web/src/features/dashboard/widgets/LocationFavoritesWidget.tsx) verbatim, including the
 * `WidgetRankedList` top-five-by-visit-count slice and the `formatRelative` cutoffs.
 */
class LocationFavoritesProjectionTest {
    private val now: Long = Instant.parse("2026-04-15T12:00:00Z").toEpochMilli()

    private fun strings(): LocationFavoritesStrings =
        LocationFavoritesStrings(
            title = "Favorite Locations",
            home = "Home",
            work = "Work",
            favorite = "Favorite",
            other = "Other",
            noData = "No favorite locations",
            refreshLabel = "Refresh",
            refreshingLabel = "Loading\u2026",
            offlineLabel = "Offline",
            relativeJustNow = "just now",
            relativeMinutesFmt = "%1\$sm ago",
            relativeHoursFmt = "%1\$sh ago",
            relativeDaysFmt = "%1\$sd ago",
            formatFreshnessAge = { "" },
        )

    private fun loc(
        id: Long,
        name: String,
        visits: Long,
        lastVisited: String? = null,
    ): VisitedLocation =
        VisitedLocation(
            id = id,
            vehicleId = 1L,
            addressName = name,
            visitCount = visits,
            lastVisited = lastVisited,
            createdAt = "2026-01-01T00:00:00Z",
        )

    private fun project(
        data: LocationFavoritesData?,
        size: LocationFavoritesSize = LocationFavoritesRegistration.defaultSize,
    ): LocationFavoritesDisplay = LocationFavoritesProjection.project(data, size, now, strings(), Locale.US)

    // ── Snapshot JSON parse ──────────────────────────────────────────────────────
    @Test
    fun fromJsonParsesBadgeFlagsAndDestination() {
        val element =
            Json.parseToJsonElement(
                """{"located_at_home":true,"located_at_work":false,"destination_name":"Tesla HQ"}""",
            )
        val snapshot = LocationStatusSnapshot.fromJson(element)!!
        assertTrue(snapshot.locatedAtHome)
        assertFalse(snapshot.locatedAtWork)
        assertEquals("Tesla HQ", snapshot.destinationName)
    }

    @Test
    fun fromJsonReturnsNullForNonObjectOrNull() {
        assertNull(LocationStatusSnapshot.fromJson(Json.parseToJsonElement("\"oops\"")))
        assertNull(LocationStatusSnapshot.fromJson(Json.parseToJsonElement("42")))
        assertNull(LocationStatusSnapshot.fromJson(null))
    }

    @Test
    fun fromJsonToleratesMissingFields() {
        val snapshot = LocationStatusSnapshot.fromJson(Json.parseToJsonElement("{}"))!!
        assertNull(snapshot.destinationName)
        assertFalse(snapshot.locatedAtHome)
        assertFalse(snapshot.locatedAtWork)
        assertFalse(snapshot.locatedAtFavorite)
    }

    // ── Badge precedence (web `locationBadge`) ────────────────────────────────────
    @Test
    fun badgeKindFollowsHomeWorkFavoriteOtherPrecedence() {
        val home = LocationStatusSnapshot(null, locatedAtHome = true, locatedAtWork = true, locatedAtFavorite = true)
        val work = LocationStatusSnapshot(null, locatedAtHome = false, locatedAtWork = true, locatedAtFavorite = true)
        val fav = LocationStatusSnapshot(null, locatedAtHome = false, locatedAtWork = false, locatedAtFavorite = true)
        val other = LocationStatusSnapshot(null, locatedAtHome = false, locatedAtWork = false, locatedAtFavorite = false)
        assertEquals(LocationBadgeKind.Home, LocationFavoritesProjection.badgeKindFor(home))
        assertEquals(LocationBadgeKind.Work, LocationFavoritesProjection.badgeKindFor(work))
        assertEquals(LocationBadgeKind.Favorite, LocationFavoritesProjection.badgeKindFor(fav))
        assertEquals(LocationBadgeKind.Other, LocationFavoritesProjection.badgeKindFor(other))
        assertEquals(LocationBadgeKind.Other, LocationFavoritesProjection.badgeKindFor(null))
    }

    @Test
    fun badgeKindCarriesItsEmoji() {
        assertEquals("\uD83C\uDFE0", LocationBadgeKind.Home.emoji)
        assertEquals("\uD83C\uDFE2", LocationBadgeKind.Work.emoji)
        assertEquals("\u2B50", LocationBadgeKind.Favorite.emoji)
        assertEquals("\uD83D\uDCCD", LocationBadgeKind.Other.emoji)
    }

    // ── Ranked rows (web `items` + `WidgetRankedList`) ────────────────────────────
    @Test
    fun rowsAreSortedByVisitCountDescendingAndCappedAtFive() {
        val locations =
            listOf(
                loc(1, "A", 10),
                loc(2, "B", 50),
                loc(3, "C", 30),
                loc(4, "D", 5),
                loc(5, "E", 20),
                loc(6, "F", 40),
            )
        val display = project(LocationFavoritesData(locations, null))
        assertTrue(display.hasItems)
        assertEquals(LocationFavoritesRegistration.MAX_RANKED_ITEMS, display.rows.size)
        assertEquals(listOf(50L, 40L, 30L, 20L, 10L), display.rows.map { it.value })
        // The least-visited row (5) is dropped by the top-five slice.
        assertFalse(display.rows.any { it.id == 4L })
    }

    @Test
    fun barFractionScalesAgainstTheVisibleMaximum() {
        val display = project(LocationFavoritesData(listOf(loc(1, "A", 100), loc(2, "B", 25)), null))
        assertEquals(1.0f, display.rows[0].barFraction, 1e-6f)
        assertEquals(0.25f, display.rows[1].barFraction, 1e-6f)
    }

    @Test
    fun formattedValueCombinesGroupedCountAndRelativeVisit() {
        val twoDaysAgo = Instant.ofEpochMilli(now - 2 * 86_400_000L).toString()
        val display = project(LocationFavoritesData(listOf(loc(1, "Garage", 1_234, twoDaysAgo)), null))
        assertEquals("1,234\u00D7 \u00B7 2d ago", display.rows[0].formattedValue)
    }

    @Test
    fun formattedValueUsesDashWhenNeverVisited() {
        val display = project(LocationFavoritesData(listOf(loc(1, "Garage", 3, null)), null))
        assertEquals("3\u00D7 \u00B7 \u2014", display.rows[0].formattedValue)
    }

    @Test
    fun blankAddressFallsBackToDash() {
        val display = project(LocationFavoritesData(listOf(loc(1, "", 3)), null))
        assertEquals("\u2014", display.rows[0].label)
    }

    @Test
    fun rowContentDescriptionCarriesRankLabelAndValue() {
        val display = project(LocationFavoritesData(listOf(loc(1, "Garage", 3, null)), null))
        assertEquals("1. Garage, 3\u00D7 \u00B7 \u2014", display.rows[0].contentDescription)
    }

    // ── Badge / destination projection ────────────────────────────────────────────
    @Test
    fun projectResolvesBadgeAndDestinationHint() {
        val snapshot = LocationStatusSnapshot("Supercharger", locatedAtHome = true, locatedAtWork = false, locatedAtFavorite = false)
        val display = project(LocationFavoritesData(emptyList(), snapshot))
        assertEquals(LocationBadgeKind.Home, display.badgeKind)
        assertEquals("Home", display.badgeLabel)
        assertEquals("Supercharger", display.destinationName)
        assertFalse(display.hasItems)
        assertEquals("No favorite locations", display.emptyMessage)
    }

    @Test
    fun destinationHintIsNullWhenBlankOrNotNavigating() {
        val blank = LocationStatusSnapshot("", locatedAtHome = false, locatedAtWork = false, locatedAtFavorite = false)
        assertNull(project(LocationFavoritesData(emptyList(), blank)).destinationName)
        assertNull(project(LocationFavoritesData(emptyList(), null)).destinationName)
    }

    @Test
    fun nullDataProjectsToEmptyOtherBadge() {
        val display = project(null)
        assertFalse(display.hasItems)
        assertEquals(LocationBadgeKind.Other, display.badgeKind)
        assertEquals("Other", display.badgeLabel)
    }

    @Test
    fun projectHonoursCompactFootprint() {
        assertTrue(project(LocationFavoritesData(emptyList(), null), LocationFavoritesSize(cols = 1, rows = 2)).isCompact)
        assertFalse(project(LocationFavoritesData(emptyList(), null), LocationFavoritesSize(cols = 2, rows = 4)).isCompact)
    }

    // ── Relative-time formatter (web `formatRelative`) ────────────────────────────
    @Test
    fun relativeTimeReproducesWebCutoffs() {
        fun ago(deltaMillis: Long): String =
            LocationRelativeTime.format(Instant.ofEpochMilli(now - deltaMillis).toString(), now, strings(), Locale.US)
        assertEquals("just now", ago(30_000L))
        assertEquals("5m ago", ago(5 * 60_000L))
        assertEquals("3h ago", ago(3 * 3_600_000L))
        assertEquals("2d ago", ago(2 * 86_400_000L))
    }

    @Test
    fun relativeTimeFallsBackToAbsoluteDateBeyondAWeek() {
        val tenDaysAgo = Instant.ofEpochMilli(now - 10 * 86_400_000L).toString()
        val label = LocationRelativeTime.format(tenDaysAgo, now, strings(), Locale.US)
        assertFalse(label.contains("ago"))
        assertTrue(label.contains("2026"))
    }

    @Test
    fun relativeTimeReturnsDashForNullOrUnparseable() {
        assertEquals("\u2014", LocationRelativeTime.format(null, now, strings(), Locale.US))
        assertEquals("\u2014", LocationRelativeTime.format("not-a-date", now, strings(), Locale.US))
        assertEquals("\u2014", LocationRelativeTime.format("", now, strings(), Locale.US))
    }

    @Test
    fun parseIsoMillisToleratesInstantOffsetAndBareDateTime() {
        val expected = Instant.parse("2026-04-04T02:30:00Z").toEpochMilli()
        assertEquals(expected, LocationRelativeTime.parseIsoMillis("2026-04-04T02:30:00Z"))
        assertEquals(expected, LocationRelativeTime.parseIsoMillis("2026-04-04T02:30:00+00:00"))
        assertEquals(expected, LocationRelativeTime.parseIsoMillis("2026-04-04T02:30:00"))
        assertNull(LocationRelativeTime.parseIsoMillis("garbage"))
    }

    @Test
    fun futureTimestampClampsToJustNow() {
        val future = Instant.ofEpochMilli(now + 60_000L).toString()
        assertEquals("just now", LocationRelativeTime.format(future, now, strings(), Locale.US))
    }

    // ── Freshness formatter wiring (shared with the header chip) ──────────────────
    @Test
    fun freshnessFormatterRoundTripsThroughStrings() {
        val s =
            strings().copy(
                formatFreshnessAge = { age -> if (age is FreshnessAge.Minutes) "${age.value}m ago" else "?" },
            )
        assertEquals("4m ago", s.formatFreshnessAge(FreshnessAge.Minutes(4)))
    }

    // ── Registry metadata (web registry/maps.ts `location-favorites`) ─────────────
    @Test
    fun registrationMatchesWebRegistry() {
        assertEquals("location-favorites", LocationFavoritesRegistration.ID)
        assertEquals("maps", LocationFavoritesRegistration.CATEGORY)
        assertEquals("LocationFavoritesWidget", LocationFavoritesRegistration.SLUG)
        assertEquals(LocationFavoritesSize(cols = 2, rows = 4), LocationFavoritesRegistration.defaultSize)
        assertEquals(LocationFavoritesSize(cols = 1, rows = 2), LocationFavoritesRegistration.minSize)
        assertEquals(LocationFavoritesSize(cols = 4, rows = 40), LocationFavoritesRegistration.maxSize)
        assertEquals(5, LocationFavoritesRegistration.MAX_RANKED_ITEMS)
    }

    @Test
    fun sizeBoundsAndClampHonourTheRegistryFootprint() {
        assertTrue(LocationFavoritesRegistration.withinBounds(LocationFavoritesSize(cols = 2, rows = 4)))
        assertFalse(LocationFavoritesRegistration.withinBounds(LocationFavoritesSize(cols = 5, rows = 4)))
        assertFalse(LocationFavoritesRegistration.withinBounds(LocationFavoritesSize(cols = 1, rows = 1)))
        assertEquals(
            LocationFavoritesSize(cols = 4, rows = 40),
            LocationFavoritesRegistration.clamp(LocationFavoritesSize(cols = 9, rows = 99)),
        )
        assertEquals(
            LocationFavoritesSize(cols = 1, rows = 2),
            LocationFavoritesRegistration.clamp(LocationFavoritesSize(cols = 0, rows = 0)),
        )
    }

    // ── Data emptiness gate ───────────────────────────────────────────────────────
    @Test
    fun dataIsEmptyOnlyWhenNoRowsAndNoSnapshot() {
        assertTrue(LocationFavoritesData.EMPTY.isEmpty)
        assertFalse(LocationFavoritesData(listOf(loc(1, "A", 1)), null).isEmpty)
        val snap = LocationStatusSnapshot(null, locatedAtHome = true, locatedAtWork = false, locatedAtFavorite = false)
        assertFalse(LocationFavoritesData(emptyList(), snap).isEmpty)
    }
}
