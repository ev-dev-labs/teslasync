// Off-device unit coverage for the ClimatePanel feature view's pure model (P3 acceptance: adapter +
// per-state + a11y-label tests). Exercises the snapshot -> display projection (the typed-field reads + web
// `typeof` guards, the SI -> display temperature conversion through the shared UnitFormatter / `useUnits`,
// the `hvac_state ?? '—'` and `fan_status ?? 0` fallbacks, the six-segment fan-meter fill logic, and the
// three-chip Defrost/Climate/Precondition active + label logic), the empty-snapshot classifier the
// composable + view-model switch on (per-state coverage), the chip/label routing through the supplied i18n
// strings (a11y label coverage), and the PII-safe `view.opened` diagnostic. No Compose / Android / HTTP —
// runs in :app:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.climatepanel

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ClimatePanelModelTest {
    private val metric = UnitFormatter.default()
    private val imperial = UnitFormatter(UnitPreferences.fromSettings(Json.parseToJsonElement("""{"unit_of_temp":"F"}""")))

    private val strings =
        ClimatePanelStrings(
            title = "Climate",
            cabin = "Cabin",
            outside = "Outside",
            driverSetpoint = "Driver Setpoint",
            passengerSetpoint = "Passenger Setpoint",
            hvacState = "HVAC State",
            fanSpeed = "Fan Speed",
            defrost = "Defrost",
            climate = "Climate",
            precondition = "Precondition",
            on = "On",
            off = "Off",
            noData = "No climate data available",
        )

    // A fully-populated snapshot: 21.5/12.0 °C cabin/outside, 21.0/22.0 °C setpoints, HVAC "On",
    // Front defrost, climate + preconditioning on, fan level 4.
    private val full =
        buildJsonObject {
            put("inside_temp_c", 21.5)
            put("outside_temp_c", 12.0)
            put("driver_setpoint_c", 21.0)
            put("passenger_setpoint_c", 22.0)
            put("hvac_state", "On")
            put("defrost_mode", "Front")
            put("is_climate_on", true)
            put("is_preconditioning", true)
            put("fan_status", 4)
        }

    private fun project(
        snapshot: JsonElement?,
        formatter: UnitFormatter = metric,
    ) = ClimatePanelProjection.project(snapshot, formatter, strings)

    private fun chip(
        display: ClimatePanelDisplay,
        kind: ClimateChip,
    ): ClimateChipState = display.chips.first { it.chip == kind }

    // ── Projection: metric temperatures + readings (web formatTemperature / `?? '—'` / `?? 0`) ───

    @Test
    fun projectsTypedReadingsForMetricUnits() {
        val display = project(full)
        assertTrue(display.hasData)
        assertEquals("21.5\u00B0C", display.cabinTempText)
        assertEquals("12.0\u00B0C", display.outsideTempText)
        assertEquals("21.0\u00B0C", display.driverSetpointText)
        assertEquals("22.0\u00B0C", display.passengerSetpointText)
        assertEquals("On", display.hvacStateText)
        assertEquals(4, display.fanLevel)
        assertEquals("4", display.fanStatusText)
    }

    @Test
    fun temperaturesConvertThroughTheImperialBoundary() {
        // 21.5 °C -> 70.7 °F; 21.0 °C -> 69.8 °F (web useUnits Fahrenheit preference).
        val display = project(full, imperial)
        assertEquals("70.7\u00B0F", display.cabinTempText)
        assertEquals("69.8\u00B0F", display.driverSetpointText)
    }

    @Test
    fun missingReadingsFallBackToEmDashAndZeroFan() {
        // An object present but with only a present `is_climate_on:false`; everything else absent.
        val sparse = buildJsonObject { put("is_climate_on", false) }
        val display = project(sparse)
        assertTrue(display.hasData)
        assertEquals(EM_DASH, display.cabinTempText)
        assertEquals(EM_DASH, display.outsideTempText)
        assertEquals(EM_DASH, display.driverSetpointText)
        assertEquals(EM_DASH, display.passengerSetpointText)
        assertEquals(EM_DASH, display.hvacStateText)
        assertEquals(0, display.fanLevel)
        assertEquals("0", display.fanStatusText)
    }

    @Test
    fun nonNumberTemperatureAndFanFieldsAreRejectedLikeTheWebTypeofGuard() {
        // A quoted-string temperature / fan reads as missing (web `typeof === 'number'`).
        val typed =
            buildJsonObject {
                put("inside_temp_c", "21.5")
                put("fan_status", "3")
            }
        val display = project(typed)
        assertEquals(EM_DASH, display.cabinTempText)
        assertEquals(0, display.fanLevel)
    }

    // ── Fan meter (web `(fan_status ?? 0) >= level`) ─────────────────────────────

    @Test
    fun fanMeterFillsSegmentsUpToTheLevel() {
        val display = project(full)
        assertTrue(display.fanBarFilled(1))
        assertTrue(display.fanBarFilled(4))
        assertFalse(display.fanBarFilled(5))
        assertFalse(display.fanBarFilled(FAN_SPEED_BARS))
    }

    @Test
    fun fanLevelAboveTheMeterFillsEverySegment() {
        val display = project(buildJsonObject { put("fan_status", 8) })
        assertEquals("8", display.fanStatusText)
        assertTrue(display.fanBarFilled(1))
        assertTrue(display.fanBarFilled(FAN_SPEED_BARS))
    }

    // ── Status chips: order, active flags, labels (web blue/green/amber chips) ────

    @Test
    fun chipsAreInWebSourceOrder() {
        assertEquals(
            listOf(ClimateChip.Defrost, ClimateChip.Climate, ClimateChip.Precondition),
            project(full).chips.map { it.chip },
        )
    }

    @Test
    fun activeChipsCarryTheModeOrOnLabel() {
        val display = project(full)
        val defrost = chip(display, ClimateChip.Defrost)
        assertTrue(defrost.active)
        assertEquals("Defrost Front", defrost.label)

        val climate = chip(display, ClimateChip.Climate)
        assertTrue(climate.active)
        assertEquals("Climate On", climate.label)

        val precondition = chip(display, ClimateChip.Precondition)
        assertTrue(precondition.active)
        assertEquals("Precondition On", precondition.label)
    }

    @Test
    fun inactiveChipsCarryTheOffLabel() {
        val display = project(buildJsonObject { put("defrost_mode", "Off") })
        val defrost = chip(display, ClimateChip.Defrost)
        assertFalse(defrost.active)
        assertEquals("Defrost Off", defrost.label)
        assertFalse(chip(display, ClimateChip.Climate).active)
        assertEquals("Climate Off", chip(display, ClimateChip.Climate).label)
        assertFalse(chip(display, ClimateChip.Precondition).active)
        assertEquals("Precondition Off", chip(display, ClimateChip.Precondition).label)
    }

    @Test
    fun defrostIsActiveOnlyForAPresentNonOffMode() {
        assertTrue(ClimatePanelProjection.isDefrostActive("Front"))
        assertTrue(ClimatePanelProjection.isDefrostActive("Rear"))
        assertFalse(ClimatePanelProjection.isDefrostActive("Off"))
        assertFalse(ClimatePanelProjection.isDefrostActive(""))
        assertFalse(ClimatePanelProjection.isDefrostActive(null))
    }

    // ── Empty-snapshot classifier (web `climateData ? … : <EmptyState/>`) ─────────

    @Test
    fun emptySnapshotIsDetectedForNonObjects() {
        assertTrue(ClimatePanelProjection.isEmptySnapshot(null))
        assertTrue(ClimatePanelProjection.isEmptySnapshot(JsonNull))
        assertTrue(ClimatePanelProjection.isEmptySnapshot(JsonPrimitive("x")))
        assertFalse(ClimatePanelProjection.isEmptySnapshot(full))
    }

    @Test
    fun emptySnapshotProjectsToNoDataWithNoChips() {
        val display = project(JsonNull)
        assertFalse(display.hasData)
        assertTrue(display.chips.isEmpty())
        assertEquals(EM_DASH, display.cabinTempText)
        assertEquals(0, display.fanLevel)
    }

    // ── Lifecycle surface states (per-state coverage) ────────────────────────────

    @Test
    fun perStateUiSurfacesClassifyCorrectly() {
        assertTrue(UiState.loading<JsonElement>().isLoading)

        val content = UiState(phase = UiPhase.Content, data = full, fetchedAt = 1L)
        assertTrue(content.isContent)
        assertTrue(project(content.data).hasData)

        val empty = UiState(phase = UiPhase.Empty, data = JsonNull, fetchedAt = 1L)
        assertTrue(empty.isEmpty)
        assertFalse(project(empty.data).hasData)

        val error = UiState<JsonElement>(phase = UiPhase.Error, errorKind = ErrorKind.Network)
        assertTrue(error.isError)
        assertFalse(error.hasData)
    }

    @Test
    fun offlineCachedStateStaysContentAndStillRendersTheBody() {
        val offline =
            UiState(
                phase = UiPhase.Content,
                data = full,
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            )
        assertFalse(offline.isLoading)
        assertFalse(offline.isError)
        assertFalse(offline.isEmpty)
        assertTrue(offline.isOffline)
        assertTrue(offline.canRetry)
        // Cached data still renders the full climate body while stale.
        assertTrue(project(offline.data!!).hasData)
    }

    // ── i18n / a11y labels (web `t('telemetry.*' / 'common.*')`) ─────────────────

    @Test
    fun chipLabelsRouteThroughTheSuppliedI18nStrings() {
        val localized =
            strings.copy(defrost = "Dégivrage", climate = "Climatisation", precondition = "Préconditionnement", on = "Activé")
        val display = ClimatePanelProjection.project(full, metric, localized)
        assertEquals("Dégivrage Front", chip(display, ClimateChip.Defrost).label)
        assertEquals("Climatisation Activé", chip(display, ClimateChip.Climate).label)
        assertEquals("Préconditionnement Activé", chip(display, ClimateChip.Precondition).label)
    }

    // ── Diagnostics (P1/S11 `view.opened`) ───────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeEventWithSurfaceSlug() {
        val logger = RecordingLogger()
        recordClimatePanelOpened(logger)
        assertEquals(1, logger.records.size)
        val record = logger.records.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals("view.opened", record.event)
        assertEquals(mapOf("surface" to "ClimatePanel"), record.fields)
        assertEquals("ClimatePanel", CLIMATE_PANEL_SLUG)
    }

    /** A recording [Logger] capturing emitted records for the diagnostics assertion. */
    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }
}
