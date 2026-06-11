package io.teslasync.android.featureviews.fleetapi

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [FleetApiSectionContent] across the states the
 * web component renders: the loading skeleton chrome, the populated wizard + tool stack, the config
 * query-error AlertBanner, and the interactive wizard controls. Asserts rendered i18n strings and the
 * wizard CTA callbacks. Runs under connectedAndroidTest; the offline gate's testReleaseUnitTest covers
 * the projection + view-model logic, this covers the render + a11y.
 */
class FleetApiSectionUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun info() = FleetApiInfo("https://fleet.tesla.com", "abc-123", true, listOf("na"), "app.example.com")

    private fun status() = PublicKeyStatus(true, "SHA256:ab", "https://app.example.com/.well-known/key")

    private fun vehicles() = listOf(VehicleOption("5YJ3E1EA1KF000001", "Model 3"))

    private fun wizard() = WizardProjection.project(WizardInputs(emptyMap(), 0))

    private fun setContent(
        config: UiState<FleetApiInfo> = UiState(UiPhase.Content, data = info(), fetchedAt = 1L),
        status: UiState<PublicKeyStatus> = UiState(UiPhase.Content, data = status(), fetchedAt = 1L),
        vehicles: UiState<List<VehicleOption>> = UiState(UiPhase.Content, data = vehicles(), fetchedAt = 1L),
        callbacks: FleetApiCallbacks = FleetApiCallbacks.NONE,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                FleetApiSectionContent(
                    config = config,
                    status = status,
                    vehicles = vehicles,
                    wizard = wizard(),
                    actions = emptyMap(),
                    callbacks = callbacks,
                )
            }
        }
    }

    @Test
    fun loadingShowsSectionTitles() {
        setContent(
            config = UiState(UiPhase.Loading),
            status = UiState(UiPhase.Loading),
            vehicles = UiState(UiPhase.Loading),
        )
        compose.onNodeWithText("Setup Wizard").assertIsDisplayed()
        compose.onNodeWithText("Fleet API Tools").assertIsDisplayed()
    }

    @Test
    fun contentShowsWizardAndTools() {
        setContent()
        compose.onNodeWithText("Setup Wizard").assertIsDisplayed()
        // Wizard first step label + mark-complete CTA.
        compose.onNodeWithText("Tesla Developer Account").assertExists()
        compose.onNodeWithText("Mark Complete").assertExists()
        // A representative tool title further down the stack.
        compose.onNodeWithText("Config").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Partner Reg").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun configErrorShowsAlertBanner() {
        setContent(config = UiState(UiPhase.Error, errorKind = io.teslasync.android.data.ErrorKind.Network))
        compose.onNodeWithText("Failed to load data").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun nextStepInvokesCallback() {
        var advanced = false
        setContent(callbacks = FleetApiCallbacks.NONE.copy(onNextStep = { advanced = true }))
        compose.onNodeWithText("Next").performScrollTo().performClick()
        assertEquals(true, advanced)
    }

    @Test
    fun markCompleteInvokesCallback() {
        var marked = false
        setContent(callbacks = FleetApiCallbacks.NONE.copy(onMarkStepComplete = { marked = true }))
        compose.onNodeWithText("Mark Complete").performScrollTo().performClick()
        assertEquals(true, marked)
    }
}
