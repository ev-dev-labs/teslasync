package io.teslasync.android.featureviews.featuretoggles

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.presentation.user.TeslaConfigEnvelope
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.ZoneId
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [FeatureTogglesContent] across every state the surface
 * renders: the loading skeleton chrome, the hard-error retry surface, the empty state, the populated
 * feature-flag table (Feature / Status / Details with Enabled + Disabled badges), the stale/offline cached
 * view, and the always-visible header + Refresh affordance. Mirrors the web spec
 * (web/src/features/settings/components/FeatureToggles.tsx).
 */
class FeatureTogglesUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun flags(): JsonElement =
        buildJsonObject {
            put("supercharging", true)
            putJsonObject("ludicrous") {
                put("enabled", false)
                put("tier", "x")
            }
        }

    private fun envelope(
        data: JsonElement = flags(),
        fetchedAt: String? = "2026-06-12T14:30:00Z",
    ): TeslaConfigEnvelope<JsonElement> = TeslaConfigEnvelope(data = data, fetchedAt = fetchedAt)

    private fun setContent(
        state: UiState<TeslaConfigEnvelope<JsonElement>>,
        refreshing: Boolean = false,
        onRefresh: () -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                FeatureTogglesContent(
                    state = state,
                    refreshing = refreshing,
                    onRefresh = onRefresh,
                    onRetry = onRetry,
                    zone = ZoneId.of("UTC"),
                    locale = Locale.US,
                )
            }
        }
    }

    @Test
    fun headerAlwaysRendersTitleSubtitleAndRefresh() {
        setContent(UiState(UiPhase.Content, data = envelope()))
        compose.onNodeWithText("Feature Flags").assertIsDisplayed()
        compose.onNodeWithText("Tesla account feature configuration").assertIsDisplayed()
        compose.onNodeWithText("Refresh").assertIsDisplayed()
    }

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
    fun emptyShowsFriendlyNoDataMessage() {
        setContent(UiState(UiPhase.Empty, data = envelope(data = buildJsonObject {})))
        compose.onNodeWithText("No feature config data yet. Click Refresh to fetch from Tesla.").assertIsDisplayed()
    }

    @Test
    fun contentRendersFeatureColumnsStatusBadgesAndDetails() {
        setContent(UiState(UiPhase.Content, data = envelope()))
        // Column headers (web uppercase grid header row).
        compose.onNodeWithText("Feature").assertIsDisplayed()
        compose.onNodeWithText("Status").assertIsDisplayed()
        compose.onNodeWithText("Details").assertIsDisplayed()
        // Rows: the flag keys, the status badges, and the object value's joined details.
        compose.onNodeWithText("supercharging").assertIsDisplayed()
        compose.onNodeWithText("ludicrous").assertIsDisplayed()
        compose.onNodeWithText("Enabled").assertIsDisplayed()
        compose.onNodeWithText("Disabled").assertIsDisplayed()
        compose.onNodeWithText("tier", substring = true).assertIsDisplayed()
    }

    @Test
    fun refreshButtonInvokesOnRefresh() {
        var refreshed = false
        setContent(state = UiState(UiPhase.Content, data = envelope()), onRefresh = { refreshed = true })
        compose.onNodeWithText("Refresh").performClick()
        assertTrue(refreshed)
    }

    @Test
    fun offlineShowsCachedContentWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = envelope(data = buildJsonObject { put("cached_flag", true) }),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("cached_flag").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleNonErrorTriggersAutoRefresh() {
        var retried = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = envelope(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { retried = true },
        )
        compose.waitForIdle()
        assertTrue(retried)
    }

    @Test
    fun emptyChromeStillRendersTheHeaderAndRefresh() {
        // Even with no rows the header + Refresh affordance stay visible (never a blank/hidden panel).
        setContent(UiState(UiPhase.Empty, data = envelope(data = buildJsonObject {})))
        compose.onNodeWithText("Feature Flags").assertIsDisplayed()
        compose.onNodeWithText("Refresh").assertIsDisplayed()
        // The data table (and its column headers) must not render when there are no rows.
        compose.onNodeWithText("Status").assertDoesNotExist()
    }
}
