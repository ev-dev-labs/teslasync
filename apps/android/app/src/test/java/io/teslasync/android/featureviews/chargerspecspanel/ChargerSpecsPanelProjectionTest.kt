package io.teslasync.android.featureviews.chargerspecspanel

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the ChargerSpecsPanel pure projection — the native port of the web component's
 * `specs`-prop render contract (web/src/features/charging/components/charging-list/ChargerSpecsPanel.tsx):
 * the `hasData` gate (voltage/cable/brand, phase excluded), the `(specs) → UiState` adapter, the four
 * ordered `SpecColumn`s with their labels + empty messages, the Brand-only "{int} kW avg" vs "{energy} kWh"
 * branch, the SI→display `/1000` conversion, the "{count} sessions · {value}" composition, and the PII-safe
 * `view.opened` diagnostic. Runs in the :android:testReleaseUnitTest gate; no Compose, no device.
 */
class ChargerSpecsPanelProjectionTest {
    private val strings =
        ChargerSpecsStrings(
            title = "T",
            byVoltage = "Voltage",
            byPhase = "Phase",
            byCable = "Cable",
            byBrand = "Brand",
            noVoltage = "noV",
            noPhase = "noP",
            noCable = "noC",
            noBrand = "noB",
            noData = "noData",
            sessions = "sess",
            kw = "KW",
            kwh = "KWH",
            avg = "AV",
        )

    private val formatters =
        ChargerSpecsFormatters(
            count = { "n($it)" },
            energyKwh = { "e($it)" },
            powerKw = { "p($it)" },
        )

    private val specs =
        ChargerSpecsData(
            voltage = emptyList(),
            phase = emptyList(),
            cable =
                listOf(
                    SpecEntry("Type 2", 12, 340_000.0, null),
                    // Even with a power sample, a non-Brand column must show energy, not "kW avg".
                    SpecEntry("CCS", 5, 210_000.0, 99_000.0),
                ),
            brand =
                listOf(
                    SpecEntry("Tesla", 9, 480_000.0, 120_000.0),
                    SpecEntry("ChargePoint", 3, 90_000.0, null),
                ),
        )

    // ── hasData gate (web `specs && (voltage||cable||brand).length`; phase excluded) ────────────────────

    @Test
    fun hasDataIsFalseForNullOrFullyEmpty() {
        assertFalse(ChargerSpecsPanelProjection.hasData(null))
        assertFalse(
            ChargerSpecsPanelProjection.hasData(
                ChargerSpecsData(emptyList(), emptyList(), emptyList(), emptyList()),
            ),
        )
    }

    @Test
    fun hasDataIgnoresPhaseExactlyLikeTheWebGate() {
        // Web parity: a populated `phase` alone does NOT satisfy the gate (it checks voltage/cable/brand).
        val phaseOnly =
            ChargerSpecsData(
                voltage = emptyList(),
                phase = listOf(SpecEntry("3-phase", 4, 100_000.0, null)),
                cable = emptyList(),
                brand = emptyList(),
            )
        assertFalse(ChargerSpecsPanelProjection.hasData(phaseOnly))
    }

    @Test
    fun hasDataIsTrueWhenVoltageCableOrBrandHasRows() {
        val voltageOnly =
            ChargerSpecsData(listOf(SpecEntry("400V", 1, 1_000.0, null)), emptyList(), emptyList(), emptyList())
        val cableOnly =
            ChargerSpecsData(emptyList(), emptyList(), listOf(SpecEntry("CCS", 1, 1_000.0, null)), emptyList())
        val brandOnly =
            ChargerSpecsData(emptyList(), emptyList(), emptyList(), listOf(SpecEntry("Tesla", 1, 1_000.0, null)))
        assertTrue(ChargerSpecsPanelProjection.hasData(voltageOnly))
        assertTrue(ChargerSpecsPanelProjection.hasData(cableOnly))
        assertTrue(ChargerSpecsPanelProjection.hasData(brandOnly))
    }

    // ── projectUiState adapter (web content/empty outcomes) ─────────────────────────────────────────────

    @Test
    fun projectUiStateIsContentWhenHasData() {
        val state = ChargerSpecsPanelProjection.projectUiState(specs)
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(specs, state.data)
    }

    @Test
    fun projectUiStateIsEmptyWhenNullOrNoData() {
        assertEquals(UiPhase.Empty, ChargerSpecsPanelProjection.projectUiState(null).phase)
        val empty = ChargerSpecsData(emptyList(), emptyList(), emptyList(), emptyList())
        assertEquals(UiPhase.Empty, ChargerSpecsPanelProjection.projectUiState(empty).phase)
    }

    // ── project: four ordered columns with labels + empty messages ──────────────────────────────────────

    @Test
    fun projectBuildsFourColumnsInWebSourceOrder() {
        val result = ChargerSpecsPanelProjection.project(specs, strings, formatters)
        assertTrue(result.hasData)
        assertEquals(
            listOf(SpecColumnKind.Voltage, SpecColumnKind.Phase, SpecColumnKind.Cable, SpecColumnKind.Brand),
            result.columns.map { it.kind },
        )
        assertEquals(listOf("Voltage", "Phase", "Cable", "Brand"), result.columns.map { it.label })
    }

    @Test
    fun emptyColumnsCarryTheirOwnEmptyMessage() {
        val result = ChargerSpecsPanelProjection.project(specs, strings, formatters)
        val voltage = result.columns.single { it.kind == SpecColumnKind.Voltage }
        val phase = result.columns.single { it.kind == SpecColumnKind.Phase }
        assertTrue(voltage.isEmpty)
        assertTrue(voltage.rows.isEmpty())
        assertEquals("noV", voltage.emptyMessage)
        assertTrue(phase.isEmpty)
        assertEquals("noP", phase.emptyMessage)
    }

    // ── Brand column: "{int} kW avg" when avgPower present, else "{energy} kWh"; SI /1000 conversion ─────

    @Test
    fun brandRowShowsAveragePowerInKwWhenPresent() {
        val brand = column(SpecColumnKind.Brand)
        // 480_000 W / 1000 = 480 kW → the powerKw formatter receives the converted value.
        assertEquals("Tesla", brand.rows[0].name)
        assertEquals("n(9) sess $MIDDOT p(120.0) KW AV", brand.rows[0].summary)
    }

    @Test
    fun brandRowFallsBackToEnergyWhenAveragePowerIsNull() {
        val brand = column(SpecColumnKind.Brand)
        // 90_000 Wh / 1000 = 90 kWh → the energyKwh formatter receives the converted value.
        assertEquals("ChargePoint", brand.rows[1].name)
        assertEquals("n(3) sess $MIDDOT e(90.0) KWH", brand.rows[1].summary)
    }

    @Test
    fun nonBrandRowsAlwaysShowEnergyEvenWithAPowerSample() {
        val cable = column(SpecColumnKind.Cable)
        // 340_000 Wh / 1000 = 340 kWh.
        assertEquals("n(12) sess $MIDDOT e(340.0) KWH", cable.rows[0].summary)
        // CCS carries a power sample, but the Cable column must still show energy (web `showAvgPower` is
        // Brand-only): 210_000 Wh / 1000 = 210 kWh.
        assertEquals("n(5) sess $MIDDOT e(210.0) KWH", cable.rows[1].summary)
    }

    // ── Diagnostics (P1/S11 view.opened) ────────────────────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsSurfaceSlug() {
        val logger = RecordingLogger()
        recordChargerSpecsPanelOpened(logger)
        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "ChargerSpecsPanel"), opened.single().second)
        assertEquals("ChargerSpecsPanel", CHARGER_SPECS_PANEL_SLUG)
    }

    private fun column(kind: SpecColumnKind): ChargerSpecsColumn =
        ChargerSpecsPanelProjection.project(specs, strings, formatters).columns.single { it.kind == kind }

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
}
