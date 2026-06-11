package io.teslasync.android.featureviews.changespanel

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
import io.teslasync.shared.core.presentation.featureflags.FeatureFlagChange
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.ZoneOffset
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [ChangesPanelContent] across every state the surface
 * renders: the loading audit-log chrome, the hard-error retry surface, the global + scoped empty states, the
 * populated audit table (headers, key, operation badge, value preview), and the stale/offline cached views.
 * Asserts the rendered i18n strings and that the interactive affordances (retry, pager) carry accessible
 * labels + click actions. Runs under `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers
 * the pure logic. Mirrors the web spec (web/src/features/admin/components/feature-flags/ChangesPanel.tsx).
 */
class ChangesPanelUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun rows(): List<FeatureFlagChange> =
        listOf(
            FeatureFlagChange(
                id = 1,
                changedAt = "2026-04-04T14:30:00Z",
                actor = "admin@teslasync.io",
                actorIp = "10.0.0.2",
                flagKey = "telemetry.fast_path",
                operation = "set",
                oldValue = JsonNull,
                newValue = JsonPrimitive(true),
                reason = "Enable fast path",
                traceId = "trace-1",
            ),
            FeatureFlagChange(
                id = 2,
                changedAt = "2026-04-03T09:15:00Z",
                actor = "",
                actorIp = "",
                flagKey = "beta.new_ui",
                operation = "delete",
                oldValue = JsonPrimitive("v2"),
                newValue = JsonNull,
                reason = "",
                traceId = "trace-2",
            ),
        )

    private fun setContent(
        state: UiState<List<FeatureFlagChange>>,
        scopedKey: String? = null,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    ChangesPanelContent(
                        state = state,
                        onRetry = onRetry,
                        scopedKey = scopedKey,
                        locale = Locale.US,
                        zoneId = ZoneOffset.UTC,
                    )
                }
            }
        }
    }

    @Test
    fun loadingShowsHeaderChromeAndLoadingAuditLogText() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText("Changed at").assertIsDisplayed()
        compose.onNodeWithText("Loading audit log", substring = true).assertIsDisplayed()
    }

    @Test
    fun errorShowsAccessibleRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyGlobalShowsTitleAndGlobalMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyList()))
        compose.onNodeWithText("No flag changes yet").assertIsDisplayed()
        compose.onNodeWithText("Flag changes will appear here", substring = true).assertIsDisplayed()
    }

    @Test
    fun emptyScopedShowsScopedMessageWithFlagKey() {
        setContent(UiState(UiPhase.Empty, data = emptyList()), scopedKey = "telemetry.fast_path")
        compose.onNodeWithText("No flag changes yet").assertIsDisplayed()
        compose.onNodeWithText("telemetry.fast_path", substring = true).assertIsDisplayed()
    }

    @Test
    fun contentShowsHeadersRowsAndOperationBadges() {
        setContent(UiState(UiPhase.Content, data = rows()))
        compose.onNodeWithText("Changed at").assertIsDisplayed()
        compose.onNodeWithText("Reason").assertIsDisplayed()
        compose.onNodeWithText("telemetry.fast_path").assertIsDisplayed()
        compose.onNodeWithText("beta.new_ui").assertIsDisplayed()
        compose.onNodeWithText("set").assertIsDisplayed()
        compose.onNodeWithText("delete").assertIsDisplayed()
        compose.onNodeWithText("true").assertIsDisplayed()
    }

    @Test
    fun contentExposesAccessiblePagerControls() {
        setContent(UiState(UiPhase.Content, data = rows()))
        compose.onNodeWithContentDescription("First page").assertIsDisplayed()
        compose.onNodeWithContentDescription("Last page").assertIsDisplayed()
    }

    @Test
    fun offlineShowsCachedContentWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = rows(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("telemetry.fast_path").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertIsDisplayed()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = rows(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("telemetry.fast_path").assertIsDisplayed()
        assertTrue(refreshed)
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 360.dp
        val HOST_HEIGHT = 720.dp
    }
}
