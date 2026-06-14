// Instrumented Compose UI + accessibility verification of the VehiclePaintPicker surface across the states the
// web component renders (web/src/components/vehicles/VehiclePaintPicker.tsx): the auto-detected (un-overridden)
// state (inferred swatch announces "· Auto-detected", no reset affordance), the overridden state (the picked
// swatch is selected + the reset button appears), the per-swatch radio semantics + accessible labels, the
// pick → override → reset interaction loop (web setPaint / reset over useVehiclePaint), and the one-shot
// PII-safe `view.opened` diagnostic. Runs under `connectedAndroidTest` (a device/emulator); the offline
// gate's `testReleaseUnitTest` covers the pure model + the state holder. `assertIsSelected` /
// `assertIsNotSelected` / `assertDoesNotExist` are SemanticsNodeInteraction members, called without an import.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.vehiclepaintpicker

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class VehiclePaintPickerUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── State: auto-detected (no override) — inferred swatch tagged, no reset affordance ──────────────────────

    @Test
    fun autoDetectedStateShowsInferredPaintAndHidesReset() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                VehiclePaintPickerContent(
                    state = projectVehiclePaintPicker(overrideId = null, exteriorColor = "MidnightSilverMetallic"),
                    strings = strings(),
                )
            }
        }

        // The live active-paint label shows the inferred colour…
        compose.onNodeWithText("Midnight Silver Metallic").assertIsDisplayed()
        // …the inferred swatch announces the auto-detected suffix (web title)…
        compose.onNodeWithContentDescription("Midnight Silver Metallic · Auto-detected").assertIsDisplayed()
        // …and with no override, the reset affordance is absent.
        compose.onNodeWithText(DEFAULTS.reset).assertDoesNotExist()
    }

    // ── State: overridden — picked swatch selected + reset affordance present ──────────────────────────────────

    @Test
    fun overriddenStateSelectsOverrideAndShowsReset() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                VehiclePaintPickerContent(
                    state = projectVehiclePaintPicker(overrideId = PaintPaletteId.RedMulticoat, exteriorColor = "PearlWhite"),
                    strings = strings(),
                )
            }
        }

        compose.onNodeWithText("Red Multi-Coat").assertIsDisplayed()
        compose.onNodeWithTag(VEHICLE_PAINT_PICKER_RESET_TEST_TAG).assertIsDisplayed()
        // The override swatch is the selected radio; the inferred (Pearl) swatch is not.
        compose.onNodeWithTag(vehiclePaintSwatchTestTag(PaintPaletteId.RedMulticoat)).assertIsSelected()
        compose.onNodeWithTag(vehiclePaintSwatchTestTag(PaintPaletteId.PearlWhite)).assertIsNotSelected()
        // The inferred swatch still announces the auto-detected suffix even though it is not selected.
        compose.onNodeWithContentDescription("Pearl White Multi-Coat · Auto-detected").assertIsDisplayed()
    }

    // ── Accessibility: every swatch is a labelled radio target ─────────────────────────────────────────────────

    @Test
    fun everySwatchIsALabelledRadioTarget() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                VehiclePaintPickerContent(
                    state = projectVehiclePaintPicker(overrideId = null, exteriorColor = "PearlWhite"),
                    strings = strings(),
                )
            }
        }

        // All five swatches render with a non-blank accessible label (the inferred one gets the suffix).
        compose.onNodeWithContentDescription("Pearl White Multi-Coat · Auto-detected").assertIsDisplayed()
        compose.onNodeWithContentDescription("Midnight Silver Metallic").assertIsDisplayed()
        compose.onNodeWithContentDescription("Deep Blue Metallic").assertIsDisplayed()
        compose.onNodeWithContentDescription("Solid Black").assertIsDisplayed()
        compose.onNodeWithContentDescription("Red Multi-Coat").assertIsDisplayed()
        // The radiogroup carries its own accessible name (web radiogroup aria-label).
        compose.onNodeWithContentDescription(DEFAULTS.pickerLabel).assertIsDisplayed()
    }

    // ── Interaction: pick → override → reset (web setPaint / reset over the real store) ────────────────────────

    @Test
    fun pickingASwatchOverridesAndResetRevertsToAutoDetected() {
        val store = ProcessVehiclePaintStore()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                VehiclePaintPicker(
                    vehicleId = 1L,
                    exteriorColor = "PearlWhite",
                    source = store,
                    logger = RecordingLogger(),
                )
            }
        }

        // Initially auto-detected (Pearl): no reset affordance.
        compose.onNodeWithText(DEFAULTS.reset).assertDoesNotExist()

        // Pick Deep Blue → it becomes the override and the reset affordance appears.
        compose.onNodeWithTag(vehiclePaintSwatchTestTag(PaintPaletteId.DeepBlue)).performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Deep Blue Metallic").assertIsDisplayed()
        compose.onNodeWithTag(vehiclePaintSwatchTestTag(PaintPaletteId.DeepBlue)).assertIsSelected()
        compose.onNodeWithTag(VEHICLE_PAINT_PICKER_RESET_TEST_TAG).assertIsDisplayed()

        // Reset → reverts to the auto-detected Pearl White and the reset affordance disappears.
        compose.onNodeWithTag(VEHICLE_PAINT_PICKER_RESET_TEST_TAG).performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Pearl White Multi-Coat").assertIsDisplayed()
        compose.onNodeWithText(DEFAULTS.reset).assertDoesNotExist()
    }

    // ── Diagnostics: one-shot PII-safe view.opened (P1/S11) fires once on mount ───────────────────────────────

    @Test
    fun mountingEmitsThePiiSafeViewOpenedDiagnosticOnce() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                VehiclePaintPicker(
                    vehicleId = 1L,
                    exteriorColor = "PearlWhite",
                    source = ProcessVehiclePaintStore(),
                    logger = logger,
                )
            }
        }
        compose.waitForIdle()

        val opened = logger.records.filter { it.event == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.first().level)
        assertEquals(mapOf("surface" to "VehiclePaintPicker"), opened.first().fields)
    }

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

    private companion object {
        val DEFAULTS =
            VehiclePaintPickerStrings(
                pickerLabel = VehiclePaintPickerDefaults.PICKER_LABEL,
                label = VehiclePaintPickerDefaults.LABEL,
                detected = VehiclePaintPickerDefaults.DETECTED,
                reset = VehiclePaintPickerDefaults.RESET,
                paintNames = PAINT_PALETTE_LIST.associate { it.id to it.defaultLabel },
            )

        fun strings(): VehiclePaintPickerStrings = DEFAULTS
    }
}
