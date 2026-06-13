package io.teslasync.android.featureviews.vehicleconfigsection

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the VehicleConfigSection's pure logic — the native mirror of every derivation the
 * web component performs (web/src/features/vehicles/components/vehicle-detail/VehicleConfigSection.tsx): the
 * twelve-row `configItems` projection (each string field `?? '—'`, each boolean field
 * `!= null ? (v ? Yes : No) : '—'`, and the Software fallback `software_update_version ?? softwareVersion ?? '—'`),
 * the lifecycle projection onto the shared [UiState], and the PII-safe `view.opened` diagnostic. Because the
 * surface is purely presentational, each projected row is exactly what the thin composable renders, so these
 * assertions double as the per-row "snapshot". Runs in the :android:testReleaseUnitTest gate.
 */
class VehicleConfigSectionProjectionTest {
    private val strings =
        VehicleConfigSectionStrings(
            title = "Vehicle Configuration",
            carType = "Car Type",
            trim = "Trim",
            exteriorColor = "Exterior Color",
            wheels = "Wheels",
            roofColor = "Roof Color",
            chargePort = "Charge Port",
            rightHandDrive = "Right-Hand Drive",
            europeVehicle = "Europe Vehicle",
            offroadLightbar = "Offroad Lightbar",
            rearSeatHeaters = "Rear Seat Heaters",
            sunroof = "Sunroof",
            software = "Software",
            yes = "Yes",
            no = "No",
            noData = "No data available",
        )

    private val fullConfig =
        VehicleConfigData(
            carType = "Model S",
            trim = "P100D",
            exteriorColor = "Midnight Silver",
            wheelType = "Arachnid",
            roofColor = "Glass",
            chargePort = "US",
            rightHandDrive = true,
            europeVehicle = false,
            offroadLightbarPresent = true,
            rearSeatHeaters = "1",
            sunroofInstalled = "None",
            softwareUpdateVersion = "2026.8.1",
        )

    // ── Row projection (web configItems parity) ───────────────────────────────────

    @Test
    fun rowsBuildsTwelveLabelledRowsInWebOrder() {
        val rows = VehicleConfigSectionProjection.rows(fullConfig, softwareVersion = null, strings = strings)

        assertEquals(
            listOf(
                "Car Type",
                "Trim",
                "Exterior Color",
                "Wheels",
                "Roof Color",
                "Charge Port",
                "Right-Hand Drive",
                "Europe Vehicle",
                "Offroad Lightbar",
                "Rear Seat Heaters",
                "Sunroof",
                "Software",
            ),
            rows.map { it.label },
        )
    }

    @Test
    fun rowsRenderEveryStringAndBooleanValueOfAFullConfig() {
        val rows = VehicleConfigSectionProjection.rows(fullConfig, softwareVersion = null, strings = strings)
        val values = rows.associate { it.label to it.value }

        assertEquals("Model S", values["Car Type"])
        assertEquals("P100D", values["Trim"])
        assertEquals("Midnight Silver", values["Exterior Color"])
        assertEquals("Arachnid", values["Wheels"])
        assertEquals("Glass", values["Roof Color"])
        assertEquals("US", values["Charge Port"])
        // Booleans → localized Yes/No (web `v ? Yes : No`).
        assertEquals("Yes", values["Right-Hand Drive"])
        assertEquals("No", values["Europe Vehicle"])
        assertEquals("Yes", values["Offroad Lightbar"])
        assertEquals("1", values["Rear Seat Heaters"])
        assertEquals("None", values["Sunroof"])
        assertEquals("2026.8.1", values["Software"])
    }

    @Test
    fun rowsUseEmDashForEveryMissingStringField() {
        val rows = VehicleConfigSectionProjection.rows(VehicleConfigData(), softwareVersion = null, strings = strings)
        val values = rows.associate { it.label to it.value }

        // Every string field absent ⇒ the web `?? '—'` fallback.
        assertEquals("\u2014", values["Car Type"])
        assertEquals("\u2014", values["Trim"])
        assertEquals("\u2014", values["Exterior Color"])
        assertEquals("\u2014", values["Wheels"])
        assertEquals("\u2014", values["Roof Color"])
        assertEquals("\u2014", values["Charge Port"])
        assertEquals("\u2014", values["Rear Seat Heaters"])
        assertEquals("\u2014", values["Sunroof"])
    }

    @Test
    fun rowsUseEmDashForNullBooleanFields() {
        // web `right_hand_drive != null ? (...) : '—'` — a null boolean reads the em-dash, not "No".
        val rows = VehicleConfigSectionProjection.rows(VehicleConfigData(), softwareVersion = null, strings = strings)
        val values = rows.associate { it.label to it.value }

        assertEquals("\u2014", values["Right-Hand Drive"])
        assertEquals("\u2014", values["Europe Vehicle"])
        assertEquals("\u2014", values["Offroad Lightbar"])
    }

    @Test
    fun booleanFalseRendersNoNotEmDash() {
        // A present `false` is distinct from an absent value: it renders "No", never the em-dash.
        val config = VehicleConfigData(rightHandDrive = false, europeVehicle = false, offroadLightbarPresent = false)
        val rows = VehicleConfigSectionProjection.rows(config, softwareVersion = null, strings = strings)
        val values = rows.associate { it.label to it.value }

        assertEquals("No", values["Right-Hand Drive"])
        assertEquals("No", values["Europe Vehicle"])
        assertEquals("No", values["Offroad Lightbar"])
    }

    // ── Software fallback chain (web software_update_version ?? softwareVersion ?? '—') ──

    @Test
    fun softwareRowPrefersConfigVersion() {
        val config = fullConfig.copy(softwareUpdateVersion = "2026.8.1")
        val software = softwareValue(config, softwareVersion = "2026.2.0")
        assertEquals("2026.8.1", software)
    }

    @Test
    fun softwareRowFallsBackToSoftwareVersionPropWhenConfigVersionAbsent() {
        val config = fullConfig.copy(softwareUpdateVersion = null)
        val software = softwareValue(config, softwareVersion = "2026.2.0")
        assertEquals("2026.2.0", software)
    }

    @Test
    fun softwareRowFallsBackToEmDashWhenBothAbsent() {
        val config = fullConfig.copy(softwareUpdateVersion = null)
        val software = softwareValue(config, softwareVersion = null)
        assertEquals("\u2014", software)
    }

    // ── boolLabel ─────────────────────────────────────────────────────────────────

    @Test
    fun boolLabelMapsTrueFalseNull() {
        assertEquals("Yes", VehicleConfigSectionProjection.boolLabel(true, strings))
        assertEquals("No", VehicleConfigSectionProjection.boolLabel(false, strings))
        assertEquals("\u2014", VehicleConfigSectionProjection.boolLabel(null, strings))
    }

    // ── Lifecycle projection (P1/S8 UiState) ───────────────────────────────────────

    @Test
    fun projectUiStateLoadingTakesPrecedence() {
        val state = VehicleConfigSectionProjection.projectUiState(config = fullConfig, isLoading = true)
        assertTrue(state.isLoading)
        assertNull(state.data)
    }

    @Test
    fun projectUiStatePresentConfigIsContent() {
        val state = VehicleConfigSectionProjection.projectUiState(config = fullConfig, isLoading = false)
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(fullConfig, state.data)
    }

    @Test
    fun projectUiStateNullConfigIsEmptyNotABlankBox() {
        val state = VehicleConfigSectionProjection.projectUiState(config = null, isLoading = false)
        assertEquals(UiPhase.Empty, state.phase)
        assertNull(state.data)
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        VehicleConfigSectionDiagnostics.recordViewOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "VehicleConfigSection"), fields)
    }

    /** The Software row value the projection produces — pulled out so the fallback chain is asserted directly. */
    private fun softwareValue(
        config: VehicleConfigData,
        softwareVersion: String?,
    ): String =
        VehicleConfigSectionProjection
            .rows(config, softwareVersion, strings)
            .single { it.label == strings.software }
            .value

    private data class Record(
        val level: LogLevel,
        val event: String,
        val fields: Map<String, String>,
    )

    private class RecordingLogger : Logger {
        val records = mutableListOf<Record>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Record(level, event, fields)
        }
    }
}
