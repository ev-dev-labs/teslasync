package io.teslasync.android.featureviews.energychargingpanel

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.formatSpeed
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the EnergyChargingPanel pure projection — the native port of the web component's
 * `chargingTelemetry`-prop render contract
 * (web/src/features/vehicles/components/telemetry-panels/EnergyChargingPanel.tsx): the `(telemetry) → UiState`
 * adapter (present → content, absent → empty), each field's `fmtNumber`/`fmtWithUnit`/`formatSpeed` formatting
 * including the two verbatim no-`/1000` kW / kWh branches, the `range_added_meters_per_hour / 3600` charge-rate
 * conversion, the three-way Charging-State chip classification, the `?? Unknown` chip fallback, the merged
 * accessibility label, and the PII-safe `view.opened` diagnostic. Runs in the :android:testReleaseUnitTest gate; no
 * Compose, no device.
 */
class EnergyChargingPanelProjectionTest {
    // en-US / 2-decimal preferences (metric speed unit) — a controlled `/settings` document so every formatted
    // value below is deterministic regardless of the host default locale.
    private val prefs =
        EnergyChargingDisplayPrefs.from(
            buildJsonObject {
                put("decimal_precision", 2)
                put("locale", "en-US")
            },
        )

    private val strings =
        EnergyChargingStrings(
            title = "Energy & Charging",
            chargerVoltage = "Voltage",
            chargerCurrent = "Current",
            chargerPower = "Power",
            energyAdded = "Energy",
            chargingState = "State",
            batteryLevel = "Battery",
            chargeRate = "Rate",
            unknown = "UNK",
            noData = "noData",
            kw = "kW",
            kwh = "kWh",
        )

    private val snapshot =
        ChargingTelemetrySnapshot(
            chargerVoltage = 238.0,
            chargerActualCurrent = 16.0,
            chargerPowerW = 11_000.0,
            chargeEnergyAddedWh = 8_450.0,
            chargingState = "Charging",
            batteryLevel = 72.0,
            rangeAddedMetersPerHour = 36_000.0,
        )

    private val allNull =
        ChargingTelemetrySnapshot(
            chargerVoltage = null,
            chargerActualCurrent = null,
            chargerPowerW = null,
            chargeEnergyAddedWh = null,
            chargingState = null,
            batteryLevel = null,
            rangeAddedMetersPerHour = null,
        )

    // ── projectUiState adapter (web present/absent outcomes) ────────────────────────────────────────────

    @Test
    fun projectUiStateIsContentWhenTelemetryPresent() {
        val state = EnergyChargingPanelProjection.projectUiState(snapshot)
        assertEquals(UiPhase.Content, state.phase)
        assertSame(snapshot, state.data)
    }

    @Test
    fun projectUiStateIsEmptyWhenTelemetryAbsent() {
        val state = EnergyChargingPanelProjection.projectUiState(null)
        assertEquals(UiPhase.Empty, state.phase)
        assertEquals(null, state.data)
    }

    @Test
    fun projectUiStateIsContentEvenWhenEveryFieldIsNull() {
        // Web parity: a present object renders the grid (all `—`), never the empty state — only a null prop is empty.
        assertEquals(UiPhase.Content, EnergyChargingPanelProjection.projectUiState(allNull).phase)
    }

    // ── Charger Voltage / Current (fmtNumber, '—' when null) ────────────────────────────────────────────

    @Test
    fun voltageAndCurrentFormatWithGlobalPrecisionElseEmDash() {
        assertEquals("238.00", EnergyChargingPanelProjection.voltageValue(snapshot, prefs))
        assertEquals("16.00", EnergyChargingPanelProjection.currentValue(snapshot, prefs))
        assertEquals(EM_DASH, EnergyChargingPanelProjection.voltageValue(allNull, prefs))
        assertEquals(EM_DASH, EnergyChargingPanelProjection.currentValue(allNull, prefs))
    }

    // ── Charger Power / Energy Added: VERBATIM no-/1000 kW / kWh (web source L52-L56, L63-L67) ───────────

    @Test
    fun powerLabelsRawWattsAsKwWithoutDividing() {
        // 11_000 W is rendered "11,000.00 kW" — NOT "11.00 kW". The web fmtWithUnit(charger_power_w,'kW') does no
        // /1000; this port reproduces that exactly. A divided value would be silent drift from the spec surface.
        assertEquals("11,000.00 kW", EnergyChargingPanelProjection.powerValue(snapshot, prefs, strings))
        assertEquals(EM_DASH, EnergyChargingPanelProjection.powerValue(allNull, prefs, strings))
    }

    @Test
    fun energyAddedLabelsRawWattHoursAsKwhWithoutDividing() {
        // 8_450 Wh is rendered "8,450.00 kWh" — NOT "8.45 kWh" (web fmtWithUnit(charge_energy_added_wh,'kWh')).
        assertEquals("8,450.00 kWh", EnergyChargingPanelProjection.energyAddedValue(snapshot, prefs, strings))
        assertEquals(EM_DASH, EnergyChargingPanelProjection.energyAddedValue(allNull, prefs, strings))
    }

    // ── Battery Level (fmtNumber + '%', '—' when null) ──────────────────────────────────────────────────

    @Test
    fun batteryLevelAppendsPercentElseEmDash() {
        assertEquals("72.00%", EnergyChargingPanelProjection.batteryValue(snapshot, prefs))
        assertEquals(EM_DASH, EnergyChargingPanelProjection.batteryValue(allNull, prefs))
    }

    // ── Charge Rate: formatSpeed(range_added_meters_per_hour / 3600), '—' when null ──────────────────────

    @Test
    fun chargeRateDelegatesToSharedSpeedFormatterAfterDividingByThirtySixHundred() {
        // The projection's responsibility is the metres-per-hour → metres-per-second /3600 conversion and the null
        // guard; the exact formatting is the golden-tested shared formatSpeed. Pin both by delegate-equality.
        val expected = formatSpeed(36_000.0 / 3600.0, prefs.units)
        assertEquals(expected, EnergyChargingPanelProjection.chargeRateValue(snapshot, prefs))
        // Differential: the /3600 must actually happen — the raw figure would format very differently.
        assertNotEquals(
            formatSpeed(36_000.0, prefs.units),
            EnergyChargingPanelProjection.chargeRateValue(snapshot, prefs),
        )
    }

    @Test
    fun chargeRateConvertsToTheUsersSpeedUnit() {
        // 36_000 m/h ÷ 3600 = 10 m/s → 36 km/h under the metric preference.
        val value = EnergyChargingPanelProjection.chargeRateValue(snapshot, prefs)
        assertTrue("expected a km/h label, got '$value'", value.contains("km/h"))
    }

    @Test
    fun chargeRateIsEmDashWhenNull() {
        assertEquals(EM_DASH, EnergyChargingPanelProjection.chargeRateValue(allNull, prefs))
    }

    // ── Charging-State chip classification + Unknown fallback ────────────────────────────────────────────

    @Test
    fun chargingStateKindMapsChargingCompleteAndOther() {
        assertEquals(ChargingStateKind.Charging, ChargingStateKind.fromRaw("Charging"))
        assertEquals(ChargingStateKind.Complete, ChargingStateKind.fromRaw("Complete"))
        assertEquals(ChargingStateKind.Other, ChargingStateKind.fromRaw("Stopped"))
        assertEquals(ChargingStateKind.Other, ChargingStateKind.fromRaw(null))
    }

    @Test
    fun chargingStateTextFallsBackToLocalizedUnknown() {
        assertEquals("Charging", EnergyChargingPanelProjection.chargingStateText(snapshot, strings))
        assertEquals(strings.unknown, EnergyChargingPanelProjection.chargingStateText(allNull, strings))
    }

    // ── content(): seven render-ready cells in web source order ─────────────────────────────────────────

    @Test
    fun contentBundlesEveryCellWithLocalizedLabelsAndFormattedValues() {
        val content = EnergyChargingPanelProjection.content(snapshot, prefs, strings)
        assertEquals(ChargingMetric.Voltage, content.voltage.metric)
        assertEquals("Voltage", content.voltage.label)
        assertEquals("238.00", content.voltage.value)
        assertEquals("V", content.voltage.unit)
        assertEquals("A", content.current.unit)
        assertEquals("11,000.00 kW", content.power.value)
        assertEquals("8,450.00 kWh", content.energyAdded.value)
        assertEquals("72.00%", content.batteryLevel.value)
        assertEquals("State", content.chargingState.label)
        assertEquals("Charging", content.chargingState.text)
        assertEquals(ChargingStateKind.Charging, content.chargingState.kind)
        assertEquals(ChargingMetric.ChargeRate, content.chargeRate.metric)
    }

    @Test
    fun contentRendersEmDashesForAnAllNullTelemetryObject() {
        val content = EnergyChargingPanelProjection.content(allNull, prefs, strings)
        assertEquals(EM_DASH, content.voltage.value)
        assertEquals(EM_DASH, content.current.value)
        assertEquals(EM_DASH, content.power.value)
        assertEquals(EM_DASH, content.energyAdded.value)
        assertEquals(EM_DASH, content.batteryLevel.value)
        assertEquals(EM_DASH, content.chargeRate.value)
        // The chip still resolves — to the Unknown label and the Other kind.
        assertEquals(strings.unknown, content.chargingState.text)
        assertEquals(ChargingStateKind.Other, content.chargingState.kind)
    }

    // ── Accessibility label join ────────────────────────────────────────────────────────────────────────

    @Test
    fun accessibilityLabelJoinsLabelAndValue() {
        assertEquals("Power: 11,000.00 kW", EnergyChargingPanelProjection.accessibilityLabel("Power", "11,000.00 kW"))
    }

    // ── Diagnostics (P1/S11 view.opened) ────────────────────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsSurfaceSlug() {
        val logger = RecordingLogger()
        recordEnergyChargingPanelOpened(logger)
        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "EnergyChargingPanel"), opened.single().second)
        assertEquals("EnergyChargingPanel", ENERGY_CHARGING_PANEL_SLUG)
    }

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
