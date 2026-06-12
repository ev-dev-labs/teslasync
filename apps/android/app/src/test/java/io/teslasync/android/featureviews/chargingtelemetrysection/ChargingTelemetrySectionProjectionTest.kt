package io.teslasync.android.featureviews.chargingtelemetrysection

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the Charging Telemetry section's pure logic — the native analogue of the web
 * component's inline derivations
 * (web/src/features/vehicles/components/vehicle-detail/ChargingTelemetrySection.tsx): the null-tolerant
 * `/charging-telemetry/latest` decode, the eight per-metric value strings (the
 * `field != null ? `${fmtNumber(field)} unit` : '—'` formatting, `charging_state ?? '—'`, the verbatim kW/kWh
 * suffix quirk, and the `useUnits` charge-rate `/3600` + range-added conversions), the `chargingTelemetry ?`
 * content/empty boundary, the `numberFormat` helper, the `t(key, default)` resolve-or-fallback, and the
 * PII-safe `view.opened` diagnostic. Runs in the :app:testReleaseUnitTest gate.
 */
class ChargingTelemetrySectionProjectionTest {
    // Stub formatters tag each value so the test pins which formatter each tile cell uses (and the /3600 math).
    private fun stubFormatters(): ChargingTelemetryFormatters =
        ChargingTelemetryFormatters(
            number = { "N($it)" },
            distance = { "D($it)" },
            speed = { "S($it)" },
        )

    private fun fullSnapshot(): ChargingTelemetrySnapshot =
        ChargingTelemetrySnapshot(
            chargerPowerW = 11000.0,
            chargerVoltage = 240.0,
            chargerActualCurrent = 48.0,
            chargeEnergyAddedWh = 18500.0,
            chargingState = "Charging",
            batteryLevel = 72.0,
            rangeAddedMetersPerHour = 7200.0,
            rangeAddedMeters = 120000.0,
        )

    // ── fromJson decode (web optional snake_case reads) ────────────────────────────

    @Test
    fun fromJsonDecodesEverySnakeCaseField() {
        val body =
            buildJsonObject {
                put("charger_power_w", 11000.0)
                put("charger_voltage", 240.0)
                put("charger_actual_current", 48.0)
                put("charge_energy_added_wh", 18500.0)
                put("charging_state", "Charging")
                put("battery_level", 72.0)
                put("range_added_meters_per_hour", 7200.0)
                put("range_added_meters", 120000.0)
            }
        assertEquals(fullSnapshot(), ChargingTelemetrySnapshot.fromJson(body))
    }

    @Test
    fun fromJsonReturnsNullForMissingOrNonObjectBody() {
        assertNull(ChargingTelemetrySnapshot.fromJson(null))
        assertNull(ChargingTelemetrySnapshot.fromJson(JsonNull))
        assertNull(ChargingTelemetrySnapshot.fromJson(JsonPrimitive("nope")))
    }

    @Test
    fun fromJsonToleratesMissingFieldsAndJsonNullAsNull() {
        val partial =
            buildJsonObject {
                put("charger_power_w", 11000.0)
                put("charging_state", JsonNull)
            }
        val snapshot = ChargingTelemetrySnapshot.fromJson(partial)
        assertEquals(11000.0, snapshot?.chargerPowerW)
        // A JSON null state and every absent field decode to null (web optional reads).
        assertNull(snapshot?.chargingState)
        assertNull(snapshot?.chargerVoltage)
        assertNull(snapshot?.rangeAddedMeters)
    }

    @Test
    fun fromJsonReadsNumericStringsLikeTheWebCoercion() {
        val body =
            buildJsonObject {
                put("battery_level", "72")
                put("charger_voltage", "240.5")
            }
        val snapshot = ChargingTelemetrySnapshot.fromJson(body)
        assertEquals(72.0, snapshot?.batteryLevel)
        assertEquals(240.5, snapshot?.chargerVoltage)
    }

    // ── projectUiState (web chargingTelemetry ? boundary + lifecycle) ──────────────

    @Test
    fun projectUiStateIsLoadingWhenLoading() {
        val state = ChargingTelemetrySectionProjection.projectUiState(fullSnapshot(), isLoading = true)
        assertEquals(UiPhase.Loading, state.phase)
        assertNull(state.data)
    }

    @Test
    fun projectUiStateIsContentWhenSnapshotPresent() {
        val snapshot = fullSnapshot()
        val state = ChargingTelemetrySectionProjection.projectUiState(snapshot, isLoading = false)
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(snapshot, state.data)
    }

    @Test
    fun projectUiStateIsEmptyWhenNoSnapshot() {
        val state = ChargingTelemetrySectionProjection.projectUiState(snapshot = null, isLoading = false)
        assertEquals(UiPhase.Empty, state.phase)
        assertNull(state.data)
    }

    // ── tiles: per-metric value formatting (web MetricCard value derivations) ──────

    @Test
    fun tilesFormatEveryMetricInWebGridOrder() {
        val tiles = ChargingTelemetrySectionProjection.tiles(fullSnapshot(), stubFormatters())

        assertEquals(
            listOf(
                ChargingTelemetryMetric.ChargerPower,
                ChargingTelemetryMetric.Voltage,
                ChargingTelemetryMetric.Current,
                ChargingTelemetryMetric.EnergyAdded,
                ChargingTelemetryMetric.ChargingState,
                ChargingTelemetryMetric.BatteryLevel,
                ChargingTelemetryMetric.ChargeRate,
                ChargingTelemetryMetric.RangeAdded,
            ),
            tiles.map { it.metric },
        )
        // Power: SI watts shown with the literal "kW" suffix (web quirk reproduced verbatim).
        assertEquals("N(11000.0) kW", tiles[0].value)
        assertEquals("N(240.0) V", tiles[1].value)
        assertEquals("N(48.0) A", tiles[2].value)
        // Energy: SI watt-hours shown with the literal "kWh" suffix (web quirk reproduced verbatim).
        assertEquals("N(18500.0) kWh", tiles[3].value)
        // Charging State: the textual state shown verbatim (web `charging_state ?? '—'`).
        assertEquals("Charging", tiles[4].value)
        // Battery Level: the value with a directly-appended "%" (no space, web `${fmtNumber(v)}%`).
        assertEquals("N(72.0)%", tiles[5].value)
        // Charge Rate: meters/hour → meters/second (÷3600) before the speed formatter (7200/3600 = 2.0).
        assertEquals("S(2.0)", tiles[6].value)
        // Range Added: the SI meters through the distance formatter.
        assertEquals("D(120000.0)", tiles[7].value)
    }

    @Test
    fun tilesFallBackToEmDashForEveryNullField() {
        val empty =
            ChargingTelemetrySnapshot(
                chargerPowerW = null,
                chargerVoltage = null,
                chargerActualCurrent = null,
                chargeEnergyAddedWh = null,
                chargingState = null,
                batteryLevel = null,
                rangeAddedMetersPerHour = null,
                rangeAddedMeters = null,
            )
        val tiles = ChargingTelemetrySectionProjection.tiles(empty, stubFormatters())
        // All eight tiles still render (the web always renders the full grid) and read the em-dash fallback.
        assertEquals(TILE_COUNT_EXPECTED, tiles.size)
        assertTrue(tiles.all { it.value == "\u2014" })
    }

    @Test
    fun tilesShowChargingStateVerbatimIncludingBlank() {
        // web `charging_state ?? '—'` only replaces null — a present (even blank) value passes through.
        val blankState = fullSnapshot().copy(chargingState = "")
        val tiles = ChargingTelemetrySectionProjection.tiles(blankState, stubFormatters())
        assertEquals("", tiles[4].value)
    }

    // ── numberFormat helper (web fmtNumber parity) ─────────────────────────────────

    @Test
    fun numberGroupsThousandsAtRequestedPrecision() {
        assertEquals("11,000.00", ChargingTelemetryFormat.number(11000.0, 2, Locale.US))
        assertEquals("240.5", ChargingTelemetryFormat.number(240.5, 1, Locale.US))
        assertEquals("72", ChargingTelemetryFormat.number(72.0, 0, Locale.US))
    }

    @Test
    fun numberCoercesNonFiniteToZeroLikeSafeNumber() {
        assertEquals("0.00", ChargingTelemetryFormat.number(Double.NaN, 2, Locale.US))
        assertEquals("0.00", ChargingTelemetryFormat.number(Double.POSITIVE_INFINITY, 2, Locale.US))
    }

    // ── i18n resolve-or-fallback (web t(key, default) parity) ──────────────────────

    @Test
    fun resolveOptionalReturnsCatalogValueWhenPresent() {
        val resolved =
            resolveOptional(
                { mapOf(KEY_RANGE_ADDED to "Catalog range")[it] },
                KEY_RANGE_ADDED,
                ChargingTelemetrySectionDefaults.RANGE_ADDED,
            )
        assertEquals("Catalog range", resolved)
    }

    @Test
    fun resolveOptionalFallsBackWhenKeyAbsentOrBlank() {
        assertEquals(
            ChargingTelemetrySectionDefaults.RANGE_ADDED,
            resolveOptional({ null }, KEY_RANGE_ADDED, ChargingTelemetrySectionDefaults.RANGE_ADDED),
        )
        assertEquals(
            ChargingTelemetrySectionDefaults.RANGE_ADDED,
            resolveOptional({ "   " }, KEY_RANGE_ADDED, ChargingTelemetrySectionDefaults.RANGE_ADDED),
        )
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordChargingTelemetrySectionOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "ChargingTelemetrySection"), fields)
        assertFalse(fields.containsKey("vehicle_id"))
    }

    private companion object {
        const val TILE_COUNT_EXPECTED: Int = 8
    }

    private class RecordingLogger : Logger {
        val records = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += event to fields
        }
    }
}
