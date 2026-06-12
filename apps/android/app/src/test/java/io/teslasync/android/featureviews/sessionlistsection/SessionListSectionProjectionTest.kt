package io.teslasync.android.featureviews.sessionlistsection

import io.teslasync.android.data.UiPhase
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
import java.util.Locale

/**
 * Off-device verification of the SessionListSection pure model — the native mirror of every derivation the
 * web component + its helpers perform (web/src/features/charging/components/charging-list/SessionListSection
 * .tsx, ./helpers.ts, and @/lib/chargingAggregation): the cached-document decode, the charger categorization,
 * the per-session duration / average-power / cost-per-kWh / battery-friendly score, the filter+sort, the page
 * window, the pagination `total`, and the formatted row strings. Because the surface is purely presentational,
 * each projected value is exactly what the thin composable renders, so these assertions double as the
 * per-state "snapshot". Formatters are pinned to [Locale.US] for determinism.
 */
class SessionListSectionProjectionTest {
    private val baseItem =
        ChargingSessionItem(
            id = 1,
            startedAt = "2026-04-04T18:30:00Z",
            endedAt = "2026-04-04T19:42:00Z",
            chargerType = "Supercharger V3",
            totalEnergyAddedWh = 52_400.0,
            peakPowerW = 246_000.0,
            avgPowerW = null,
            costDecimal = 18.32,
            startSocPct = 18.0,
            endSocPct = 78.0,
            startPlace = "Harris Ranch Supercharger",
            startLat = 36.25,
            startLng = -120.23,
        )

    private val homeItem =
        baseItem.copy(
            id = 2,
            startedAt = "2026-04-03T07:05:00Z",
            endedAt = "2026-04-03T11:05:00Z",
            chargerType = null,
            totalEnergyAddedWh = 19_800.0,
            peakPowerW = 7_400.0,
            avgPowerW = 4_950.0,
            costDecimal = null,
            startSocPct = 42.0,
            endSocPct = 80.0,
            startPlace = "Home",
            startLat = null,
            startLng = null,
        )

    // ── projectUiState(): web loading / empty / content precedence ───────────────────────────────

    @Test
    fun projectUiStateLoadingWinsOutright() {
        val state = SessionListProjection.projectUiState(listOf(baseItem), isLoading = true)
        assertEquals(UiPhase.Loading, state.phase)
        assertTrue(state.isLoading)
    }

    @Test
    fun projectUiStateNullOrEmptyIsEmpty() {
        assertEquals(UiPhase.Empty, SessionListProjection.projectUiState(null, isLoading = false).phase)
        assertEquals(UiPhase.Empty, SessionListProjection.projectUiState(emptyList(), isLoading = false).phase)
    }

    @Test
    fun projectUiStatePresentDataIsContent() {
        val data = listOf(baseItem)
        val state = SessionListProjection.projectUiState(data, isLoading = false)
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(data, state.data)
    }

    // ── getChargerCategory(): verbatim web port ──────────────────────────────────────────────────

    @Test
    fun chargerCategoryMatchesWeb() {
        assertEquals(ChargerCategory.Home, SessionListProjection.getChargerCategory(null))
        assertEquals(ChargerCategory.Home, SessionListProjection.getChargerCategory(""))
        assertEquals(ChargerCategory.Supercharger, SessionListProjection.getChargerCategory("Supercharger V3"))
        assertEquals(ChargerCategory.Supercharger, SessionListProjection.getChargerCategory("TPC"))
        assertEquals(ChargerCategory.Dc, SessionListProjection.getChargerCategory("CCS Combo"))
        assertEquals(ChargerCategory.Dc, SessionListProjection.getChargerCategory("CHAdeMO"))
        assertEquals(ChargerCategory.Home, SessionListProjection.getChargerCategory("Wall Connector"))
        assertEquals(ChargerCategory.Unknown, SessionListProjection.getChargerCategory("mystery"))
    }

    // ── durationMinutes / avgPowerW / costPerKwh: verbatim web ports ─────────────────────────────

    @Test
    fun durationMinutesIsElapsedOrZero() {
        assertEquals(72.0, SessionListProjection.durationMinutes("2026-04-04T18:30:00Z", "2026-04-04T19:42:00Z"), 0.0001)
        assertEquals(0.0, SessionListProjection.durationMinutes("2026-04-04T18:30:00Z", null), 0.0)
        assertEquals(0.0, SessionListProjection.durationMinutes("2026-04-04T19:42:00Z", "2026-04-04T18:30:00Z"), 0.0)
        assertEquals(0.0, SessionListProjection.durationMinutes("not-a-date", "also-bad"), 0.0)
    }

    @Test
    fun avgPowerWPrefersEnergyOverTimeThenFallsBack() {
        // 52_400 Wh over 1.2 h = 43_666.67 W.
        assertEquals(43_666.67, SessionListProjection.avgPowerW(baseItem), 0.5)
        // No elapsed time -> API avg_power_w fallback.
        assertEquals(9_000.0, SessionListProjection.avgPowerW(baseItem.copy(endedAt = null, avgPowerW = 9_000.0)), 0.0)
        // Neither computable -> 0.
        assertEquals(0.0, SessionListProjection.avgPowerW(baseItem.copy(endedAt = null, avgPowerW = null)), 0.0)
    }

    @Test
    fun costPerKwhIsNullWhenFreeOrZeroEnergy() {
        assertEquals(0.3496, SessionListProjection.costPerKwh(baseItem)!!, 0.001)
        assertNull(SessionListProjection.costPerKwh(baseItem.copy(costDecimal = null)))
        assertNull(SessionListProjection.costPerKwh(baseItem.copy(costDecimal = 0.0)))
        assertNull(SessionListProjection.costPerKwh(baseItem.copy(totalEnergyAddedWh = 0.0)))
    }

    // ── sessionScore(): verbatim web ChargingSessionCard heuristic ───────────────────────────────

    @Test
    fun sessionScoreRewardsLowStartSweetEnd() {
        assertEquals(100.0, SessionListProjection.sessionScore(18.0, 78.0)!!, 0.0)
        assertEquals(85.0, SessionListProjection.sessionScore(42.0, 80.0)!!, 0.0)
        // 100% finish is penalised hardest.
        assertEquals(55.0, SessionListProjection.sessionScore(18.0, 100.0)!!, 0.0)
        assertNull(SessionListProjection.sessionScore(null, 80.0))
        assertNull(SessionListProjection.sessionScore(50.0, null))
    }

    // ── pagination total + page window ───────────────────────────────────────────────────────────

    @Test
    fun paginationTotalMatchesWebFormula() {
        // Short final page reports the exact count seen so far.
        assertEquals(2, SessionListProjection.paginationTotal(page = 1, pageSize = 25, filteredCount = 2))
        // A full page reports one past the current page so "next" stays enabled.
        assertEquals(51, SessionListProjection.paginationTotal(page = 2, pageSize = 25, filteredCount = 25))
    }

    @Test
    fun pageItemsSlicesTheWindow() {
        val items = listOf(baseItem.copy(id = 1), baseItem.copy(id = 2), baseItem.copy(id = 3))
        assertEquals(listOf(1L, 2L), SessionListProjection.pageItems(items, page = 1, pageSize = 2).map { it.id })
        assertEquals(listOf(3L), SessionListProjection.pageItems(items, page = 2, pageSize = 2).map { it.id })
        assertTrue(SessionListProjection.pageItems(items, page = 9, pageSize = 2).isEmpty())
    }

    // ── filterAndSort(): verbatim web helpers port ───────────────────────────────────────────────

    @Test
    fun filterByChargerCategory() {
        val all = listOf(baseItem, homeItem)
        val sc = SessionListProjection.filterAndSort(all, ChargerFilter.Supercharger, SortKey.Date, true, "")
        assertEquals(listOf(1L), sc.map { it.id })
        val home = SessionListProjection.filterAndSort(all, ChargerFilter.Home, SortKey.Date, true, "")
        assertEquals(listOf(2L), home.map { it.id })
    }

    @Test
    fun filterByQueryMatchesPlaceOrType() {
        val all = listOf(baseItem, homeItem)
        assertEquals(
            listOf(2L),
            SessionListProjection.filterAndSort(all, ChargerFilter.All, SortKey.Date, true, "home").map { it.id },
        )
        assertEquals(
            listOf(1L),
            SessionListProjection.filterAndSort(all, ChargerFilter.All, SortKey.Date, true, "harris").map { it.id },
        )
        assertTrue(SessionListProjection.filterAndSort(all, ChargerFilter.All, SortKey.Date, true, "zzz").isEmpty())
    }

    @Test
    fun sortByEnergyHonorsDirection() {
        val all = listOf(homeItem, baseItem)
        val desc = SessionListProjection.filterAndSort(all, ChargerFilter.All, SortKey.Energy, sortDesc = true, query = "")
        assertEquals(listOf(1L, 2L), desc.map { it.id })
        val asc = SessionListProjection.filterAndSort(all, ChargerFilter.All, SortKey.Energy, sortDesc = false, query = "")
        assertEquals(listOf(2L, 1L), asc.map { it.id })
    }

    @Test
    fun sortByDateDescendingNewestFirst() {
        val all = listOf(homeItem, baseItem)
        val byDate = SessionListProjection.filterAndSort(all, ChargerFilter.All, SortKey.Date, sortDesc = true, query = "")
        assertEquals(listOf(1L, 2L), byDate.map { it.id })
    }

    // ── row(): the formatted card strings the composable renders ─────────────────────────────────

    @Test
    fun rowFormatsEveryFieldLikeTheWebCard() {
        val view = SessionListProjection.row(baseItem, currencySymbol = "$", locale = Locale.US, formatTime = { it })
        assertEquals("2026-04-04T18:30:00Z", view.timeText)
        assertEquals("1h 12m", view.durationText)
        assertEquals(ChargerCategory.Supercharger, view.category)
        assertEquals("52.4 kWh", view.energyText)
        assertEquals("246.0 kW", view.peakPowerText)
        assertEquals("~43.7 kW", view.avgPowerText)
        assertEquals("\$18.32", view.costText)
        assertEquals("\$0.35/kWh", view.costPerKwhText)
        assertEquals(100.0, view.score!!, 0.0)
    }

    @Test
    fun rowOmitsCostAndCpkForFreeHomeSession() {
        val view = SessionListProjection.row(homeItem, currencySymbol = "$", locale = Locale.US, formatTime = { it })
        assertEquals(ChargerCategory.Home, view.category)
        assertEquals("19.8 kWh", view.energyText)
        assertEquals("4h 0m", view.durationText)
        assertNull(view.costText)
        assertNull(view.costPerKwhText)
        assertEquals(85.0, view.score!!, 0.0)
    }

    @Test
    fun rowTimeFallsBackToEmDashWhenMissing() {
        val view =
            SessionListProjection.row(baseItem.copy(startedAt = null), currencySymbol = "$", locale = Locale.US, formatTime = { it })
        assertEquals("\u2014", view.timeText)
    }

    // ── parse(): cached document -> typed projection ─────────────────────────────────────────────

    @Test
    fun parseDecodesAnArrayOfSessions() {
        val doc =
            buildJsonArray {
                add(
                    buildJsonObject {
                        put("id", 1)
                        put("started_at", "2026-04-04T18:30:00Z")
                        put("ended_at", "2026-04-04T19:42:00Z")
                        put("charger_type", "Supercharger V3")
                        put("total_energy_added_wh", 52_400.0)
                        put("peak_power_w", 246_000.0)
                        put("cost_decimal", 18.32)
                        put("start_soc_pct", 18)
                        put("end_soc_pct", 78)
                        put("start_place", "Harris Ranch Supercharger")
                        put("start_lat", 36.25)
                        put("start_lng", -120.23)
                    },
                )
                add(
                    buildJsonObject {
                        put("id", 2)
                        put("charger_type", JsonNull)
                        put("total_energy_added_wh", 19_800.0)
                    },
                )
            }
        val items = SessionListProjection.parse(doc)
        assertEquals(2, items.size)
        val first = items.first()
        assertEquals(1L, first.id)
        assertEquals("2026-04-04T18:30:00Z", first.startedAt)
        assertEquals("Supercharger V3", first.chargerType)
        assertEquals(52_400.0, first.totalEnergyAddedWh, 0.0)
        assertEquals(246_000.0, first.peakPowerW!!, 0.0)
        assertEquals(18.32, first.costDecimal!!, 0.0)
        assertEquals(18.0, first.startSocPct!!, 0.0)
        assertEquals("Harris Ranch Supercharger", first.startPlace)
        assertNull(items[1].chargerType)
    }

    @Test
    fun parseUnwrapsAWrappedSessionsArray() {
        val doc =
            buildJsonObject {
                put(
                    "sessions",
                    buildJsonArray {
                        add(
                            buildJsonObject {
                                put("id", 7)
                                put("total_energy_added_wh", 1_000.0)
                            },
                        )
                    },
                )
            }
        val items = SessionListProjection.parse(doc)
        assertEquals(1, items.size)
        assertEquals(7L, items.first().id)
    }

    @Test
    fun parseSkipsRowsMissingAnIdAndToleratesGarbage() {
        val doc =
            buildJsonArray {
                add(buildJsonObject { put("total_energy_added_wh", 5.0) })
                add(buildJsonObject { put("id", 9) })
            }
        val items = SessionListProjection.parse(doc)
        assertEquals(1, items.size)
        assertEquals(9L, items.first().id)
        assertTrue(SessionListProjection.parse(null).isEmpty())
    }

    // ── formatters ───────────────────────────────────────────────────────────────────────────────

    @Test
    fun formatDurationMinutesMatchesWeb() {
        assertEquals("1h 12m", SessionListProjection.formatDurationMinutes(72.0, Locale.US))
        assertEquals("45m", SessionListProjection.formatDurationMinutes(45.0, Locale.US))
        assertEquals("\u2014", SessionListProjection.formatDurationMinutes(-1.0, Locale.US))
    }

    @Test
    fun fmtNumberRoundsHalfAwayFromZeroAndGroups() {
        assertEquals("1,204", SessionListProjection.fmtNumber(1_204.0, 0, Locale.US))
        assertEquals("52.4", SessionListProjection.fmtNumber(52.4, 1, Locale.US))
        // 0.125 is exactly representable, so this pins HALF_UP (0.13) versus banker's rounding (0.12).
        assertEquals("0.13", SessionListProjection.fmtNumber(0.125, 2, Locale.US))
    }

    @Test
    fun formatCurrencyAppliesSymbolAndFallback() {
        assertEquals("\$18.32", SessionListProjection.formatCurrency(18.32, "$", 2, Locale.US))
        assertEquals("\$0.00", SessionListProjection.formatCurrency(Double.NaN, "", 2, Locale.US))
    }

    @Test
    fun currencySymbolReadsSettingsWithDollarDefault() {
        assertEquals("$", SessionListProjection.currencySymbol(null))
        val settings = buildJsonObject { put("currency_symbol", "€") }
        assertEquals("€", SessionListProjection.currencySymbol(settings))
        assertFalse(SessionListProjection.currencySymbol(buildJsonObject { put("currency_symbol", "  ") }) == "  ")
    }
}
