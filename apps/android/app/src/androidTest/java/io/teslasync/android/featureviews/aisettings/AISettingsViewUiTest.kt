package io.teslasync.android.featureviews.aisettings

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the AISettings surface across every state it renders:
 * the loading skeleton chrome, the hard-error retry surface, the blank-document empty state, the populated
 * panel (mode picker with TalkBack labels, off banner, cloud cost-cap bar with its progressbar label + warn/
 * critical hints, and the save affordance), the stale/offline cached view, and the stale auto-refresh. The
 * gate's `testReleaseUnitTest` covers the pure logic + view-model; this covers render + a11y. Mirrors the web
 * spec (web/src/features/settings/components/AISettings.tsx).
 */
class AISettingsViewUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun cloud(capCents: Long = 500L) = AiSettingsProjection(HelixMode.Cloud, capCents, present = true)

    private fun off() = AiSettingsProjection(HelixMode.Off, costCapCents = 0L, present = true)

    private fun usage(microCents: Long) = UiState(UiPhase.Content, AiUsageToday(microCents))

    private fun setContent(
        settingsState: UiState<AiSettingsProjection>,
        usageState: UiState<AiUsageToday> = usage(0L),
        saving: Boolean = false,
        onSave: (HelixMode) -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AISettingsContent(
                    settingsState = settingsState,
                    usageState = usageState,
                    saving = saving,
                    onSave = onSave,
                    onRetry = onRetry,
                )
            }
        }
    }

    @Test
    fun loadingShowsHeaderAndAccessibleSkeletonNotABlankPanel() {
        setContent(UiState(UiPhase.Loading), UiState(UiPhase.Loading))
        compose.onNodeWithText("Helix").assertIsDisplayed()
        compose.onAllNodesWithContentDescription("Loading...").onFirst().assertExists()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(
            settingsState = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = { retried = true },
        )
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsFriendlyNoDataMessage() {
        setContent(UiState(UiPhase.Empty, off()))
        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun cloudContentRendersModePickerCostBarAndSave() {
        setContent(UiState(UiPhase.Content, cloud()), usage(4_200_000L))
        // Mode options (accessible labels on every interactive element).
        compose.onNodeWithContentDescription("Off (default)").assertExists()
        compose.onNodeWithContentDescription("Local-only").assertExists()
        compose.onNodeWithContentDescription("Cloud").assertExists()
        // Cost-cap bar (cloud + cap > 0): title, accessible progressbar, warn hint at 84%.
        compose.onNodeWithText("Today’s Helix spend").assertIsDisplayed()
        compose.onNodeWithContentDescription("Helix cost cap usage").assertExists()
        compose.onNodeWithText("nearing", substring = true).assertIsDisplayed()
        // Save affordance.
        compose.onNodeWithText("Save Helix settings").assertIsDisplayed()
    }

    @Test
    fun criticalSpendShowsCriticalHint() {
        setContent(UiState(UiPhase.Content, cloud()), usage(6_000_000L))
        compose.onNodeWithText("Cap reached", substring = true).assertIsDisplayed()
    }

    @Test
    fun offModeShowsBannerAndHidesCostBar() {
        setContent(UiState(UiPhase.Content, off()), usage(4_200_000L))
        compose.onNodeWithText("Helix is off.", substring = true).assertIsDisplayed()
        compose.onAllNodesWithContentDescription("Helix cost cap usage").assertCountEquals(0)
    }

    @Test
    fun saveInvokesCallbackWithSelectedMode() {
        var saved: HelixMode? = null
        setContent(UiState(UiPhase.Content, cloud()), onSave = { saved = it })
        compose.onNodeWithText("Save Helix settings").performClick()
        assertEquals(HelixMode.Cloud, saved)
    }

    @Test
    fun savingShowsSavingLabelAndDisablesButton() {
        setContent(UiState(UiPhase.Content, cloud()), saving = true)
        compose.onNodeWithText("Saving", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Saving", substring = true).assertIsNotEnabled()
    }

    @Test
    fun selectingLocalUpdatesModeAndHidesOffBanner() {
        setContent(UiState(UiPhase.Content, off()))
        compose.onNodeWithText("Helix is off.", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("Local-only").performClick()
        compose.onAllNodesWithText("Enable a mode above", substring = true).assertCountEquals(0)
    }

    @Test
    fun offlineShowsCachedContentWithOfflineChip() {
        setContent(
            settingsState =
                UiState(
                    phase = UiPhase.Content,
                    data = cloud(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            usageState = usage(1_000_000L),
        )
        compose.onNodeWithContentDescription("Cloud").assertExists()
        compose.onAllNodesWithContentDescription("Offline").onFirst().assertExists()
    }

    @Test
    fun staleContentAutoRefreshes() {
        var refreshed = false
        setContent(
            settingsState =
                UiState(
                    phase = UiPhase.Content,
                    data = cloud(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        assertTrue(refreshed)
    }
}
