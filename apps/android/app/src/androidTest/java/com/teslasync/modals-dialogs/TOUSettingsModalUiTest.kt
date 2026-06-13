// Instrumented Compose UI + accessibility verification of [TOUSettingsModalContent] across the branches the web
// component renders: the idle Preset form (every labelled control present — the a11y label test), the chosen-preset
// JSON preview (web `selectedPreset && <pre>`), the no-preset validation guard (web `errorNoPreset`), the Custom tab's
// invalid-JSON guard (web `errorInvalidJSON`) and its valid hand-off (the wrapped `tou_settings` envelope), the
// in-flight state (web `updateMutation.isPending` — both actions disable and the submit spins), the verbatim server
// error slot (web `setError(String(err))`), and the Cancel affordance. Runs under `connectedAndroidTest` (a
// device/emulator); the offline gate's `testReleaseUnitTest` covers the pure model + the ViewModel orchestration.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.tousettingsmodal

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaSyncTheme
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class TOUSettingsModalUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        TOUSettingsModalStrings(
            title = "Update Rate Plan",
            close = "Close",
            tabPreset = "Preset Tariff",
            tabCustom = "Custom JSON",
            selectPlan = "Rate Plan",
            selectEmptyLabel = "Choose a rate plan…",
            previewLabel = "Preview",
            customLabel = "TOU Settings JSON",
            errorNoPreset = "Please select a rate plan",
            errorEmptyJson = "Please enter the TOU settings JSON",
            errorNotObject = "JSON must be an object",
            errorInvalidJson = "Invalid JSON — please check syntax",
            submit = "Update Rate Plan",
            cancel = "Cancel",
        )

    private fun setContent(
        submitting: Boolean = false,
        submitError: String? = null,
        initialTab: TOUTab = TOUTab.Preset,
        initialPresetId: String = "",
        initialCustomJson: String = "",
        onSubmit: (JsonObject) -> Unit = {},
        onCancel: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    TOUSettingsModalContent(
                        strings = strings,
                        submitting = submitting,
                        submitError = submitError,
                        onSubmit = onSubmit,
                        onCancel = onCancel,
                        initialTab = initialTab,
                        initialPresetId = initialPresetId,
                        initialCustomJson = initialCustomJson,
                    )
                }
            }
        }
    }

    @Test
    fun everyTabFieldAndActionExposesItsLabel() {
        setContent()
        compose.onNodeWithText(strings.tabPreset).assertIsDisplayed()
        compose.onNodeWithText(strings.tabCustom).assertIsDisplayed()
        compose.onNodeWithText(strings.selectPlan, substring = true).assertIsDisplayed()
        compose.onNodeWithTag(TOUSettingsModalTestTags.CANCEL).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithTag(TOUSettingsModalTestTags.SUBMIT).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun submitWithNoPresetShowsTheValidationErrorAndDoesNotSubmit() {
        var submitted: JsonObject? = null
        setContent(onSubmit = { submitted = it })

        compose.onNodeWithTag(TOUSettingsModalTestTags.SUBMIT).performClick()

        compose.onNodeWithText(strings.errorNoPreset).assertIsDisplayed()
        assertNull(submitted)
    }

    @Test
    fun choosingAPresetRendersThePreviewAndSubmitsItsEnvelope() {
        var submitted: JsonObject? = null
        setContent(initialPresetId = "pge-ev2a", onSubmit = { submitted = it })

        compose.onNodeWithText(strings.previewLabel).assertIsDisplayed()
        compose.onNodeWithTag(TOUSettingsModalTestTags.PREVIEW).assertIsDisplayed()

        compose.onNodeWithTag(TOUSettingsModalTestTags.SUBMIT).performClick()
        assertEquals(TOUSettingsModalProjection.findPreset("pge-ev2a")!!.settings, submitted)
    }

    @Test
    fun customTabInvalidJsonShowsTheParseError() {
        var submitted: JsonObject? = null
        setContent(initialTab = TOUTab.Custom, initialCustomJson = "{ not valid", onSubmit = { submitted = it })

        compose.onNodeWithText(strings.customLabel, substring = true).assertIsDisplayed()
        compose.onNodeWithTag(TOUSettingsModalTestTags.SUBMIT).performClick()

        compose.onNodeWithText(strings.errorInvalidJson).assertIsDisplayed()
        assertNull(submitted)
    }

    @Test
    fun customTabValidObjectHandsBackTheWrappedEnvelope() {
        var submitted: JsonObject? = null
        setContent(
            initialTab = TOUTab.Custom,
            initialCustomJson = """{ "optimization_strategy": "economics" }""",
            onSubmit = { submitted = it },
        )

        compose.onNodeWithTag(TOUSettingsModalTestTags.SUBMIT).performClick()

        assertNotNull(submitted)
        assertNotNull(submitted!![TOUSettingsModalProjection.KEY_TOU_SETTINGS])
    }

    @Test
    fun inFlightDisablesBothActions() {
        setContent(submitting = true, initialPresetId = "sce-tou-d")
        compose.onNodeWithTag(TOUSettingsModalTestTags.SUBMIT).assertIsNotEnabled()
        compose.onNodeWithTag(TOUSettingsModalTestTags.CANCEL).assertIsNotEnabled()
    }

    @Test
    fun serverErrorRendersTheInlineAlert() {
        setContent(submitError = "TOU update failed: 502 Bad Gateway")
        compose.onNodeWithTag(TOUSettingsModalTestTags.ERROR).assertIsDisplayed()
        compose.onNodeWithText("TOU update failed: 502 Bad Gateway").assertIsDisplayed()
    }

    @Test
    fun cancelInvokesOnCancel() {
        var cancelled = false
        setContent(onCancel = { cancelled = true })
        compose.onNodeWithTag(TOUSettingsModalTestTags.CANCEL).performClick()
        assertTrue(cancelled)
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 1400.dp
    }
}
