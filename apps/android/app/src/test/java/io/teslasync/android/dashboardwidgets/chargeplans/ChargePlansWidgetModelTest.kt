package io.teslasync.android.dashboardwidgets.chargeplans

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Framework-free unit tests for the ChargePlans widget — the registry spec, the tolerant JSON
 * parsing, the `activePlan` selection, the status→badge mapping, the settings-derived display
 * preferences, the two-source cache-then-network merge adapter, and the `planEntries` / `rateEntries`
 * projection (including the savings-conditional row, the stat/detail split, and the compact slice).
 * These run in the `:android:testReleaseUnitTest` gate and cover the behavior the composables render.
 */
class ChargePlansWidgetModelTest {
    // ── Registry spec (web registry/charging.ts: charge-plans) ──────────────────────────────────
    @Test
    fun registrationMatchesWebRegistryMetadata() {
        assertEquals("charge-plans", ChargePlansRegistration.ID)
        assertEquals("charging", ChargePlansRegistration.CATEGORY)
        assertEquals("ChargePlansWidget", ChargePlansRegistration.SLUG)
        assertEquals(ChargePlansSize(2, 4), ChargePlansRegistration.DEFAULT_SIZE)
        assertEquals(ChargePlansSize(1, 2), ChargePlansRegistration.MIN_SIZE)
        assertEquals(ChargePlansSize(4, 40), ChargePlansRegistration.MAX_SIZE)
    }

    @Test
    fun clampAndBoundsHoldTheMinMaxEnvelope() {
        assertEquals(ChargePlansSize(1, 2), ChargePlansRegistration.clamp(ChargePlansSize(0, 0)))
        assertEquals(ChargePlansSize(4, 40), ChargePlansRegistration.clamp(ChargePlansSize(9, 99)))
        assertTrue(ChargePlansRegistration.isWithinBounds(ChargePlansSize(2, 4)))
        assertFalse(ChargePlansRegistration.isWithinBounds(ChargePlansSize(0, 4)))
        assertFalse(ChargePlansRegistration.isWithinBounds(ChargePlansSize(2, 99)))
    }

    @Test
    fun sizeFlagsMatchWebBranches() {
        assertTrue(ChargePlansSize(1, 4).isCompact)
        assertFalse(ChargePlansSize(2, 4).isCompact)
        assertTrue(ChargePlansSize(2, 3).isCompactDetail)
        assertFalse(ChargePlansSize(2, 4).isCompactDetail)
    }

    // ── Parsing (tolerant, web safeArray parity) ────────────────────────────────────────────────
    @Test
    fun parsePlansIsTolerantAndDefaultsMissingFields() {
        val plans = ChargePlansSnapshot.parsePlans(plansJson(plan(id = 1, status = "active", targetSoc = 80)))
        assertEquals(1, plans.size)
        assertEquals(1L, plans[0].id)
        assertEquals(80.0, plans[0].targetSoc, 0.0001)
        assertEquals("active", plans[0].status)

        val sparse = buildJsonArray { add(buildJsonObject { put("id", 5) }) }
        val parsed = ChargePlansSnapshot.parsePlans(sparse)
        assertEquals(1, parsed.size)
        assertEquals(0.0, parsed[0].targetSoc, 0.0001)
        assertNull(parsed[0].status)
        assertNull(parsed[0].estimatedKwh)

        val withNonObject =
            buildJsonArray {
                add(JsonNull)
                add(plan(id = 2, status = "scheduled", targetSoc = 70))
            }
        assertEquals(1, ChargePlansSnapshot.parsePlans(withNonObject).size)
        assertTrue(ChargePlansSnapshot.parsePlans(JsonNull).isEmpty())
        assertTrue(ChargePlansSnapshot.parsePlans(null).isEmpty())
    }

    @Test
    fun parseRatePlansReadsUtilityNameId() {
        val rates = ChargePlansSnapshot.parseRatePlans(ratesJson(rate("EV2A", "EV2-A", "PG&E")))
        assertEquals(1, rates.size)
        assertEquals("EV2A", rates[0].id)
        assertEquals("EV2-A", rates[0].name)
        assertEquals("PG&E", rates[0].utility)
        assertTrue(ChargePlansSnapshot.parseRatePlans(null).isEmpty())
    }

    // ── activePlan selection (web find(active|scheduled) ?? plans[0]) ────────────────────────────
    @Test
    fun activePlanPrefersActiveOrScheduledElseFirst() {
        val completedThenScheduled =
            ChargePlansSnapshot.from(
                plansJson(plan(1, "completed", 80), plan(2, "scheduled", 70)),
                JsonNull,
            )
        assertEquals(2L, completedThenScheduled.activePlan?.id)

        val noActive = ChargePlansSnapshot.from(plansJson(plan(1, "completed", 80), plan(2, "failed", 70)), JsonNull)
        assertEquals(1L, noActive.activePlan?.id)

        assertNull(ChargePlansSnapshot.EMPTY.activePlan)
    }

    @Test
    fun hasDataReflectsEitherPlansOrRates() {
        assertTrue(ChargePlansSnapshot.from(plansJson(plan(1, "active", 80)), JsonNull).hasData)
        assertTrue(ChargePlansSnapshot.from(JsonNull, ratesJson(rate("EV2A", "EV2-A", "PG&E"))).hasData)
        assertFalse(ChargePlansSnapshot.from(JsonNull, JsonNull).hasData)
        assertFalse(ChargePlansSnapshot.EMPTY.hasData)
    }

    // ── status → badge variant (web detailBadgeVariant / badgeVariant) ──────────────────────────
    @Test
    fun statusVariantMapsLikeWeb() {
        assertEquals(DetailBadgeVariant.Success, chargePlanStatusVariant("completed"))
        assertEquals(DetailBadgeVariant.Warning, chargePlanStatusVariant("active"))
        assertEquals(DetailBadgeVariant.Warning, chargePlanStatusVariant("scheduled"))
        assertEquals(DetailBadgeVariant.Error, chargePlanStatusVariant("failed"))
        assertEquals(DetailBadgeVariant.Error, chargePlanStatusVariant("cancelled"))
        assertEquals(DetailBadgeVariant.Neutral, chargePlanStatusVariant("pending"))
        assertEquals(DetailBadgeVariant.Neutral, chargePlanStatusVariant(null))
    }

    // ── display preferences from settings (web useFormatting / useUnits) ────────────────────────
    @Test
    fun prefsDefaultAndReadFromSettings() {
        val default = ChargePlansPrefs.from(null)
        assertEquals("$", default.currencySymbol)
        assertEquals(2, default.precision)
        assertEquals("", default.localeTag)

        val custom =
            ChargePlansPrefs.from(
                buildJsonObject {
                    put("currency_symbol", "\u20AC")
                    put("decimal_precision", 3.0)
                    put("locale", "de-DE")
                },
            )
        assertEquals("\u20AC", custom.currencySymbol)
        assertEquals(3, custom.precision)
        assertEquals("de-DE", custom.localeTag)

        val blank =
            ChargePlansPrefs.from(
                buildJsonObject {
                    put("currency_symbol", "  ")
                    put("decimal_precision", -1.0)
                },
            )
        assertEquals("$", blank.currencySymbol)
        assertEquals(2, blank.precision)
    }

    // ── firstVehicleId (web vehicles?.[0]?.id) ──────────────────────────────────────────────────
    @Test
    fun firstVehicleIdReadsHeadOrNull() {
        assertNull(firstVehicleId(null))
        assertNull(firstVehicleId(emptyList()))
        assertEquals(7L, firstVehicleId(listOf(vehicle(7), vehicle(9))))
    }

    // ── merge adapter (cache-then-network two-source combine, web isLoading||) ──────────────────
    @Test
    fun mergeFirstLoadOnEitherSourceIsLoadingSkeleton() {
        val bothLoading = mergeChargePlans(loading(null), loading(null))
        assertTrue(bothLoading is Resource.Loading)
        assertNull(bothLoading.cached)

        // plans still first-loading while rates already resolved → web shows the skeleton (loading wins)
        val plansLoading = mergeChargePlans(loading(null), success(ratesJson(rate("EV2A", "EV2-A", "PG&E"))))
        assertTrue(plansLoading is Resource.Loading)
        assertNull(plansLoading.cached)
    }

    @Test
    fun mergeDisabledPlansWithRatesIsSuccessWithRates() {
        val merged = mergeChargePlans(DISABLED_CHARGE_PLANS, success(ratesJson(rate("EV2A", "EV2-A", "PG&E"))))
        assertTrue(merged is Resource.Success)
        val snapshot = merged.cached!!
        assertTrue(snapshot.plans.isEmpty())
        assertEquals(1, snapshot.ratePlans.size)
        assertTrue(snapshot.hasData)
    }

    @Test
    fun mergeBothSuccessProducesActivePlanSnapshot() {
        val merged =
            mergeChargePlans(
                success(plansJson(plan(1, "scheduled", 80))),
                success(ratesJson(rate("EV2A", "EV2-A", "PG&E"))),
            )
        assertTrue(merged is Resource.Success)
        val snapshot = merged.cached!!
        assertEquals(1L, snapshot.activePlan?.id)
        assertEquals(1, snapshot.ratePlans.size)
    }

    @Test
    fun mergeHardErrorWithNoCacheIsError() {
        val merged = mergeChargePlans(errorNoCache(), errorNoCache())
        assertTrue(merged is Resource.Error)
        assertNull(merged.cached)
    }

    @Test
    fun mergeErrorWithCachedRatesStaysOfflineSnapshot() {
        val merged = mergeChargePlans(errorNoCache(), success(ratesJson(rate("EV2A", "EV2-A", "PG&E"))))
        assertTrue(merged is Resource.Error)
        assertTrue(merged.stale)
        assertEquals(1, merged.cached!!.ratePlans.size)
    }

    @Test
    fun mergeRefetchOverCacheStaysLoadingWithSnapshot() {
        val cachedPlans = Resource.Loading(plansJson(plan(1, "active", 80)), fetchedAt = 50L, stale = false)
        val cachedRates = Resource.Loading(ratesJson(rate("EV2A", "EV2-A", "PG&E")), fetchedAt = 50L, stale = false)
        val merged = mergeChargePlans(cachedPlans, cachedRates)
        assertTrue(merged is Resource.Loading)
        assertEquals(1L, merged.cached!!.activePlan?.id)
    }

    // ── projection (web planEntries / rateEntries useMemo) ──────────────────────────────────────
    @Test
    fun projectBuildsActivePlanStatAndDetailEntries() {
        val snapshot =
            ChargePlansSnapshot.from(
                plansJson(
                    plan(1, "scheduled", 80) {
                        put("depart_by", "DEP")
                        put("estimated_kwh", 42.5)
                        put("estimated_cost", 6.4)
                        put("savings", 2.5)
                        put("rate_plan", "PG&E EV2-A")
                    },
                ),
                ratesJson(rate("EV2A", "EV2-A", "PG&E")),
            )
        val display = ChargePlansProjection.project(snapshot, ChargePlansSize(2, 4), strings, formatters)

        assertTrue(display.hasData)
        assertFalse(display.isCompact)
        assertTrue(display.hasRates)

        val plan = display.activePlan!!
        assertEquals(DetailBadgeVariant.Warning, plan.statusVariant)
        assertEquals("scheduled", plan.statusText)
        assertEquals("PG&E EV2-A", plan.ratePlanText)
        assertEquals("80%", plan.targetSocText)

        // stat tiles: Target SOC + Departure (web planEntries[0..1])
        assertEquals(2, plan.statEntries.size)
        assertEquals("Target SOC", plan.statEntries[0].label)
        assertEquals("80%", plan.statEntries[0].value)
        assertEquals("Departure", plan.statEntries[1].label)
        assertEquals("time(DEP)", plan.statEntries[1].value)

        // detail rows: web planEntries.slice(2) → SchedStart, SchedEnd, EstEnergy, EstCost, Savings, RatePlan
        val labels = plan.detailEntries.map { it.label }
        assertEquals(listOf("Scheduled Start", "Scheduled End", "Est. Energy", "Est. Cost", "Savings", "Rate Plan"), labels)
        assertEquals("42.5 kWh", plan.detailEntries[2].value)
        assertEquals("cur(6.4)", plan.detailEntries[3].value)
        assertEquals("cur(2.5)", plan.detailEntries[4].value)
        assertEquals("saved", plan.detailEntries[4].badge?.text)
        assertEquals("PG&E EV2-A", plan.detailEntries[5].value)
        assertEquals("time(DEP)", plan.compactDeparture)
    }

    @Test
    fun projectOmitsSavingsRowWhenZeroOrNull() {
        val noSavings = ChargePlansSnapshot.from(plansJson(plan(1, "active", 80) { put("savings", 0.0) }), JsonNull)
        val display = ChargePlansProjection.project(noSavings, ChargePlansSize(2, 4), strings, formatters)
        assertFalse(display.activePlan!!.detailEntries.any { it.label == "Savings" })
    }

    @Test
    fun projectCompactDetailCapsAtFourRows() {
        val snapshot =
            ChargePlansSnapshot.from(
                plansJson(plan(1, "active", 80) { put("savings", 2.5) }),
                JsonNull,
            )
        // size.rows <= 3 → WidgetDetailCard compact slice of four
        val display = ChargePlansProjection.project(snapshot, ChargePlansSize(2, 3), strings, formatters)
        assertEquals(4, display.activePlan!!.detailEntries.size)
    }

    @Test
    fun projectRateEntriesAreMonoWithIdBadge() {
        val snapshot = ChargePlansSnapshot.from(JsonNull, ratesJson(rate("EV2A", "EV2-A", "PG&E")))
        val display = ChargePlansProjection.project(snapshot, ChargePlansSize(2, 4), strings, formatters)
        assertNull(display.activePlan)
        assertEquals(1, display.rateEntries.size)
        val entry = display.rateEntries[0]
        assertEquals("PG&E", entry.label)
        assertEquals("EV2-A", entry.value)
        assertEquals("EV2A", entry.badge?.text)
        assertEquals(DetailBadgeVariant.Neutral, entry.badge?.variant)
        assertTrue(entry.mono)
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────
    private val strings =
        ChargePlansStrings(
            targetSoc = "Target SOC",
            departure = "Departure",
            schedStart = "Scheduled Start",
            schedEnd = "Scheduled End",
            estEnergy = "Est. Energy",
            estCost = "Est. Cost",
            savings = "Savings",
            saved = "saved",
            ratePlan = "Rate Plan",
        )

    private val formatters =
        ChargePlansFormatters(
            currency = { "cur($it)" },
            time = { it?.let { raw -> "time($raw)" } ?: CHARGE_PLANS_EM_DASH },
            date = { it?.let { raw -> "date($raw)" } ?: CHARGE_PLANS_EM_DASH },
            number1 = { it.toString() },
            integer = { it.toInt().toString() },
        )

    private fun success(payload: JsonElement): Resource<JsonElement> = Resource.Success(payload, fetchedAt = 100L, stale = false)

    private fun loading(cached: JsonElement?): Resource<JsonElement> =
        Resource.Loading(
            cached,
            fetchedAt =
                if (cached ==
                    null
                ) {
                    null
                } else {
                    50L
                },
            stale = false,
        )

    private fun errorNoCache(): Resource<JsonElement> =
        Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())

    private fun plansJson(vararg plans: JsonObject): JsonArray = buildJsonArray { plans.forEach { add(it) } }

    private fun ratesJson(vararg rates: JsonObject): JsonArray = buildJsonArray { rates.forEach { add(it) } }

    private fun plan(
        id: Long,
        status: String,
        targetSoc: Int,
        extras: JsonObjectBuilder.() -> Unit = {},
    ): JsonObject =
        buildJsonObject {
            put("id", id)
            put("vehicle_id", 1)
            put("status", status)
            put("target_soc", targetSoc)
            put("scheduled_start", "2024-01-02T00:00:00Z")
            put("scheduled_end", "2024-01-02T06:00:00Z")
            extras()
        }

    private fun rate(
        id: String,
        name: String,
        utility: String,
    ): JsonObject =
        buildJsonObject {
            put("id", id)
            put("name", name)
            put("utility", utility)
        }

    private fun vehicle(id: Long): Vehicle =
        Vehicle(
            createdAt = Instant.parse("2026-01-01T00:00:00Z"),
            displayName = "Car $id",
            enrolledAt = Instant.parse("2026-01-01T00:00:00Z"),
            id = id,
            teslaId = 1000 + id,
            timezone = "UTC",
            updatedAt = Instant.parse("2026-01-01T00:10:00Z"),
            vin = "VIN$id",
        )
}
