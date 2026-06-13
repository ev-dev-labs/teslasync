// Instrumented Compose UI + accessibility verification of [SignalConfigModalContent] across the branches the web
// component renders: the populated form (the preset row, the master controls, and the grouped category sections all
// present — the a11y label test), the empty fallback (no categories → the friendly "no signals available" surface, web
// renders nothing — never a blank box), the disabled subscribe while nothing is selected (web `disabled={…===0}`), the
// subscribe hand-off once a row is selected (the assembled `{ name, interval }` rows flow back through `onSubmit`), and
// the Cancel affordance. Runs under `connectedAndroidTest` (a device/emulator); the offline gate's
// `testReleaseUnitTest` covers the pure model.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.signalconfigmodal

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class SignalConfigModalUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        SignalConfigStrings(
            title = "Fleet Telemetry Signal Configuration",
            close = "Close",
            cancel = "Cancel",
            subscribe = "Subscribe",
            signals = "Signals",
            signalsSelectedSuffix = "signals selected",
            selectAll = "Select All",
            deselectAll = "Deselect All",
            masterInterval = "Master Interval",
            searchHint = "Search signals…",
            setAll = "Set all…",
            atConnector = "at",
            noSignalsAvailable = "No signals available to configure.",
            noSignalsMatch = "No signals match your search.",
        )

    private val categories =
        listOf(
            SignalCategoryDef("Driving", listOf("VehicleSpeed", "Gear")),
            SignalCategoryDef("Charging", listOf("ChargeState")),
        )

    private fun setContent(
        categories: List<SignalCategoryDef> = this.categories,
        initialSelected: List<String> = listOf("VehicleSpeed"),
        onSubmit: (List<SubscribedSignal>) -> Unit = {},
        onCancel: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    SignalConfigModalContent(
                        categories = categories,
                        initialSelected = initialSelected,
                        initialInterval = SignalIntervals.DEFAULT_VALUE,
                        strings = strings,
                        intervalDescriptions = rememberIntervalDescriptions(),
                        presetCopy = rememberPresetCopy(),
                        onSubmit = onSubmit,
                        onCancel = onCancel,
                    )
                }
            }
        }
    }

    @Test
    fun populatedRendersPresetsMasterControlsAndActions() {
        setContent()
        compose.onNodeWithTag(SignalConfigModalTestTags.PRESETS).assertIsDisplayed()
        compose.onNodeWithText("Balanced", substring = true).assertIsDisplayed()
        compose.onNodeWithTag(SignalConfigModalTestTags.LIST).assertIsDisplayed()
        compose.onNodeWithText(strings.selectAll).assertIsDisplayed()
        compose.onNodeWithText(strings.masterInterval).assertIsDisplayed()
        compose.onNodeWithText(strings.searchHint).assertIsDisplayed()
        compose.onNodeWithText(strings.cancel).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithTag(SignalConfigModalTestTags.SUBSCRIBE).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun everySignalAndCategoryControlExposesAnAccessibleName() {
        setContent()
        // The category select-all checkboxes name themselves by category for TalkBack.
        compose.onNodeWithContentDescription("Driving").assertIsDisplayed()
        compose.onNodeWithContentDescription("Charging").assertIsDisplayed()
        // The per-signal checkboxes name themselves by signal (default-expanded categories).
        compose.onNodeWithContentDescription("VehicleSpeed").assertIsDisplayed()
        compose.onNodeWithContentDescription("Gear").assertIsDisplayed()
        compose.onNodeWithContentDescription("ChargeState").assertIsDisplayed()
    }

    @Test
    fun subscribeIsDisabledWhileNothingIsSelected() {
        setContent(initialSelected = emptyList())
        compose.onNodeWithTag(SignalConfigModalTestTags.SUBSCRIBE).assertIsNotEnabled()
    }

    @Test
    fun subscribeHandsBackTheSelectedRows() {
        var submitted: List<SubscribedSignal>? = null
        setContent(initialSelected = listOf("VehicleSpeed"), onSubmit = { submitted = it })

        compose.onNodeWithTag(SignalConfigModalTestTags.SUBSCRIBE).assertIsEnabled().performClick()

        assertEquals(listOf(SubscribedSignal("VehicleSpeed", SignalIntervals.DEFAULT_VALUE)), submitted)
    }

    @Test
    fun emptyStateRendersWhenThereAreNoCategories() {
        setContent(categories = emptyList(), initialSelected = emptyList())
        compose.onNodeWithTag(SignalConfigModalTestTags.EMPTY).assertIsDisplayed()
        compose.onNodeWithText(strings.noSignalsAvailable).assertIsDisplayed()
    }

    @Test
    fun cancelInvokesOnCancel() {
        var cancelled = false
        setContent(onCancel = { cancelled = true })
        compose.onNodeWithText(strings.cancel).performClick()
        assertTrue(cancelled)
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 1600.dp
    }
}
