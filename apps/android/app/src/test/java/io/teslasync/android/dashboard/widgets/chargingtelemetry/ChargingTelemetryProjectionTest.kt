package io.teslasync.android.dashboard.widgets.chargingtelemetry

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the ChargingTelemetryWidget's pure logic — the JSON parse adapter, the
 * efficiency / charger-type heuristics, the stat-grid + compact-hero projection across the
 * compact / standard / wide footprints, the rolling power-history fold, the registry metadata, and
 * the cache-then-network `Resource` mapper. Mirrors the web spec
 * (web/src/features/dashboard/widgets/ChargingTelemetryWidget.tsx) and the WinUI parity tests.
 */
class ChargingTelemetryProjectionTest {
    private fun labels(): ChargingTelemetryLabels =
        ChargingTelemetryLabels(
            voltage = "Voltage",
            current = "Current",
            power = "Power",
            phases = "Phases",
            efficiency = "Efficiency",
            charger = "Charger",
        )

    // The fixture builder legitimately mirrors the wide telemetry record's fields; the parameter
    // count is intentional for readable, named test setup.
    @Suppress("LongParameterList")
    private fun snapshot(
        chargingState: String? = "Charging",
        chargerVoltage: Double? = 250.0,
        chargerPowerW: Double? = 8.0,
        chargerPhases: Int? = 1,
        chargerPilotCurrent: Double? = 40.0,
        ts: String? = "2026-06-06T12:00:00Z",
    ): ChargingTelemetrySnapshot =
        ChargingTelemetrySnapshot(
            chargingState = chargingState,
            chargerVoltage = chargerVoltage,
            chargerActualCurrent = DEFAULT_CURRENT,
            chargerPowerW = chargerPowerW,
            chargerPhases = chargerPhases,
            chargerPilotCurrent = chargerPilotCurrent,
            ts = ts,
        )

    private fun project(
        snapshot: ChargingTelemetrySnapshot?,
        size: ChargingTelemetrySize = ChargingTelemetryRegistration.defaultSize,
    ): ChargingTelemetryDisplay = ChargingTelemetryProjection.project(snapshot, size, labels())

    // ---- Parse adapter (web ChargingTelemetry shape) --------------------------------

    @Test
    fun fromJson_readsSnakeCaseFields() {
        val json =
            Json.parseToJsonElement(
                """
                {"vehicle_id":1,"ts":"2026-06-06T12:00:00Z","charging_state":"Charging",
                 "charger_voltage":240.5,"charger_actual_current":48,"charger_power_w":11.2,
                 "charger_phases":3,"charger_pilot_current":50}
                """.trimIndent(),
            )

        val s = requireNotNull(ChargingTelemetrySnapshot.fromJson(json))

        assertEquals("Charging", s.chargingState)
        assertTrue(s.isCharging)
        assertEquals(240.5, requireNotNull(s.chargerVoltage), EPS)
        assertEquals(48.0, requireNotNull(s.chargerActualCurrent), EPS)
        assertEquals(11.2, requireNotNull(s.chargerPowerW), EPS)
        assertEquals(3, s.chargerPhases)
        assertEquals(50.0, requireNotNull(s.chargerPilotCurrent), EPS)
        assertEquals("2026-06-06T12:00:00Z", s.ts)
    }

    @Test
    fun fromJson_isTolerantOfMissingAndNullFields() {
        val s = requireNotNull(ChargingTelemetrySnapshot.fromJson(Json.parseToJsonElement("""{"charging_state":null}""")))

        assertNull(s.chargingState)
        assertFalse(s.isCharging)
        assertNull(s.chargerVoltage)
        assertNull(s.chargerPhases)
        assertNull(s.ts)
    }

    @Test
    fun fromJson_returnsNullForNonObjectBody() {
        assertNull(ChargingTelemetrySnapshot.fromJson(Json.parseToJsonElement("null")))
        assertNull(ChargingTelemetrySnapshot.fromJson(Json.parseToJsonElement("[]")))
    }

    @Test
    fun isCharging_onlyTrueForChargingState() {
        assertTrue(snapshot(chargingState = "Charging").isCharging)
        assertFalse(snapshot(chargingState = "Stopped").isCharging)
        assertFalse(snapshot(chargingState = null).isCharging)
    }

    // ---- charger-type heuristic (web chargerType memo) ------------------------------

    @Test
    fun chargerType_dcAboveThresholdAcBelow_onlyWhenCharging() {
        assertEquals(ChargerType.Ac, ChargingTelemetryProjection.chargerTypeFor(charging = true, voltage = 250.0))
        assertEquals(ChargerType.Ac, ChargingTelemetryProjection.chargerTypeFor(charging = true, voltage = 300.0))
        assertEquals(ChargerType.Dc, ChargingTelemetryProjection.chargerTypeFor(charging = true, voltage = 400.0))
        assertNull(ChargingTelemetryProjection.chargerTypeFor(charging = false, voltage = 400.0))
    }

    // ---- efficiency heuristic (web efficiency memo) ---------------------------------

    @Test
    fun efficiency_isActualOverTheoreticalCappedAt100() {
        // theoretical = pilot(40) * voltage(250) * phases(1) / 1000 = 10 kW; power 8 -> 80%.
        val eff = ChargingTelemetryProjection.efficiencyFor(snapshot(), charging = true)
        assertEquals(80.0, requireNotNull(eff), EPS)
    }

    @Test
    fun efficiency_capsAt100() {
        // theoretical = 10 kW, power 25 -> 250% capped to 100.
        val eff = ChargingTelemetryProjection.efficiencyFor(snapshot(chargerPowerW = 25.0), charging = true)
        assertEquals(ChargingTelemetryProjection.MAX_EFFICIENCY, requireNotNull(eff), EPS)
    }

    @Test
    fun efficiency_nullWhenNotChargingOrNoPilotOrNoVoltage() {
        assertNull(ChargingTelemetryProjection.efficiencyFor(snapshot(), charging = false))
        assertNull(ChargingTelemetryProjection.efficiencyFor(snapshot(chargerPilotCurrent = 0.0), charging = true))
        assertNull(ChargingTelemetryProjection.efficiencyFor(snapshot(chargerVoltage = 0.0), charging = true))
        assertNull(ChargingTelemetryProjection.efficiencyFor(null, charging = true))
    }

    @Test
    fun efficiency_phasesDefaultToOneWhenZero() {
        // pilot 40 * voltage 250 * 1 / 1000 = 10 kW even when phases = 0; power 8 -> 80%.
        val eff = ChargingTelemetryProjection.efficiencyFor(snapshot(chargerPhases = 0), charging = true)
        assertEquals(80.0, requireNotNull(eff), EPS)
    }

    // ---- standard projection (web coreStats, 2-up grid) -----------------------------

    @Test
    fun project_standardChargingFormatsCoreStats() {
        val view = project(snapshot())

        assertTrue(view.isCharging)
        assertFalse(view.isWide)
        assertEquals(2, view.statColumns)
        assertEquals(4, view.stats.size)

        assertStat(view.stats[0], "Voltage", "250", "V", ChargingTelemetryGlyph.Bolt)
        assertStat(view.stats[1], "Current", "32", "A", ChargingTelemetryGlyph.Gauge)
        assertStat(view.stats[2], "Power", "8.0", "kW", ChargingTelemetryGlyph.BatteryCharging)
        assertStat(view.stats[3], "Phases", "1", null, ChargingTelemetryGlyph.Gauge)
    }

    @Test
    fun project_phasesShowEmDashWhenZero() {
        val view = project(snapshot(chargerPhases = 0))
        assertEquals("\u2014", view.stats[3].value)
    }

    @Test
    fun project_acChargerBadgeNeutralVoltage() {
        val view = project(snapshot(chargerVoltage = 250.0), ChargingTelemetrySize(cols = 4, rows = 4))
        assertEquals(ChargerType.Ac, view.chargerType)
        assertEquals("AC Charger", view.chargerBadgeText)
        assertTrue(view.hasChargerBadge)
    }

    // ---- wide projection (web wideStats + badge) ------------------------------------

    @Test
    fun project_wideAddsEfficiencyStatAndDcBadge() {
        val view = project(snapshot(chargerVoltage = 400.0), ChargingTelemetrySize(cols = 4, rows = 4))

        assertTrue(view.isWide)
        assertEquals(4, view.statColumns)
        assertEquals(5, view.stats.size)
        // theoretical = 40 * 400 * 1 / 1000 = 16 kW; power 8 -> 50%.
        assertStat(view.stats[4], "Efficiency", "50", "%", ChargingTelemetryGlyph.Gauge)
        assertEquals(ChargerType.Dc, view.chargerType)
        assertEquals("DC Charger", view.chargerBadgeText)
    }

    @Test
    fun project_wideOmitsEfficiencyWhenNotDerivable() {
        val view = project(snapshot(chargerPilotCurrent = 0.0), ChargingTelemetrySize(cols = 4, rows = 4))
        assertTrue(view.isWide)
        assertEquals(4, view.stats.size) // no efficiency stat appended
    }

    // ---- compact hero (web isCompact branch) ----------------------------------------

    @Test
    fun project_compactHeroTextAndAccessibleName() {
        val view = project(snapshot(), ChargingTelemetrySize(cols = 1, rows = 2))
        assertTrue(view.isCompact)
        assertEquals("8.0 kW", view.heroPowerText)
        assertEquals("250V \u00b7 32A", view.heroSummaryText)
        assertEquals("8.0 kW, 250V \u00b7 32A", view.compactContentDescription)
    }

    // ---- not-charging + null (web "Not currently charging" gate) --------------------

    @Test
    fun project_notChargingHasNoStatsOrBadge() {
        val view = project(snapshot(chargingState = "Disconnected"))
        assertFalse(view.isCharging)
        assertTrue(view.stats.isEmpty())
        assertNull(view.chargerType)
        assertFalse(view.hasChargerBadge)
        assertEquals("", view.chargerBadgeText)
    }

    @Test
    fun project_nullSnapshotIsNotChargingWithZeroHero() {
        val view = project(null)
        assertFalse(view.isCharging)
        assertTrue(view.stats.isEmpty())
        assertEquals("0.0 kW", view.heroPowerText)
        assertEquals("0V \u00b7 0A", view.heroSummaryText)
    }

    // ---- number formatting (web fmtNumber/fmtInt) -----------------------------------

    @Test
    fun formatNumber_groupsThousandsAndFixesDecimals() {
        assertEquals("11,000.0", ChargingTelemetryProjection.formatNumber(11_000.0, 1))
        assertEquals("250", ChargingTelemetryProjection.formatNumber(250.0, 0))
        assertEquals("1", ChargingTelemetryProjection.formatInt(1))
    }

    @Test
    fun formatNumber_coercesNonFiniteToZero() {
        assertEquals("0.0", ChargingTelemetryProjection.formatNumber(Double.NaN, 1))
        assertEquals("0", ChargingTelemetryProjection.formatNumber(Double.POSITIVE_INFINITY, 0))
    }

    // ---- power-history accumulator (web powerHistoryRef) ----------------------------

    @Test
    fun powerHistory_appendsOncePerDistinctTimestamp() {
        val a = PowerHistoryAccumulator.EMPTY.append(snapshot(chargerPowerW = 5.0, ts = "t1"))
        assertEquals(listOf(5.0), a.values)

        // Same timestamp -> no-op.
        val b = a.append(snapshot(chargerPowerW = 9.0, ts = "t1"))
        assertEquals(listOf(5.0), b.values)

        // New timestamp -> appended.
        val c = b.append(snapshot(chargerPowerW = 9.0, ts = "t2"))
        assertEquals(listOf(5.0, 9.0), c.values)
    }

    @Test
    fun powerHistory_nullSnapshotIsNoOpAndMissingPowerIsZero() {
        val a = PowerHistoryAccumulator.EMPTY.append(null)
        assertTrue(a.values.isEmpty())

        val b = a.append(snapshot(chargerPowerW = null, ts = "t1"))
        assertEquals(listOf(0.0), b.values)
    }

    @Test
    fun powerHistory_capsAtMax() {
        var acc = PowerHistoryAccumulator.EMPTY
        repeat(PowerHistoryAccumulator.MAX_POWER_HISTORY + 5) { i ->
            acc = acc.append(snapshot(chargerPowerW = i.toDouble(), ts = "t$i"))
        }
        assertEquals(PowerHistoryAccumulator.MAX_POWER_HISTORY, acc.values.size)
        // Retains the most recent readings (last value is the final index).
        assertEquals((PowerHistoryAccumulator.MAX_POWER_HISTORY + 4).toDouble(), acc.values.last(), EPS)
    }

    // ---- registry metadata (web registry/charging.ts) -------------------------------

    @Test
    fun registry_metadataMatchesWebRegistry() {
        assertEquals("charging-telemetry", ChargingTelemetryRegistration.ID)
        assertEquals("charging", ChargingTelemetryRegistration.CATEGORY)
        assertEquals("ChargingTelemetryWidget", ChargingTelemetryRegistration.SLUG)
        assertEquals(ChargingTelemetrySize(cols = 2, rows = 2), ChargingTelemetryRegistration.defaultSize)
        assertEquals(ChargingTelemetrySize(cols = 1, rows = 2), ChargingTelemetryRegistration.minSize)
        assertEquals(ChargingTelemetrySize(cols = 4, rows = 40), ChargingTelemetryRegistration.maxSize)
    }

    @Test
    fun registry_boundsAndClampHonourMinMax() {
        assertTrue(ChargingTelemetryRegistration.withinBounds(ChargingTelemetrySize(cols = 2, rows = 2)))
        assertFalse(ChargingTelemetryRegistration.withinBounds(ChargingTelemetrySize(cols = 0, rows = 1)))
        assertFalse(ChargingTelemetryRegistration.withinBounds(ChargingTelemetrySize(cols = 5, rows = 50)))
        assertEquals(
            ChargingTelemetrySize(cols = 1, rows = 2),
            ChargingTelemetryRegistration.clamp(ChargingTelemetrySize(cols = 0, rows = 0)),
        )
        assertEquals(
            ChargingTelemetrySize(cols = 4, rows = 40),
            ChargingTelemetryRegistration.clamp(ChargingTelemetrySize(cols = 9, rows = 99)),
        )
    }

    @Test
    fun size_flagsMatchWeb() {
        assertTrue(ChargingTelemetrySize(cols = 1, rows = 2).isCompact)
        assertFalse(ChargingTelemetrySize(cols = 2, rows = 2).isCompact)
        assertFalse(ChargingTelemetrySize(cols = 3, rows = 4).isWide)
        assertTrue(ChargingTelemetrySize(cols = 4, rows = 4).isWide)
    }

    // ---- Resource mapper (cache-then-network preservation) --------------------------

    @Test
    fun resourceMapper_parsesPayloadAndPreservesStatus() {
        val json = Json.parseToJsonElement("""{"charging_state":"Charging","charger_voltage":240}""")

        val cached = Resource.Loading(cached = json, fetchedAt = NOW, stale = true).toChargingTelemetrySnapshot()
        assertTrue(cached is Resource.Loading)
        assertTrue(cached.stale)
        assertTrue(requireNotNull(cached.cached).isCharging)

        val offline =
            Resource.Error(cached = json, fetchedAt = NOW, stale = true, error = ApiError.Network()).toChargingTelemetrySnapshot()
        assertTrue(offline is Resource.Error)
        assertEquals(240.0, requireNotNull(offline.cached?.chargerVoltage), EPS)
    }

    @Test
    fun resourceMapper_successWithNonObjectBecomesNullSnapshot() {
        val mapped =
            Resource.Success(data = Json.parseToJsonElement("null"), fetchedAt = NOW, stale = false).toChargingTelemetrySnapshot()
        assertTrue(mapped is Resource.Success)
        assertNull((mapped as Resource.Success).data)
    }

    private fun assertStat(
        stat: ChargingTelemetryStat,
        label: String,
        value: String,
        unit: String?,
        glyph: ChargingTelemetryGlyph,
    ) {
        assertEquals(label, stat.label)
        assertEquals(value, stat.value)
        assertEquals(unit, stat.unit)
        assertEquals(glyph, stat.glyph)
    }

    private companion object {
        const val EPS = 1e-9
        const val NOW = 1_700_000_000_000L
        const val DEFAULT_CURRENT = 32.0
    }
}
