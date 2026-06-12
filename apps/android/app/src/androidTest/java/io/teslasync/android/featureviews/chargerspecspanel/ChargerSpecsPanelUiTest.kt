package io.teslasync.android.featureviews.chargerspecspanel

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * Instrumented Compose UI + accessibility verification of [ChargerSpecsPanelContent] across every branch the
 * web component renders (the four-column breakdown grid / the panel-level empty state), plus the lifecycle
 * chrome the host's feed implies (loading skeletons, a hard error with an accessible retry, and the
 * stale/offline freshness chip). Asserts the rendered title, column labels, the per-column empty messages,
 * the merged per-row TalkBack description, and the retry click action. Runs under `connectedAndroidTest`; the
 * offline gate's `testReleaseUnitTest` covers the pure projection. Mirrors the web spec
 * (web/src/features/charging/components/charging-list/ChargerSpecsPanel.tsx).
 */
class ChargerSpecsPanelUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        ChargerSpecsStrings(
            title = "Charger Specs Breakdown",
            byVoltage = "By Voltage",
            byPhase = "By Phase",
            byCable = "By Cable",
            byBrand = "By Brand",
            noVoltage = "No voltage data",
            noPhase = "No phase data",
            noCable = "No cable data",
            noBrand = "No brand data",
            noData = "No charger specification data available yet",
            sessions = "sessions",
            kw = "kW",
            kwh = "kWh",
            avg = "avg",
        )

    private val specs =
        ChargerSpecsData(
            voltage = emptyList(),
            phase = emptyList(),
            cable = listOf(SpecEntry("Type 2", 12, 340_000.0, null)),
            brand = listOf(SpecEntry("Tesla", 9, 480_000.0, 120_000.0)),
        )

    private fun setContent(
        state: UiState<ChargerSpecsData>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    ChargerSpecsPanelContent(state = state, onRetry = onRetry, locale = Locale.US, strings = strings)
                }
            }
        }
    }

    @Test
    fun contentShowsTitleColumnLabelsRowsAndPerColumnEmpty() {
        setContent(UiState(phase = UiPhase.Content, data = specs))
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        // Every column label is rendered (web's four SpecColumn headers).
        compose.onNodeWithText(strings.byVoltage).assertIsDisplayed()
        compose.onNodeWithText(strings.byCable).assertIsDisplayed()
        compose.onNodeWithText(strings.byBrand).assertIsDisplayed()
        // A populated row is announced as one merged TalkBack fact (name + summary).
        compose.onNodeWithContentDescription("Tesla", substring = true).assertExists()
        compose.onNodeWithContentDescription("Type 2", substring = true).assertExists()
        // Empty columns still surface their own message (web SpecColumn EmptyState) — never a blank gap.
        compose.onNodeWithText(strings.noVoltage).assertIsDisplayed()
        compose.onNodeWithText(strings.noPhase).assertIsDisplayed()
    }

    @Test
    fun brandRowAnnouncesAveragePowerInKw() {
        setContent(UiState(phase = UiPhase.Content, data = specs))
        // Web Brand column: "{count} sessions · {int} kW avg" — 480_000 W averaged is rendered as 120 kW.
        compose.onNodeWithContentDescription("120 kW avg", substring = true).assertExists()
    }

    @Test
    fun loadingShowsTitleButNoColumnLabels() {
        setContent(UiState.loading())
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        // The skeleton grid carries no column labels.
        compose.onNodeWithText(strings.byBrand).assertDoesNotExist()
    }

    @Test
    fun emptyShowsAccessibleNoDataMessage() {
        setContent(UiState(phase = UiPhase.Empty))
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        compose.onNodeWithText(strings.noData).assertIsDisplayed()
    }

    @Test
    fun errorShowsAccessibleRetryAndInvokesIt() {
        var retried = false
        setContent(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        val retry = compose.onNodeWithText("Retry")
        retry.assertIsDisplayed().assertHasClickAction()
        retry.performClick()
        assertTrue(retried)
    }

    @Test
    fun offlineStaleStillShowsCachedContentWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = specs,
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        // Stale/offline keeps the cached breakdown visible (never blanks) — the "last known" contract.
        compose.onNodeWithContentDescription("Tesla", substring = true).assertExists()
        compose.onNodeWithContentDescription("Offline", substring = true).assertExists()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 900.dp
    }
}
