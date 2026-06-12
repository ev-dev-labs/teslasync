package io.teslasync.android.featureviews.signalselector

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [SignalSelectorContent] across the branches the
 * web component renders (web/src/features/telemetry/components/SignalSelector.tsx): the capped label with
 * the layer-help affordance, the at-cap "maximum reached" hint, the uncapped label with the help affordance
 * suppressed, the friendly "no results" note when the catalog resolves empty, and the verbatim label
 * override. Every asserted string is resolved from the app's i18n resources so the test follows the device
 * locale rather than hard-coding English, the help trigger is targeted by its TalkBack content description
 * (the a11y label test), and the multi-select carries the label as its accessible name. Runs under
 * `connectedAndroidTest`; the offline `testReleaseUnitTest` gate covers the pure projection and the
 * cap/toggle adapter exhaustively.
 */
class SignalSelectorUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    private fun string(id: Int) = context.getString(id)

    private val signalsWord get() = string(R.string.translation_Signals)
    private val helpAria get() = string(R.string.translation_help_tooltip_iconLabel)
    private val maxReached get() = string(R.string.translation_combobox_maxReached)
    private val noResults get() = string(R.string.translation_combobox_noResults)

    private fun setContent(
        options: List<String>,
        value: List<String>,
        max: Int?,
        showLayerHelp: Boolean,
        labelOverride: String? = null,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(modifier = Modifier.width(HOST_WIDTH)) {
                    SignalSelectorContent(
                        display =
                            SignalSelectorProjection.project(
                                label = SignalSelectorProjection.resolveLabel(signalsWord, value.size, max, labelOverride),
                                options = options,
                                value = value,
                                max = max,
                                showLayerHelp = showLayerHelp,
                            ),
                        onToggle = {},
                    )
                }
            }
        }
    }

    @Test
    fun cappedSelectionShowsLabelHelpAndAccessibleName() {
        setContent(options = SAMPLE, value = listOf("VehicleSpeed", "BatteryLevel"), max = 5, showLayerHelp = true)

        val label = "$signalsWord (2 / 5)"
        compose.onNodeWithText(label).assertIsDisplayed()
        // a11y: the help trigger carries a TalkBack content description, the multi-select carries its name.
        compose.onNodeWithContentDescription(helpAria).assertIsDisplayed()
        compose.onNodeWithContentDescription(label).assertExists()
        compose.onNodeWithText(maxReached).assertDoesNotExist()
    }

    @Test
    fun atCapShowsTheMaximumReachedHint() {
        setContent(options = SAMPLE, value = SAMPLE.take(5), max = 5, showLayerHelp = true)

        compose.onNodeWithText("$signalsWord (5 / 5)").assertIsDisplayed()
        compose.onNodeWithText(maxReached).assertIsDisplayed()
    }

    @Test
    fun uncappedHidesTheMaxSegmentAndTheHelpTriggerCanBeSuppressed() {
        setContent(options = SAMPLE, value = listOf("VehicleSpeed"), max = null, showLayerHelp = false)

        compose.onNodeWithText("$signalsWord (1)").assertIsDisplayed()
        compose.onNodeWithContentDescription(helpAria).assertDoesNotExist()
        compose.onNodeWithText(maxReached).assertDoesNotExist()
    }

    @Test
    fun emptyCatalogShowsTheFriendlyNoResultsNote() {
        setContent(options = emptyList(), value = emptyList(), max = 5, showLayerHelp = true)

        compose.onNodeWithText("$signalsWord (0 / 5)").assertIsDisplayed()
        compose.onNodeWithText(noResults).assertIsDisplayed()
    }

    @Test
    fun labelOverrideRendersVerbatim() {
        setContent(
            options = SAMPLE,
            value = listOf("PackVoltage"),
            max = 5,
            showLayerHelp = true,
            labelOverride = OVERRIDE,
        )

        compose.onNodeWithText(OVERRIDE).assertIsDisplayed()
    }

    private companion object {
        val SAMPLE =
            listOf("VehicleSpeed", "BatteryLevel", "ChargeState", "OutsideTemp", "TpmsPressureFl", "PackVoltage")
        const val OVERRIDE = "Compare signals"
        val HOST_WIDTH = 420.dp
    }
}
