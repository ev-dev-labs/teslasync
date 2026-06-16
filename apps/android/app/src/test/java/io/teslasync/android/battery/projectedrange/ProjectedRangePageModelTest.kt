package io.teslasync.android.battery.projectedrange

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

/**
 * Off-device verification of the ProjectedRangePage pure model — the native port of everything the web page derives
 * before composing its panels (web/src/features/battery/pages/ProjectedRangePage.tsx): the `/analytics/range-projection`
 * decode into null-safe models, the `hasData`/`whatIf*` scope getters, the deterministic `interpolateRange` Wh/km curve,
 * and the small `effColor`/`scenarioIcon`/`FACTOR_ICONS` classifications. No Compose, no device; runs in the
 * :android:testDebugUnitTest gate.
 */
class ProjectedRangePageModelTest {
    private val json = Json { ignoreUnknownKeys = true }

    private val sample =
        """
        {
          "your_estimate_km": 412.6,
          "tesla_estimate_km": 430.0,
          "battery_level": 80,
          "current_battery_pct": 82,
          "usable_capacity_wh": 75000,
          "efficiency_factor": 0.92,
          "health_factor": 0.95,
          "current_range_km": 350,
          "projected_range_km": 360,
          "accuracy_note": "Based on 120 drives",
          "factors": [
            {"name": "Temperature", "impact_pct": -8.5, "description": "Cold weather"},
            {"name": "Speed", "impact_pct": 4.0, "description": "Highway driving"}
          ],
          "projection_curve": [
            {"battery_pct": 100, "rated_range": 500, "projected_range": 460},
            {"battery_pct": 80, "rated_range": 400, "projected_range": 368}
          ],
          "scenarios": [
            {"name": "Highway", "speed_kmh": 110, "temp_c": 20, "efficiency_wh_km": 180,
             "range_km": 390, "range_mi": 242, "sample_count": 15, "extras": ["highway"], "is_current": true},
            {"name": "Sentry", "speed_kmh": 0, "temp_c": -5, "efficiency_wh_km": 200,
             "range_km": 300, "range_mi": 186, "sample_count": 3, "extras": ["sentry"], "is_current": false}
          ],
          "efficiency_matrix": [
            {"temp_bucket": "mild", "speed_bucket": "highway", "wh_km": 175, "samples": 12},
            {"temp_bucket": "cold", "speed_bucket": "city", "wh_km": 210, "samples": 4}
          ]
        }
        """.trimIndent()

    private fun parsed(): RangeProjection = parseRangeProjection(json.parseToJsonElement(sample))

    // ── Decode ──────────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun decodesScalarFields() {
        val p = parsed()
        assertEquals(412.6, p.yourEstimateKm, EPS)
        assertEquals(430.0, p.teslaEstimateKm, EPS)
        assertEquals(80.0, p.batteryLevel, EPS)
        assertEquals(82.0, p.currentBatteryPct, EPS)
        assertEquals(75000.0, p.usableCapacityWh, EPS)
        assertEquals(0.92, p.efficiencyFactor, EPS)
        assertEquals(0.95, p.healthFactor, EPS)
        assertEquals("Based on 120 drives", p.accuracyNote)
    }

    @Test
    fun decodesNestedCollections() {
        val p = parsed()
        assertEquals(2, p.factors.size)
        assertEquals("Temperature", p.factors[0].name)
        assertEquals(-8.5, p.factors[0].impactPct, EPS)
        assertEquals(2, p.projectionCurve.size)
        assertEquals(100.0, p.projectionCurve[0].batteryPct, EPS)
        assertEquals(460.0, p.projectionCurve[0].projectedRange, EPS)
        assertEquals(2, p.scenarios.size)
        assertTrue(p.scenarios[0].isCurrent)
        assertTrue(p.scenarios[0].extras.contains("highway"))
        assertEquals(2, p.efficiencyMatrix.size)
    }

    @Test
    fun matrixLookupKeysByTempPipeSpeed() {
        assertEquals(175.0, parsed().matrixLookup["mild|highway"]?.whKm)
        assertEquals(210.0, parsed().matrixLookup["cold|city"]?.whKm)
    }

    @Test
    fun hasDataTrueForRealPayloadFalseForEmpty() {
        assertTrue(parsed().hasData)
        assertFalse(parseRangeProjection(null).hasData)
        assertFalse(parseRangeProjection(JsonObject(emptyMap())).hasData)
    }

    @Test
    fun whatIfScopeUsesCurrentBatteryThenCapacity() {
        val p = parsed()
        assertEquals(82.0, p.whatIfBatteryPct, EPS)
        assertEquals(75000.0, p.whatIfCapacityWh, EPS)
    }

    // ── interpolateRange (web `interpolateRange`) ─────────────────────────────────────────────────────────

    @Test
    fun interpolateUsesMatchedBucketEfficiency() {
        val result =
            interpolateRange(parsed().efficiencyMatrix, speedKmh = 110.0, tempC = 20.0, batteryPct = 82.0, capacityWh = 75000.0)
        assertEquals(175.0, result.effWhKm, EPS)
        // 75000 * 0.82 / 175 = 351.428… -> rounded to one decimal.
        assertEquals(351.4, result.rangeKm, EPS)
    }

    @Test
    fun interpolateFallsBackToHeuristicWhenNoBucket() {
        val result =
            interpolateRange(matrix = emptyList(), speedKmh = 60.0, tempC = 5.0, batteryPct = 80.0, capacityWh = 75000.0)
        // 155 + (60-35)*0.5 + max(0,20-5)*1.5 = 190.
        assertEquals(190.0, result.effWhKm, EPS)
        assertEquals(315.8, result.rangeKm, EPS)
    }

    // ── classifications (web `effColor` / `scenarioIcon` / `FACTOR_ICONS`) ────────────────────────────────

    @Test
    fun effLevelBandsMatchWebThresholds() {
        assertEquals(EfficiencyLevel.Excellent, effLevel(150.0))
        assertEquals(EfficiencyLevel.Good, effLevel(170.0))
        assertEquals(EfficiencyLevel.Fair, effLevel(200.0))
        assertEquals(EfficiencyLevel.Poor, effLevel(220.0))
    }

    @Test
    fun scenarioKindPrioritizesSentryThenColdThenFast() {
        assertEquals(ScenarioKind.Sentry, scenarioKind(scenario(extras = listOf("sentry"), tempC = -5.0, speedKmh = 0.0)))
        assertEquals(ScenarioKind.Cold, scenarioKind(scenario(tempC = -3.0, speedKmh = 40.0)))
        assertEquals(ScenarioKind.Fast, scenarioKind(scenario(tempC = 25.0, speedKmh = 110.0)))
        assertEquals(ScenarioKind.Default, scenarioKind(scenario(tempC = 20.0, speedKmh = 50.0)))
    }

    @Test
    fun factorIconKeyLowercasesAndUnderscores() {
        assertEquals("driving_style", factorIconKey("Driving Style"))
        assertEquals("temperature", factorIconKey("Temperature"))
    }

    private fun scenario(
        extras: List<String> = emptyList(),
        tempC: Double = 20.0,
        speedKmh: Double = 50.0,
    ): RangeScenario =
        RangeScenario(
            name = "S",
            speedKmh = speedKmh,
            tempC = tempC,
            efficiencyWhKm = 180.0,
            rangeKm = 300.0,
            rangeMi = 186.0,
            sampleCount = 1,
            extras = extras,
            isCurrent = false,
        )

    private companion object {
        const val EPS = 1e-6
    }
}
