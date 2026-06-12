package io.teslasync.android.featureviews.presetgallery

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
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
 * On-device Compose UI + accessibility verification of [PresetGalleryContent] across every state the surface
 * renders: the loading skeleton chrome, the hard-error retry surface, the empty state, the populated card
 * grid (name, first-trigger label, action-count badge, Install action), and the stale/offline cached views.
 * Asserts the rendered i18n strings and the TalkBack content descriptions (the accessible loading skeleton,
 * the freshness chip), and that Install routes the preset id back to the host. The offline gate's
 * `testReleaseUnitTest` covers the pure logic; this covers render + a11y. Mirrors the web spec
 * (web/src/features/automations/pages/PresetGallery.tsx).
 */
class PresetGalleryUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<List<AutomationPresetData>>,
        onInstall: (String) -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                PresetGalleryContent(state = state, onInstall = onInstall, onRetry = onRetry)
            }
        }
    }

    private fun presets(): List<AutomationPresetData> =
        listOf(
            AutomationPresetData(
                id = "preset-precondition",
                name = "Morning Precondition",
                description = "Warm the cabin before your commute.",
                icon = "Sun",
                triggerKinds = listOf("trigger_schedule"),
                actionCount = 3,
            ),
            AutomationPresetData(
                id = "preset-arrive-home",
                name = "Secure on Arrival",
                description = "Lock up when you reach home.",
                icon = "Lock",
                triggerKinds = listOf("trigger_geofence"),
                actionCount = 2,
            ),
        )

    @Test
    fun loadingShowsAccessibleSkeletonNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsFriendlyNoPresetsMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyList()))
        compose.onNodeWithText("No preset templates available").assertIsDisplayed()
    }

    @Test
    fun contentRendersCardFieldsAndRoutesInstallPresetId() {
        var installed: String? = null
        setContent(state = UiState(UiPhase.Content, data = presets()), onInstall = { installed = it })
        compose.waitForIdle()

        compose.onNodeWithText("Morning Precondition").assertIsDisplayed()
        compose.onNodeWithText("Secure on Arrival").assertIsDisplayed()
        compose.onNodeWithText("Schedule").assertIsDisplayed()
        compose.onNodeWithText("Geofence").assertIsDisplayed()
        compose.onNodeWithText("3 actions").assertIsDisplayed()

        compose.onAllNodesWithText("Install")[0].performClick()
        assertEquals("preset-precondition", installed)
    }

    @Test
    fun offlineShowsCachedGridWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = presets(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.waitForIdle()
        compose.onNodeWithText("Morning Precondition").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedGrid() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = presets(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Morning Precondition").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
