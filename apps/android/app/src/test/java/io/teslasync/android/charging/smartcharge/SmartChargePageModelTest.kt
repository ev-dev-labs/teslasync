package io.teslasync.android.charging.smartcharge

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneOffset

/**
 * Off-device coverage of the framework-free SmartChargePage model (the :android:testDebugUnitTest gate): the wire
 * decoding of the two read feeds + the optimize response, the depart-by + charge-window date math, the display
 * formatters (currency / number / percent / time), the settings-derived preferences, and the PII-safe diagnostic.
 */
class SmartChargePageModelTest {
    private val zone = ZoneOffset.UTC

    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }

    @Test
    fun decodeRatePlansParsesRows() {
        val element = Json.parseToJsonElement("""[{"id":"pge-ev2a","name":"PG&E EV2-A","utility":"PG&E"}]""")
        val plans = decodeRatePlans(element)
        assertEquals(1, plans.size)
        assertEquals("pge-ev2a", plans.single().id)
        assertEquals("PG&E", plans.single().utility)
    }

    @Test
    fun decodeRatePlansToleratesMalformedPayload() {
        assertTrue(decodeRatePlans(Json.parseToJsonElement("""{"not":"an array"}""")).isEmpty())
        assertTrue(decodeRatePlans(null).isEmpty())
    }

    @Test
    fun decodeChargePlansParsesHistoryRow() {
        val element =
            Json.parseToJsonElement(
                """[{"id":5,"vehicle_id":1,"target_soc":80,"scheduled_start":"2024-01-15T08:00:00Z",
                   "scheduled_end":"2024-01-15T10:00:00Z","rate_plan":"pge-ev2a","estimated_cost":3.5,
                   "savings":1.2,"status":"scheduled","created_at":"2024-01-14T12:00:00Z"}]""",
            )
        val plan = decodeChargePlans(element).single()
        assertEquals(5L, plan.id)
        assertEquals("pge-ev2a", plan.ratePlan)
        assertEquals(3.5, plan.estimatedCost)
        assertEquals("scheduled", plan.status)
    }

    @Test
    fun decodeOptimizeResultParsesSchedule() {
        val result = decodeOptimizeResult(Json.parseToJsonElement(OPTIMIZE_JSON))
        assertNotNull(result)
        requireNotNull(result)
        assertEquals(7L, result.planId)
        assertEquals("OFF_PEAK", result.schedule.rateTier)
        assertEquals(2.6, result.comparison.savings, 0.0)
        assertEquals(24, result.hourlyRates.size)
    }

    @Test
    fun decodeOptimizeResultNullOnMalformed() {
        assertNull(decodeOptimizeResult(null))
        assertNull(decodeOptimizeResult(Json.parseToJsonElement("""[1,2,3]""")))
    }

    @Test
    fun defaultDepartByIsTomorrowAtHalfPastSeven() {
        val now = Instant.parse("2024-01-15T10:00:00Z")
        assertEquals("2024-01-16T07:30", defaultDepartBy(now, zone))
    }

    @Test
    fun departByToIsoConvertsLocalToInstant() {
        val now = Instant.parse("2024-01-15T10:00:00Z")
        assertEquals("2024-01-16T07:30:00Z", departByToIso("2024-01-16T07:30", zone, now))
    }

    @Test
    fun departByToIsoFallsBackToNowOnGarbage() {
        val now = Instant.parse("2024-01-15T10:00:00Z")
        assertEquals("2024-01-15T10:00:00Z", departByToIso("not-a-date", zone, now))
    }

    @Test
    fun chargeWindowHoursReadsScheduleHours() {
        val result = decodeOptimizeResult(Json.parseToJsonElement(OPTIMIZE_JSON))
        assertEquals(8..11, chargeWindowHours(result, zone))
        assertNull(chargeWindowHours(null, zone))
    }

    @Test
    fun isHourInWindowHandlesDirectAndCrossMidnight() {
        assertTrue(isHourInWindow(9, 8..11))
        assertTrue(!isHourInWindow(11, 8..11))
        assertTrue(isHourInWindow(23, IntRange(22, 2)))
        assertTrue(isHourInWindow(1, IntRange(22, 2)))
        assertTrue(!isHourInWindow(5, IntRange(22, 2)))
        assertTrue(!isHourInWindow(3, null))
    }

    @Test
    fun maxRateCentsAndHourLabels() {
        assertEquals(40.0, maxRateCents(listOf(HourlyRate(0, 12.0, "OFF_PEAK"), HourlyRate(17, 40.0, "ON_PEAK"))), 0.0)
        assertEquals(1.0, maxRateCents(emptyList()), 0.0)
        assertEquals("12a", formatHourLabel(0))
        assertEquals("6a", formatHourLabel(6))
        assertEquals("12p", formatHourLabel(12))
        assertEquals("6p", formatHourLabel(18))
    }

    @Test
    fun prefsResolveFromSettingsDocument() {
        val settings = Json.parseToJsonElement("""{"currency_symbol":"€","decimal_precision":1,"locale":"de-DE"}""")
        val prefs = SmartChargePrefs.from(settings)
        assertEquals("€", prefs.currencySymbol)
        assertEquals(1, prefs.precision)
        assertEquals("de-DE", prefs.localeTag)
    }

    @Test
    fun prefsFallBackWhenSettingsAbsent() {
        val prefs = SmartChargePrefs.from(null)
        assertEquals("$", prefs.currencySymbol)
        assertEquals(2, prefs.precision)
        assertEquals("", prefs.localeTag)
    }

    @Test
    fun formattersRenderCurrencyNumberPercent() {
        val fmt = SmartChargeFormatters(SmartChargePrefs("$", 2, "en-US"), zone)
        assertEquals("$2.50", fmt.currency(2.5))
        assertEquals("1,234.5", fmt.number(1234.5, 1))
        assertEquals("85%", fmt.percent(85.0, 0))
        assertEquals("$0.00", fmt.currency(null))
    }

    @Test
    fun formattersRenderTimeAndGuardBadInput() {
        val fmt = SmartChargeFormatters(SmartChargePrefs("$", 2, "en-US"), zone)
        assertTrue(fmt.time("2024-01-15T08:30:00Z") != SMART_CHARGE_EM_DASH)
        assertEquals(SMART_CHARGE_EM_DASH, fmt.time(null))
        assertEquals(SMART_CHARGE_EM_DASH, fmt.time("not-a-date"))
        assertTrue(fmt.dateTime("2024-01-15T08:30:00Z") != SMART_CHARGE_EM_DASH)
    }

    @Test
    fun safeNumberCoercesNonFinite() {
        assertEquals(0.0, safeNumber(null), 0.0)
        assertEquals(0.0, safeNumber(Double.NaN), 0.0)
        assertEquals(0.0, safeNumber(Double.POSITIVE_INFINITY), 0.0)
        assertEquals(3.5, safeNumber(3.5), 0.0)
    }

    @Test
    fun recordViewOpenedEmitsSlug() {
        val logger = RecordingLogger()
        recordSmartChargePageOpened(logger)
        val opened = logger.events.single { it.first == "view.opened" }
        assertEquals(mapOf("surface" to "SmartChargePage"), opened.second)
    }

    private companion object {
        const val OPTIMIZE_JSON = """
            {
              "plan_id": 7, "current_soc": 50, "target_soc": 80, "kwh_needed": 20,
              "estimated_duration_hours": 2,
              "schedule": {
                "start_time": "2024-01-15T08:00:00Z", "end_time": "2024-01-15T11:00:00Z",
                "rate_cents_kwh": 12, "estimated_cost": 2.4, "rate_tier": "OFF_PEAK"
              },
              "comparison": {
                "charge_now_cost": 5, "optimized_cost": 2.4, "savings": 2.6, "savings_percent": 52
              },
              "alternative_windows": [],
              "hourly_rates": [
                {"hour":0,"rate_cents":12,"tier":"OFF_PEAK"},{"hour":1,"rate_cents":12,"tier":"OFF_PEAK"},
                {"hour":2,"rate_cents":12,"tier":"OFF_PEAK"},{"hour":3,"rate_cents":12,"tier":"OFF_PEAK"},
                {"hour":4,"rate_cents":12,"tier":"OFF_PEAK"},{"hour":5,"rate_cents":12,"tier":"OFF_PEAK"},
                {"hour":6,"rate_cents":18,"tier":"MID_PEAK"},{"hour":7,"rate_cents":18,"tier":"MID_PEAK"},
                {"hour":8,"rate_cents":12,"tier":"OFF_PEAK"},{"hour":9,"rate_cents":12,"tier":"OFF_PEAK"},
                {"hour":10,"rate_cents":12,"tier":"OFF_PEAK"},{"hour":11,"rate_cents":18,"tier":"MID_PEAK"},
                {"hour":12,"rate_cents":18,"tier":"MID_PEAK"},{"hour":13,"rate_cents":18,"tier":"MID_PEAK"},
                {"hour":14,"rate_cents":18,"tier":"MID_PEAK"},{"hour":15,"rate_cents":40,"tier":"ON_PEAK"},
                {"hour":16,"rate_cents":40,"tier":"ON_PEAK"},{"hour":17,"rate_cents":40,"tier":"ON_PEAK"},
                {"hour":18,"rate_cents":40,"tier":"ON_PEAK"},{"hour":19,"rate_cents":40,"tier":"ON_PEAK"},
                {"hour":20,"rate_cents":18,"tier":"MID_PEAK"},{"hour":21,"rate_cents":18,"tier":"MID_PEAK"},
                {"hour":22,"rate_cents":12,"tier":"OFF_PEAK"},{"hour":23,"rate_cents":12,"tier":"OFF_PEAK"}
              ]
            }
        """
    }
}
