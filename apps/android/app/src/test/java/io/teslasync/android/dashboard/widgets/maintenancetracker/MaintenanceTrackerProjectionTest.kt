package io.teslasync.android.dashboard.widgets.maintenancetracker

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
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
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the MaintenanceTrackerWidget's pure logic — the web `getUrgency` heuristic,
 * the `intervalMonths ?? 0` sort + next-item selection, the recent-record selection/mapping, the SI→display
 * distance + currency + date formatting, the cache-then-network state fold (loading / content / empty /
 * hard error / offline / records-error tolerance), and the registry metadata. Mirrors the web spec
 * (web/src/features/dashboard/widgets/MaintenanceTrackerWidget.tsx) against the snake_case wire contract.
 */
class MaintenanceTrackerProjectionTest {
    private val strings =
        MaintenanceTrackerStrings(
            title = "Maintenance",
            overdue = "Overdue",
            soon = "Soon",
            good = "Good",
            monthsLeft = "months",
            noData = "No maintenance data",
            nextService = "Next Service",
            every = "Every",
            months = "mo",
            recentService = "Recent Service",
            noRecords = "No service records yet",
        )

    private fun prefs(distance: DistanceUnitPref = DistanceUnitPref.KM): MaintenanceTrackerDisplayPrefs =
        MaintenanceTrackerDisplayPrefs(
            unitPref =
                UnitPref(
                    distance = distance,
                    speed = SpeedUnitPref.KMH,
                    temperature = TemperatureUnitPref.CELSIUS,
                    pressure = PressureUnitPref.KPA,
                    energy = EnergyUnitPref.KWH,
                    duration = DurationUnitPref.HOURS,
                    power = PowerUnitPref.KW,
                ),
            currencySymbol = "$",
            precision = 2,
        )

    // ── Urgency heuristic (web getUrgency) ─────────────────────────────────────

    @Test
    fun urgencyOverdueAtOrBelowZero() {
        assertEquals(Urgency.Overdue, MaintenanceTrackerProjection.urgencyFor(0.0))
        assertEquals(Urgency.Overdue, MaintenanceTrackerProjection.urgencyFor(-5.0))
    }

    @Test
    fun urgencySoonThroughThreeMonths() {
        assertEquals(Urgency.Soon, MaintenanceTrackerProjection.urgencyFor(1.0))
        assertEquals(Urgency.Soon, MaintenanceTrackerProjection.urgencyFor(3.0))
    }

    @Test
    fun urgencyGoodAboveThreeMonths() {
        assertEquals(Urgency.Good, MaintenanceTrackerProjection.urgencyFor(4.0))
        assertEquals(Urgency.Good, MaintenanceTrackerProjection.urgencyFor(24.0))
    }

    // ── project(): next-service selection + formatting ─────────────────────────

    @Test
    fun nextItemIsLowestIntervalWithNullsTreatedAsZero() {
        // Mirrors the deployed backend: Tire Rotation has a null interval_months (→ 0 → overdue, sorts first).
        val data =
            MaintenanceTrackerData(
                items =
                    listOf(
                        MaintenanceItem("6", "Wiper Blades", intervalMonths = 12.0, intervalKm = null, estimatedCostUsd = null),
                        MaintenanceItem("2", "Tire Rotation", intervalMonths = null, intervalKm = null, estimatedCostUsd = null),
                    ),
                records = emptyList(),
            )
        val display = MaintenanceTrackerProjection.project(data, prefs(), strings)

        assertTrue(display.hasData)
        assertTrue(display.hasNextItem)
        val card = requireNotNull(display.nextService)
        assertEquals("Tire Rotation", card.name)
        assertEquals(Urgency.Overdue, card.urgency)
        assertEquals("Overdue", card.urgencyLabel)
        assertEquals("Every 0 mo", card.everyText)
        // intervalKm is absent on the wire (backend serves interval_miles) → web renders 0; native matches.
        assertEquals("0 km", card.distanceText)
        assertNull(card.costText)
    }

    @Test
    fun nextServiceShowsCostWhenPresentAndPositive() {
        val data =
            MaintenanceTrackerData(
                items = listOf(MaintenanceItem("1", "Brake Fluid", intervalMonths = 24.0, intervalKm = null, estimatedCostUsd = 120.0)),
                records = emptyList(),
            )
        val card = requireNotNull(MaintenanceTrackerProjection.project(data, prefs(), strings).nextService)
        assertEquals(Urgency.Good, card.urgency)
        assertEquals("Good", card.urgencyLabel)
        assertEquals("Every 24 mo", card.everyText)
        assertEquals("$120.00", card.costText)
    }

    @Test
    fun nextServiceHidesZeroOrAbsentCost() {
        val zero = MaintenanceItem("1", "A", intervalMonths = 6.0, intervalKm = null, estimatedCostUsd = 0.0)
        val absent = MaintenanceItem("2", "B", intervalMonths = 6.0, intervalKm = null, estimatedCostUsd = null)
        val zeroCard = MaintenanceTrackerProjection.project(MaintenanceTrackerData(listOf(zero), emptyList()), prefs(), strings)
        val absentCard = MaintenanceTrackerProjection.project(MaintenanceTrackerData(listOf(absent), emptyList()), prefs(), strings)
        assertNull(zeroCard.nextService?.costText)
        assertNull(absentCard.nextService?.costText)
    }

    @Test
    fun distanceTextHonoursMileagePreference() {
        val data = MaintenanceTrackerData(listOf(MaintenanceItem("1", "A", 6.0, intervalKm = null, estimatedCostUsd = null)), emptyList())
        val card = requireNotNull(MaintenanceTrackerProjection.project(data, prefs(DistanceUnitPref.MI), strings).nextService)
        assertEquals("0 mi", card.distanceText)
    }

    // ── project(): compact hero ────────────────────────────────────────────────

    @Test
    fun compactFieldsReflectNextItem() {
        val data = MaintenanceTrackerData(listOf(MaintenanceItem("6", "Wiper Blades", 12.0, null, null)), emptyList())
        val display = MaintenanceTrackerProjection.project(data, prefs(), strings)
        assertTrue(display.hasNextItem)
        assertEquals("12", display.compactMonths)
        assertEquals("Wiper Blades", display.compactName)
        assertTrue(display.compactContentDescription.contains("Wiper Blades"))
        assertTrue(display.compactContentDescription.contains("12 months"))
    }

    @Test
    fun emptyDataHasNoNextItemAndNoData() {
        val display = MaintenanceTrackerProjection.project(MaintenanceTrackerData.EMPTY, prefs(), strings)
        assertFalse(display.hasData)
        assertFalse(display.hasNextItem)
        assertNull(display.nextService)
        assertFalse(display.hasRecords)
        assertEquals("No maintenance data", display.compactContentDescription)
    }

    // ── project(): recent-service timeline ─────────────────────────────────────

    @Test
    fun recentRecordsMapToTimelineNewestFirstCappedAtThree() {
        val items = listOf(MaintenanceItem("2", "Tire Rotation", null, null, null))
        val records =
            listOf(
                ServiceRecord(itemId = "2", date = "2024-01-10", odometerKm = 0.0, notes = "oldest"),
                ServiceRecord(itemId = "2", date = "2024-05-10", odometerKm = 0.0, notes = "newest"),
                ServiceRecord(itemId = "2", date = "2024-03-10", odometerKm = 0.0, notes = "mid"),
                ServiceRecord(itemId = "2", date = "2024-02-10", odometerKm = 0.0, notes = "older"),
            )
        val display = MaintenanceTrackerProjection.project(MaintenanceTrackerData(items, records), prefs(), strings)

        assertTrue(display.hasRecords)
        assertEquals(MAX_RECENT_RECORDS, display.timelineRows.size)
        assertEquals("Tire Rotation", display.timelineRows[0].title)
        assertEquals("May 10, 2024", display.timelineRows[0].time)
        assertEquals("0 km \u00B7 newest", display.timelineRows[0].subtitle)
    }

    @Test
    fun timelineTitleFallsBackToItemIdThenEmDash() {
        val records =
            listOf(
                ServiceRecord(itemId = "unknown-id", date = "2024-01-01", odometerKm = 0.0, notes = null),
                ServiceRecord(itemId = null, date = "2023-12-01", odometerKm = 0.0, notes = null),
            )
        val display = MaintenanceTrackerProjection.project(MaintenanceTrackerData(emptyList(), records), prefs(), strings)
        assertEquals("unknown-id", display.timelineRows[0].title)
        assertEquals(EM_DASH, display.timelineRows[1].title)
        // No notes → subtitle is just the odometer distance.
        assertEquals("0 km", display.timelineRows[0].subtitle)
    }

    @Test
    fun recordsPresentButNoItemsStillCountsAsData() {
        val records = listOf(ServiceRecord("2", "2024-01-01", 0.0, null))
        val display = MaintenanceTrackerProjection.project(MaintenanceTrackerData(emptyList(), records), prefs(), strings)
        assertTrue(display.hasData)
        assertFalse(display.hasNextItem)
        assertNull(display.nextService)
        assertTrue(display.hasRecords)
    }

    // ── Formatters ─────────────────────────────────────────────────────────────

    @Test
    fun formatServiceDateRendersShortMonth() {
        assertEquals("Jan 15, 2024", MaintenanceTrackerProjection.formatServiceDate("2024-01-15"))
        assertEquals("Dec 1, 2023", MaintenanceTrackerProjection.formatServiceDate("2023-12-01T08:30:00Z"))
    }

    @Test
    fun formatServiceDateEmDashesNullBlankOrMalformed() {
        assertEquals(EM_DASH, MaintenanceTrackerProjection.formatServiceDate(null))
        assertEquals(EM_DASH, MaintenanceTrackerProjection.formatServiceDate(""))
        assertEquals(EM_DASH, MaintenanceTrackerProjection.formatServiceDate("not-a-date"))
        assertEquals(EM_DASH, MaintenanceTrackerProjection.formatServiceDate("2024-13-40"))
    }

    @Test
    fun formatCurrencyUsesSymbolPrecisionAndGrouping() {
        assertEquals("$1,234.50", MaintenanceTrackerProjection.formatCurrency(1234.5, "$", 2))
        assertEquals("€50", MaintenanceTrackerProjection.formatCurrency(50.0, "€", 0))
        assertEquals("$0.00", MaintenanceTrackerProjection.formatCurrency(0.0, "", 2))
    }

    @Test
    fun formatIntGroupsThousands() {
        assertEquals("0", MaintenanceTrackerProjection.formatInt(0.0))
        assertEquals("12", MaintenanceTrackerProjection.formatInt(12.0))
        assertEquals("10,000", MaintenanceTrackerProjection.formatInt(10000.0))
    }

    // ── parse(): wire contract ─────────────────────────────────────────────────

    @Test
    fun parseMaintenanceReadsSnakeCaseWireFields() {
        val json =
            buildJsonArray {
                add(
                    buildJsonObject {
                        put("id", 2)
                        put("name", "Tire Rotation")
                        put("interval_months", JsonNull)
                        put("interval_miles", 10000.0)
                    },
                )
            }
        val items = parseMaintenanceItems(json)
        assertEquals(1, items.size)
        assertEquals("2", items[0].id)
        assertEquals("Tire Rotation", items[0].name)
        assertNull(items[0].intervalMonths)
        // The backend never serves interval_km / estimated_cost_usd — both decode to null.
        assertNull(items[0].intervalKm)
        assertNull(items[0].estimatedCostUsd)
    }

    @Test
    fun parseHandlesNonArrayAndNonObjectGracefully() {
        assertTrue(parseMaintenanceItems(null).isEmpty())
        assertTrue(parseMaintenanceItems(buildJsonObject { put("x", 1) }).isEmpty())
        assertTrue(parseServiceRecords(null).isEmpty())
    }

    // ── foldState(): cache-then-network matrix ─────────────────────────────────

    @Test
    fun foldFirstLoadIsLoading() {
        val state = MaintenanceTrackerProjection.foldState(loading(), loading())
        assertEquals(UiPhase.Loading, state.phase)
    }

    @Test
    fun foldContentWhenMaintenanceHasItems() {
        val maintenance = Resource.Success(itemsJson(), 100L, false)
        val records = Resource.Success(emptyArrayJson(), 80L, false)
        val state = MaintenanceTrackerProjection.foldState(maintenance, records)
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(100L, state.fetchedAt)
        assertFalse(state.stale)
        assertEquals(1, state.data?.items?.size)
    }

    @Test
    fun foldEmptyWhenBothFeedsEmpty() {
        val state =
            MaintenanceTrackerProjection.foldState(
                Resource.Success(emptyArrayJson(), 10L, false),
                Resource.Success(emptyArrayJson(), 10L, false),
            )
        assertEquals(UiPhase.Empty, state.phase)
    }

    @Test
    fun foldHardErrorWhenMaintenanceFailsWithNoCache() {
        val state = MaintenanceTrackerProjection.foldState(error(cached = null), Resource.Success(emptyArrayJson(), 10L, false))
        assertEquals(UiPhase.Error, state.phase)
        assertEquals(ErrorKind.Network, state.errorKind)
    }

    @Test
    fun foldOfflineKeepsCachedMaintenanceVisible() {
        val state = MaintenanceTrackerProjection.foldState(error(cached = itemsJson()), Resource.Success(emptyArrayJson(), 50L, false))
        assertEquals(UiPhase.Content, state.phase)
        assertTrue(state.stale)
        assertEquals(ErrorKind.Network, state.errorKind)
        assertEquals(1, state.data?.items?.size)
    }

    @Test
    fun foldToleratesRecordsErrorAsSupplementary() {
        // A records failure with cached maintenance must NOT blank the surface (records are supplementary).
        val state = MaintenanceTrackerProjection.foldState(Resource.Success(itemsJson(), 100L, false), error(cached = null))
        assertEquals(UiPhase.Content, state.phase)
        assertNull(state.errorKind)
        assertFalse(state.stale)
    }

    // ── Registration metadata (parity with web registry) ───────────────────────

    @Test
    fun registrationMatchesWebRegistry() {
        assertEquals("maintenance-tracker", MaintenanceTrackerRegistration.ID)
        assertEquals("vehicle", MaintenanceTrackerRegistration.CATEGORY)
        assertEquals("MaintenanceTrackerWidget", MaintenanceTrackerRegistration.SLUG)
        assertEquals(MaintenanceTrackerSize(2, 4), MaintenanceTrackerRegistration.DEFAULT_SIZE)
        assertEquals(MaintenanceTrackerSize(1, 2), MaintenanceTrackerRegistration.MIN_SIZE)
        assertEquals(MaintenanceTrackerSize(4, 40), MaintenanceTrackerRegistration.MAX_SIZE)
    }

    @Test
    fun registrationClampsAndDetectsCompact() {
        assertEquals(MaintenanceTrackerSize(1, 2), MaintenanceTrackerRegistration.clamp(MaintenanceTrackerSize(0, 1)))
        assertEquals(MaintenanceTrackerSize(4, 40), MaintenanceTrackerRegistration.clamp(MaintenanceTrackerSize(9, 99)))
        assertTrue(MaintenanceTrackerRegistration.MIN_SIZE.isCompact)
        assertFalse(MaintenanceTrackerRegistration.DEFAULT_SIZE.isCompact)
    }

    private companion object {
        fun loading(): Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun error(cached: JsonElement?): Resource<JsonElement> =
            Resource.Error(cached = cached, fetchedAt = 50L, stale = cached != null, error = ApiError.Network())

        fun emptyArrayJson(): JsonElement = buildJsonArray { }

        fun itemsJson(): JsonElement =
            buildJsonArray {
                add(
                    buildJsonObject {
                        put("id", 2)
                        put("name", "Tire Rotation")
                        put("interval_miles", 10000.0)
                    },
                )
            }
    }
}
