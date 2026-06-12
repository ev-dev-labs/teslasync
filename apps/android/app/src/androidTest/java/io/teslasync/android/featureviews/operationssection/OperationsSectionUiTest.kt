package io.teslasync.android.featureviews.operationssection

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [OperationsSectionContent] across every state the
 * surface renders: the loading skeleton chrome, the hard-error retry surface, the settled-empty audit state,
 * the populated delivery block (metrics + gauge) and audit table, and the stale/offline cached view. The
 * accordion is rendered expanded (`defaultOpen = true`) so the body is asserted directly. Asserts the rendered
 * i18n strings and the TalkBack content descriptions (the always-visible title, the success gauge read-out,
 * the loading skeleton, the offline freshness chip). The offline gate's `testReleaseUnitTest` covers the pure
 * logic; this covers render + a11y. Mirrors the web spec
 * (web/src/features/system/components/status/OperationsSection.tsx).
 */
class OperationsSectionUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<OperationsData>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                OperationsSectionContent(
                    state = state,
                    onRetry = onRetry,
                    defaultOpen = true,
                    locale = Locale.US,
                )
            }
        }
    }

    private fun stats(): NotificationStats =
        NotificationStats(
            totalSent = 200,
            sent = 190,
            failed = 10,
            pending = 0,
            totalChannels = 5,
            enabledChannels = 4,
        )

    private fun data(): OperationsData =
        OperationsData(
            stats = stats(),
            notificationLogs =
                listOf(
                    NotificationLogRow(1, "sent", "Charge complete", "Reached 80%", "2026-06-11T12:00:00Z"),
                    NotificationLogRow(2, "failed", "Sentry alert", "Webhook 500", "2026-06-11T11:30:00Z"),
                ),
            auditLogs =
                listOf(
                    AuditLogRow(1, "2026-06-11T12:05:00Z", "settings.update", "settings/units", "km -> mi"),
                ),
        )

    @Test
    fun loadingShowsTitleChromeAndAccessibleSkeletonNotABlankPanel() {
        setContent(UiState.loading())
        compose.onNodeWithText("Operations").assertIsDisplayed()
        compose.onNodeWithContentDescription("Loading", substring = true).assertExists()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Operations").assertIsDisplayed()
        compose.onNodeWithText("Server error").assertExists()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsTitleAndFriendlyAuditEmptyState() {
        setContent(
            UiState(
                phase = UiPhase.Empty,
                data = OperationsData(stats = null, notificationLogs = null, auditLogs = emptyList()),
            ),
        )
        compose.onNodeWithText("Operations").assertIsDisplayed()
        compose.onNodeWithText("Audit Log").assertExists()
        compose.onNodeWithText("No audit log entries").assertExists()
    }

    @Test
    fun contentRendersHeaderBadgeDeliveryGaugeAndAudit() {
        setContent(UiState(phase = UiPhase.Content, data = data()))
        compose.onNodeWithText("Operations").assertIsDisplayed()
        compose.onNodeWithText("95.0% success rate").assertExists()
        compose.onNodeWithText("Notification Delivery").assertExists()
        compose.onNodeWithText("Total Sent").assertExists()
        compose.onNodeWithText("Channels").assertExists()
        compose.onNodeWithContentDescription("Success", substring = true).assertExists()
        compose.onNodeWithText("Audit Log").assertExists()
    }

    @Test
    fun offlineShowsCachedContentWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = data(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Operations").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline", substring = true).assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = data(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Operations").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
