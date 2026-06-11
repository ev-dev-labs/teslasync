package io.teslasync.android.dashboard.widgets.regenefficiency

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
import java.util.Locale

/**
 * Off-device verification of the RegenEfficiencyWidget's pure logic — the JSON parse adapter, the
 * `regenPct = regenRatio * 100` derivation, the `regenColor` band heuristic, the gauge + stat
 * projection (incl. SI energy/power formatting + the `RadialGauge` value clamp), the registry metadata,
 * the size flags, and the cache-then-network `Resource` mapper. Mirrors the web spec
 * (web/src/features/dashboard/widgets/RegenEfficiencyWidget.tsx).
 */
class RegenEfficiencyProjectionTest {
    private fun labels(): RegenEfficiencyLabels =
        RegenEfficiencyLabels(
            totalRecovered = "Total Recovered",
            monthlyAvg = "Monthly Avg",
            freeCharges = "Free Charges",
            recovery = "recovery",
        )

    private fun prefs(): UnitPref =
        UnitPref(
            distance = DistanceUnitPref.KM,
            speed = SpeedUnitPref.KMH,
            temperature = TemperatureUnitPref.CELSIUS,
            pressure = PressureUnitPref.BAR,
            energy = EnergyUnitPref.KWH,
            duration = DurationUnitPref.HOURS,
            power = PowerUnitPref.KW,
            locale = "en-US",
            precision = null,
        )

    private fun snapshot(
        totalRegenWh: Double? = 12_300.0,
        monthlyAvgRegen: Double? = 5_200.0,
        freeCharges: Double = 3.0,
        regenRatio: Double = 0.25,
    ): RegenEfficiencySnapshot =
        RegenEfficiencySnapshot(
            totalRegenWh = totalRegenWh,
            monthlyAvgRegen = monthlyAvgRegen,
            freeCharges = freeCharges,
            regenRatio = regenRatio,
        )

    private fun project(
        snapshot: RegenEfficiencySnapshot,
        size: RegenEfficiencySize = STANDARD,
    ): RegenEfficiencyDisplay = RegenEfficiencyProjection.project(snapshot, size, labels(), prefs(), Locale.US)

    // ---- Parse adapter (web RegenEfficiencyData shape) ------------------------------

    @Test
    fun fromJson_readsSnakeCaseFields() {
        val json =
            Json.parseToJsonElement(
                """
                {"total_regen_wh":12300,"total_drive_wh":48000,"monthly_avg_regen":5200,
                 "regen_ratio":0.25,"free_charges":3}
                """.trimIndent(),
            )

        val s = requireNotNull(RegenEfficiencySnapshot.fromJson(json))

        assertEquals(12_300.0, s.totalRegenWh!!, EPS)
        assertEquals(5_200.0, s.monthlyAvgRegen!!, EPS)
        assertEquals(3.0, s.freeCharges, EPS)
        assertEquals(0.25, s.regenRatio, EPS)
    }

    @Test
    fun fromJson_nullableEnergyAndPowerStayNullDefaultsCollapseToZero() {
        // total_regen_wh / monthly_avg_regen absent ⇒ null (web `data?.x` → em-dash); the
        // `?? 0` reads (free_charges / regen_ratio) collapse to zero.
        val s = requireNotNull(RegenEfficiencySnapshot.fromJson(Json.parseToJsonElement("{}")))

        assertNull(s.totalRegenWh)
        assertNull(s.monthlyAvgRegen)
        assertEquals(0.0, s.freeCharges, EPS)
        assertEquals(0.0, s.regenRatio, EPS)
    }

    @Test
    fun fromJson_decodesAllZeroCardAsContent() {
        // The backend returns this card (HTTP 200) when there are no drives; the web `data ?` gate is
        // truthy so the gauge renders rather than the empty state.
        val json =
            Json.parseToJsonElement(
                """{"total_regen_wh":0,"monthly_avg_regen":0,"regen_ratio":0,"free_charges":0}""",
            )

        val s = requireNotNull(RegenEfficiencySnapshot.fromJson(json))
        assertEquals(0.0, s.regenRatio, EPS)
        assertEquals(0.0, s.totalRegenWh!!, EPS)
    }

    @Test
    fun fromJson_returnsNullForNonObjectBody() {
        assertNull(RegenEfficiencySnapshot.fromJson(Json.parseToJsonElement("null")))
        assertNull(RegenEfficiencySnapshot.fromJson(Json.parseToJsonElement("[]")))
    }

    // ---- recovery percentage + band heuristic (web regenPct / regenColor) -----------

    @Test
    fun recoveryPercent_multipliesRatioByOneHundred() {
        assertEquals(25.0, RegenEfficiencyProjection.recoveryPercent(0.25), EPS)
        assertEquals(0.0, RegenEfficiencyProjection.recoveryPercent(0.0), EPS)
        assertEquals(0.0, RegenEfficiencyProjection.recoveryPercent(Double.NaN), EPS)
    }

    @Test
    fun bandFor_matchesWebRegenColorThresholds() {
        // web regenColor: pct > 30 ⇒ high; pct > 15 ⇒ medium; else low (boundaries are exclusive).
        assertEquals(RegenBand.High, RegenEfficiencyProjection.bandFor(31.0))
        assertEquals(RegenBand.Medium, RegenEfficiencyProjection.bandFor(30.0))
        assertEquals(RegenBand.Medium, RegenEfficiencyProjection.bandFor(16.0))
        assertEquals(RegenBand.Low, RegenEfficiencyProjection.bandFor(15.0))
        assertEquals(RegenBand.Low, RegenEfficiencyProjection.bandFor(0.0))
        assertEquals(RegenBand.High, RegenEfficiencyProjection.bandFor(100.0))
    }

    // ---- projection (web regenPct + gaugeConfig + stats) ----------------------------

    @Test
    fun project_buildsGaugeLabelUnitBandAndStats() {
        val view = project(snapshot())

        assertFalse(view.isCompact)
        assertEquals(25.0, view.gaugeValue, EPS)
        assertEquals("25%", view.gaugeLabel)
        assertEquals("recovery", view.gaugeUnit)
        assertEquals(RegenBand.Medium, view.band)

        assertEquals(3, view.stats.size)
        assertEquals(RegenStatItem("Total Recovered", "12.3 kWh"), view.stats[0])
        assertEquals(RegenStatItem("Monthly Avg", "5.2 kW"), view.stats[1])
        assertEquals(RegenStatItem("Free Charges", "3"), view.stats[2])
    }

    @Test
    fun project_highAndLowBandsFollowRatio() {
        assertEquals(RegenBand.High, project(snapshot(regenRatio = 0.5)).band)
        assertEquals("50%", project(snapshot(regenRatio = 0.5)).gaugeLabel)
        assertEquals(RegenBand.Low, project(snapshot(regenRatio = 0.1)).band)
        assertEquals("10%", project(snapshot(regenRatio = 0.1)).gaugeLabel)
    }

    @Test
    fun project_roundsHalfTowardsPositiveInfinityLikeJsMathRound() {
        // 0.125 * 100 == 12.5 exactly; JS Math.round(12.5) == 13.
        val view = project(snapshot(regenRatio = 0.125))
        assertEquals("13%", view.gaugeLabel)
        assertEquals(13.0, view.gaugeValue, EPS)
    }

    @Test
    fun project_clampsGaugeValueToScaleButKeepsRawLabel() {
        // web RadialGauge clamps the displayed value to [0, max]; the `${Math.round(regenPct)}%` label
        // keeps the raw (unclamped) percentage.
        val view = project(snapshot(regenRatio = 1.5))
        assertEquals(100.0, view.gaugeValue, EPS)
        assertEquals("150%", view.gaugeLabel)
        assertEquals(RegenBand.High, view.band)
    }

    @Test
    fun project_absentEnergyOrPowerRendersEmDash() {
        val view = project(snapshot(totalRegenWh = null, monthlyAvgRegen = null))
        assertEquals(EM_DASH, view.stats[0].value)
        assertEquals(EM_DASH, view.stats[1].value)
    }

    @Test
    fun project_compactFootprintFlagsCompact() {
        assertTrue(project(snapshot(), COMPACT).isCompact)
    }

    @Test
    fun project_largeFreeChargesUsesEnUsGrouping() {
        assertEquals("1,234", project(snapshot(freeCharges = 1234.0)).stats[2].value)
    }

    // ---- registry metadata (web registry/driving.ts) --------------------------------

    @Test
    fun registry_metadataMatchesWebRegistry() {
        assertEquals("regen-efficiency", RegenEfficiencyRegistration.ID)
        assertEquals("driving", RegenEfficiencyRegistration.CATEGORY)
        assertEquals("RegenEfficiencyWidget", RegenEfficiencyRegistration.SLUG)
        assertEquals(RegenEfficiencySize(cols = 1, rows = 2), RegenEfficiencyRegistration.defaultSize)
        assertEquals(RegenEfficiencySize(cols = 1, rows = 2), RegenEfficiencyRegistration.minSize)
        assertEquals(RegenEfficiencySize(cols = 3, rows = 40), RegenEfficiencyRegistration.maxSize)
    }

    @Test
    fun registry_boundsAndClampHonourMinMax() {
        assertTrue(RegenEfficiencyRegistration.withinBounds(RegenEfficiencySize(cols = 1, rows = 2)))
        assertTrue(RegenEfficiencyRegistration.withinBounds(RegenEfficiencySize(cols = 3, rows = 40)))
        assertFalse(RegenEfficiencyRegistration.withinBounds(RegenEfficiencySize(cols = 0, rows = 1)))
        assertFalse(RegenEfficiencyRegistration.withinBounds(RegenEfficiencySize(cols = 4, rows = 50)))
        assertEquals(
            RegenEfficiencySize(cols = 1, rows = 2),
            RegenEfficiencyRegistration.clamp(RegenEfficiencySize(cols = 0, rows = 0)),
        )
        assertEquals(
            RegenEfficiencySize(cols = 3, rows = 40),
            RegenEfficiencyRegistration.clamp(RegenEfficiencySize(cols = 9, rows = 99)),
        )
    }

    @Test
    fun size_isCompactMatchesWeb() {
        assertTrue(RegenEfficiencySize(cols = 1, rows = 2).isCompact)
        assertTrue(RegenEfficiencySize(cols = 1, rows = 1).isCompact)
        assertFalse(RegenEfficiencySize(cols = 2, rows = 2).isCompact)
        assertFalse(RegenEfficiencySize(cols = 3, rows = 4).isCompact)
    }

    // ---- Resource mapper (cache-then-network preservation) --------------------------

    @Test
    fun resourceMapper_parsesPayloadAndPreservesStatus() {
        val json = Json.parseToJsonElement("""{"regen_ratio":0.25,"total_regen_wh":12300}""")

        val cached = Resource.Loading(cached = json, fetchedAt = NOW, stale = true).toRegenEfficiencySnapshot()
        assertTrue(cached is Resource.Loading)
        assertTrue(cached.stale)
        assertEquals(0.25, requireNotNull(cached.cached).regenRatio, EPS)

        val offline =
            Resource.Error(cached = json, fetchedAt = NOW, stale = true, error = ApiError.Network()).toRegenEfficiencySnapshot()
        assertTrue(offline is Resource.Error)
        assertEquals(12_300.0, requireNotNull(offline.cached?.totalRegenWh), EPS)
    }

    @Test
    fun resourceMapper_successWithNonObjectBecomesNullSnapshot() {
        val mapped =
            Resource.Success(data = Json.parseToJsonElement("null"), fetchedAt = NOW, stale = false).toRegenEfficiencySnapshot()
        assertTrue(mapped is Resource.Success)
        assertNull((mapped as Resource.Success).data)
    }

    private companion object {
        const val EPS = 1e-9
        const val NOW = 1_700_000_000_000L
        const val EM_DASH = "\u2014"
        val STANDARD = RegenEfficiencySize(cols = 2, rows = 2)
        val COMPACT = RegenEfficiencySize(cols = 1, rows = 2)
    }
}
