package io.teslasync.android.dashboard.widgets.routeefficiency

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
import kotlinx.serialization.json.add
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the RouteEfficiencyWidget's pure logic — the `routes[]` decode, the
 * SI Wh/km→Wh/mi conversion, the web `fmtNumber`/`fmtInt` whole-number contract, the `efficiencyBadge`
 * thresholds, the `WidgetRankedList` sort/slice/bar math, the best-route detection, and the
 * `useRouteEfficiency` state fold (loading / content / empty / error / offline). Mirrors the web spec
 * (web/src/features/dashboard/widgets/RouteEfficiencyWidget.tsx).
 */
class RouteEfficiencyProjectionTest {
    private val strings =
        RouteEfficiencyStrings(
            title = "Route Efficiency",
            excellent = "Excellent",
            good = "Good",
            fair = "Fair",
            poor = "Poor",
            best = "best",
            worst = "worst",
            noData = "No route data",
        )

    private fun prefs(distance: DistanceUnitPref = DistanceUnitPref.KM): UnitPref =
        UnitPref(
            distance = distance,
            speed = if (distance == DistanceUnitPref.MI) SpeedUnitPref.MPH else SpeedUnitPref.KMH,
            temperature = TemperatureUnitPref.CELSIUS,
            pressure = PressureUnitPref.KPA,
            energy = EnergyUnitPref.KWH,
            duration = DurationUnitPref.HOURS,
            power = PowerUnitPref.KW,
        )

    private fun route(
        start: String? = "Home",
        end: String? = "Work",
        trips: Int = 10,
        avg: Double? = 150.0,
    ): RouteSummaryRaw = RouteSummaryRaw(start, end, trips, avg, bestEfficiencyWhKm = 132.0, worstEfficiencyWhKm = 171.0)

    private fun snapshot(vararg routes: RouteSummaryRaw): RouteEfficiencySnapshot = RouteEfficiencySnapshot(routes.toList())

    private val defaultSize = RouteEfficiencyRegistration.defaultSize
    private val wideSize = RouteEfficiencySize(cols = 3, rows = 4)
    private val compactSize = RouteEfficiencySize(cols = 1, rows = 4)

    // ── parseRoutes ─────────────────────────────────────────────────────────────────────────────────

    @Test
    fun parseRoutesDecodesSnakeCaseWireFields() {
        val json =
            buildJsonObject {
                putJsonArray("routes") {
                    addJsonObject {
                        put("start_location", "Home")
                        put("end_location", "Work")
                        put("trip_count", 42)
                        put("avg_efficiency", 148.0)
                        put("best_efficiency", 132.0)
                        put("worst_efficiency", 171.0)
                    }
                }
            }
        val routes = RouteEfficiencyProjection.parseRoutes(json)
        assertEquals(1, routes.size)
        val r = routes.single()
        assertEquals("Home", r.startLocation)
        assertEquals("Work", r.endLocation)
        assertEquals(42, r.tripCount)
        assertEquals(148.0, r.avgEfficiencyWhKm!!, 1e-9)
        assertEquals(132.0, r.bestEfficiencyWhKm, 1e-9)
        assertEquals(171.0, r.worstEfficiencyWhKm, 1e-9)
    }

    @Test
    fun parseRoutesIsNullSafeForMissingFieldsAndPayloads() {
        assertTrue(RouteEfficiencyProjection.parseRoutes(null).isEmpty())
        assertTrue(RouteEfficiencyProjection.parseRoutes(buildJsonObject {}).isEmpty())
        // Non-array `routes`, and a row missing every field, must not throw.
        val partial =
            buildJsonObject {
                putJsonArray("routes") { addJsonObject { put("trip_count", 3) } }
            }
        val r = RouteEfficiencyProjection.parseRoutes(partial).single()
        assertNull(r.startLocation)
        assertNull(r.avgEfficiencyWhKm)
        assertEquals(3, r.tripCount)
        assertEquals(0.0, r.bestEfficiencyWhKm, 1e-9)
    }

    @Test
    fun parseRoutesSkipsNonObjectArrayElements() {
        val json =
            buildJsonObject {
                putJsonArray("routes") {
                    add("not-an-object")
                    addJsonObject { put("avg_efficiency", 200.0) }
                }
            }
        assertEquals(1, RouteEfficiencyProjection.parseRoutes(json).size)
    }

    // ── project: conversion + formatting ──────────────────────────────────────────────────────────────

    @Test
    fun projectKeepsWhPerKmForMetric() {
        val ranked =
            RouteEfficiencyProjection.project(snapshot(route(avg = 150.0, trips = 10)), prefs(DistanceUnitPref.KM), strings, defaultSize)
        val item = ranked.items.single()
        assertEquals("150 Wh/km \u00B7 10\u00D7", item.formattedValue)
    }

    @Test
    fun projectConvertsWhPerKmToWhPerMileForImperial() {
        // 150 Wh/km × 1.609344 = 241.4016 → fmtNumber(_, 0) = "241".
        val ranked =
            RouteEfficiencyProjection.project(snapshot(route(avg = 150.0, trips = 10)), prefs(DistanceUnitPref.MI), strings, defaultSize)
        val item = ranked.items.single()
        assertEquals("241 Wh/mi \u00B7 10\u00D7", item.formattedValue)
    }

    @Test
    fun projectBuildsStartEndLabelWithEmDashFallback() {
        val ranked = RouteEfficiencyProjection.project(snapshot(route(start = null, end = null)), prefs(), strings, defaultSize)
        assertEquals("\u2014 \u2192 \u2014", ranked.items.single().label)
    }

    @Test
    fun projectWideLabelAppendsBestWorstBreakdown() {
        val ranked =
            RouteEfficiencyProjection.project(
                snapshot(route(start = "Home", end = "Work", avg = 150.0)),
                prefs(DistanceUnitPref.KM),
                strings,
                wideSize,
            )
        assertEquals("Home \u2192 Work  \u00B7  best 132 / worst 171 Wh/km", ranked.items.single().label)
    }

    @Test
    fun projectNonWideLabelHasNoBreakdown() {
        val ranked = RouteEfficiencyProjection.project(snapshot(route(start = "Home", end = "Work")), prefs(), strings, defaultSize)
        assertEquals("Home \u2192 Work", ranked.items.single().label)
    }

    // ── project: badges (thresholds on the RAW Wh/km average) ───────────────────────────────────────────

    @Test
    fun badgeThresholdsMatchWebOnRawWhPerKm() {
        assertEquals(RouteBadgeVariant.Success, badgeOf(250.0))
        assertEquals("Excellent", badgeTextOf(250.0))
        assertEquals(RouteBadgeVariant.Success, badgeOf(325.0))
        assertEquals("Good", badgeTextOf(325.0))
        assertEquals(RouteBadgeVariant.Warning, badgeOf(400.0))
        assertEquals("Fair", badgeTextOf(400.0))
        assertEquals(RouteBadgeVariant.Error, badgeOf(400.01))
        assertEquals("Poor", badgeTextOf(450.0))
    }

    @Test
    fun badgeUsesRawNotConvertedValue() {
        // In miles the displayed efficiency would exceed 400 (150×1.609=241 is still ≤250 though);
        // pick 300 Wh/km whose miles value (483) would be "Poor" if the threshold used the converted
        // value — the web applies the band to the RAW Wh/km, so it must stay "Good".
        val ranked = RouteEfficiencyProjection.project(snapshot(route(avg = 300.0)), prefs(DistanceUnitPref.MI), strings, defaultSize)
        assertEquals("Good", ranked.items.single().badgeText)
        assertEquals(RouteBadgeVariant.Success, ranked.items.single().badgeVariant)
    }

    // ── project: ranking + best detection + bars ────────────────────────────────────────────────────────

    @Test
    fun projectRanksMostEfficientFirstAndFlagsBest() {
        val ranked =
            RouteEfficiencyProjection.project(
                snapshot(
                    route(start = "A", end = "B", avg = 300.0),
                    route(start = "C", end = "D", avg = 150.0),
                    route(start = "E", end = "F", avg = 380.0),
                ),
                prefs(DistanceUnitPref.KM),
                strings,
                defaultSize,
            )
        // Lower Wh/km ⇒ higher inverted value ⇒ ranks first; the 150 route is best.
        assertEquals(listOf("C \u2192 D", "A \u2192 B", "E \u2192 F"), ranked.items.map { it.label })
        assertTrue(ranked.items.first().isBest)
        assertFalse(ranked.items[1].isBest)
        // Visible-max bar is full for the leader; the others are relative fractions of it.
        assertEquals(1.0, ranked.items.first().barFraction, 1e-9)
        assertEquals(0.5, ranked.items[1].barFraction, 1e-3)
        assertTrue(ranked.showBars)
    }

    @Test
    fun projectBestIgnoresRoutesWithoutAnAverage() {
        val ranked =
            RouteEfficiencyProjection.project(
                snapshot(route(start = "A", end = "B", avg = null), route(start = "C", end = "D", avg = 200.0)),
                prefs(),
                strings,
                defaultSize,
            )
        // A null average never claims the best slot (web `?? Infinity` for bestRaw, `?? 0` for the value).
        val best = ranked.items.first { it.label == "C \u2192 D" }
        assertTrue(best.isBest)
        val noAvg = ranked.items.first { it.label == "A \u2192 B" }
        assertFalse(noAvg.isBest)
        assertEquals(0.0, noAvg.value, 1e-9)
    }

    @Test
    fun projectLimitsRowsToFootprintCap() {
        val many = (1..7).map { route(start = "S$it", end = "E$it", avg = 100.0 + it * 10) }
        val expanded = RouteEfficiencyProjection.project(RouteEfficiencySnapshot(many), prefs(), strings, defaultSize)
        assertEquals(RouteEfficiencyRegistration.EXPANDED_LIMIT, expanded.items.size)
        val compact = RouteEfficiencyProjection.project(RouteEfficiencySnapshot(many), prefs(), strings, compactSize)
        assertEquals(RouteEfficiencyRegistration.COMPACT_LIMIT, compact.items.size)
        assertFalse(compact.showBars)
    }

    @Test
    fun projectEmptyRoutesYieldsNoRows() {
        assertTrue(RouteEfficiencyProjection.project(snapshot(), prefs(), strings, defaultSize).items.isEmpty())
    }

    // ── foldState (the useRouteEfficiency shell) ─────────────────────────────────────────────────────────

    @Test
    fun foldStateLoadsWhileFirstLoading() {
        val loading = Resource.Loading<JsonElement>(cached = null, fetchedAt = null, stale = false)
        assertEquals(UiPhase.Loading, RouteEfficiencyProjection.foldState(loading).phase)
    }

    @Test
    fun foldStateContentWithParsedRoutes() {
        val result = RouteEfficiencyProjection.foldState(Resource.Success(routesJson(), 100L, false))
        assertEquals(UiPhase.Content, result.phase)
        assertEquals(100L, result.fetchedAt)
        assertEquals(2, result.data?.routes?.size)
    }

    @Test
    fun foldStateEmptyWhenNoRoutes() {
        val emptyDoc = buildJsonObject { putJsonArray("routes") {} }
        assertEquals(UiPhase.Empty, RouteEfficiencyProjection.foldState(Resource.Success(emptyDoc, 100L, false)).phase)
    }

    @Test
    fun foldStateHardErrorWhenNoCache() {
        val error = Resource.Error<JsonElement>(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())
        val result = RouteEfficiencyProjection.foldState(error)
        assertEquals(UiPhase.Error, result.phase)
        assertEquals(ErrorKind.Network, result.errorKind)
        assertTrue(result.canRetry)
    }

    @Test
    fun foldStateOfflineKeepsCachedRoutesWithRetry() {
        val error = Resource.Error(cached = routesJson(), fetchedAt = 90L, stale = true, error = ApiError.Timeout())
        val result = RouteEfficiencyProjection.foldState(error)
        assertEquals(UiPhase.Content, result.phase)
        assertTrue(result.stale)
        assertTrue(result.isOffline)
        assertEquals(ErrorKind.Timeout, result.errorKind)
        assertTrue(result.canRetry)
        assertEquals(2, result.data?.routes?.size)
    }

    @Test
    fun foldStateRefreshingOverCacheStaysContent() {
        val result = RouteEfficiencyProjection.foldState(Resource.Loading(cached = routesJson(), fetchedAt = 80L, stale = false))
        assertEquals(UiPhase.Content, result.phase)
        assertTrue(result.refreshing)
    }

    @Test
    fun emptyStateIsEmptyWithNoRoutes() {
        val result = RouteEfficiencyProjection.emptyState()
        assertEquals(UiPhase.Empty, result.phase)
        assertTrue(result.data?.routes?.isEmpty() == true)
    }

    // ── conversion helpers + registry ────────────────────────────────────────────────────────────────────

    @Test
    fun toEfficiencyDisplayAndUnitMatchWeb() {
        assertEquals(160.9344, RouteEfficiencyProjection.toEfficiencyDisplay(100.0, DistanceUnitPref.MI), 1e-6)
        assertEquals(100.0, RouteEfficiencyProjection.toEfficiencyDisplay(100.0, DistanceUnitPref.KM), 1e-9)
        assertEquals("Wh/mi", RouteEfficiencyProjection.efficiencyUnit(DistanceUnitPref.MI))
        assertEquals("Wh/km", RouteEfficiencyProjection.efficiencyUnit(DistanceUnitPref.KM))
    }

    @Test
    fun registrationMirrorsWebRegistry() {
        assertEquals("route-efficiency", RouteEfficiencyRegistration.ID)
        assertEquals("driving", RouteEfficiencyRegistration.CATEGORY)
        assertEquals("RouteEfficiencyWidget", RouteEfficiencyRegistration.SLUG)
        assertEquals(RouteEfficiencySize(cols = 2, rows = 4), RouteEfficiencyRegistration.defaultSize)
        assertEquals(RouteEfficiencySize(cols = 2, rows = 4), RouteEfficiencyRegistration.minSize)
        assertEquals(RouteEfficiencySize(cols = 4, rows = 40), RouteEfficiencyRegistration.maxSize)
    }

    @Test
    fun registrationClampsBoundsAndLayout() {
        assertEquals(RouteEfficiencySize(cols = 4, rows = 40), RouteEfficiencyRegistration.clamp(RouteEfficiencySize(9, 99)))
        assertEquals(RouteEfficiencySize(cols = 2, rows = 4), RouteEfficiencyRegistration.clamp(RouteEfficiencySize(0, 0)))
        assertTrue(RouteEfficiencyRegistration.isWithinBounds(RouteEfficiencySize(2, 4)))
        assertFalse(RouteEfficiencyRegistration.isWithinBounds(RouteEfficiencySize(1, 4)))
        assertTrue(RouteEfficiencyRegistration.isCompact(RouteEfficiencySize(1, 4)))
        assertFalse(RouteEfficiencyRegistration.isCompact(RouteEfficiencySize(2, 4)))
        assertTrue(RouteEfficiencyRegistration.isWide(RouteEfficiencySize(3, 4)))
        assertFalse(RouteEfficiencyRegistration.isWide(RouteEfficiencySize(2, 4)))
        assertEquals(RouteEfficiencyRegistration.EXPANDED_LIMIT, RouteEfficiencyRegistration.rowLimit(RouteEfficiencySize(2, 4)))
        assertEquals(RouteEfficiencyRegistration.COMPACT_LIMIT, RouteEfficiencyRegistration.rowLimit(RouteEfficiencySize(1, 4)))
    }

    private fun badgeOf(rawWhKm: Double): RouteBadgeVariant = RouteEfficiencyProjection.badgeFor(rawWhKm, strings).second

    private fun badgeTextOf(rawWhKm: Double): String = RouteEfficiencyProjection.badgeFor(rawWhKm, strings).first

    private fun routesJson(): JsonElement =
        buildJsonObject {
            putJsonArray("routes") {
                addJsonObject {
                    put("start_location", "Home")
                    put("end_location", "Work")
                    put("trip_count", 42)
                    put("avg_efficiency", 148.0)
                    put("best_efficiency", 132.0)
                    put("worst_efficiency", 171.0)
                }
                addJsonObject {
                    put("start_location", "Home")
                    put("end_location", "Gym")
                    put("trip_count", 18)
                    put("avg_efficiency", 198.0)
                    put("best_efficiency", 180.0)
                    put("worst_efficiency", 225.0)
                }
            }
        }
}
