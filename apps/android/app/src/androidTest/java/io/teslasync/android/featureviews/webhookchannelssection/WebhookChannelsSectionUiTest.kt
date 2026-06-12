package io.teslasync.android.featureviews.webhookchannelssection

import androidx.compose.runtime.remember
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notificationchannels.NotificationChannel
import io.teslasync.shared.core.presentation.notificationchannels.WebhookSignaturePreviewResult
import io.teslasync.shared.core.presentation.notificationchannels.WebhookTestResult
import io.teslasync.shared.core.presentation.notifications.NotificationChannelInput
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the WebhookChannelsSection surface across every state it
 * renders: the loading skeleton chrome, the hard-error retry surface, the no-webhooks empty state, the populated
 * rows (status pill + method chip + URL, with TalkBack-labelled test/edit/delete affordances), the inline test
 * result, the stale/offline cached view, the payload docs box, and the create modal opened from the Add
 * affordance. The offline gate's `testReleaseUnitTest` covers the pure logic + view-model; this covers render +
 * a11y. Mirrors the web spec (web/src/features/settings/components/WebhookChannelsSection.tsx).
 */
class WebhookChannelsSectionUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun webhooks(): List<NotificationChannel.Webhook> =
        listOf(
            NotificationChannel.Webhook(
                id = 1,
                name = "Discord #alerts",
                enabled = true,
                url = "https://discord.com/api/webhooks/123/abc",
                method = "POST",
            ),
            NotificationChannel.Webhook(
                id = 2,
                name = "Home Assistant",
                enabled = false,
                url = "https://ha.local/api/webhook/xyz",
                method = "PUT",
            ),
        )

    private fun setContent(
        channelsState: UiState<List<NotificationChannel.Webhook>>,
        testResults: Map<Long, WebhookTestResult> = emptyMap(),
        testingChannelId: Long? = null,
        onEdit: (NotificationChannel.Webhook) -> Unit = {},
        onDelete: (NotificationChannel.Webhook) -> Unit = {},
        onToggle: (NotificationChannel.Webhook) -> Unit = {},
        onTest: (NotificationChannel.Webhook) -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                WebhookChannelsSectionContent(
                    channelsState = channelsState,
                    testResults = testResults,
                    testingChannelId = testingChannelId,
                    onAdd = {},
                    onEdit = onEdit,
                    onDelete = onDelete,
                    onToggle = onToggle,
                    onTest = onTest,
                    onRetry = onRetry,
                )
            }
        }
    }

    @Test
    fun loadingShowsAddAffordanceAndAccessibleSkeletonNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText("Add webhook").assertIsDisplayed()
        compose.onAllNodesWithContentDescription("Loading").onFirst().assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(
            channelsState = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = { retried = true },
        )
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsFriendlyNoWebhooksMessageWithCta() {
        setContent(UiState(UiPhase.Empty, emptyList()))
        compose.onNodeWithText("No webhooks yet").assertIsDisplayed()
        compose.onNodeWithText("Add your first webhook").assertIsDisplayed()
    }

    @Test
    fun contentRendersRowsBadgesMethodsDocsAndAccessibleActions() {
        setContent(
            channelsState = UiState(UiPhase.Content, webhooks()),
            testResults = mapOf(1L to WebhookTestResult(success = true, statusCode = 200, latencyMs = 142)),
        )
        // Rows.
        compose.onNodeWithText("Discord #alerts").assertIsDisplayed()
        compose.onNodeWithText("Home Assistant").assertIsDisplayed()
        // Status pills + method chips.
        compose.onNodeWithText("Enabled").assertIsDisplayed()
        compose.onNodeWithText("Disabled").assertIsDisplayed()
        compose.onNodeWithText("POST").assertIsDisplayed()
        compose.onNodeWithText("PUT").assertIsDisplayed()
        // Inline test result.
        compose.onNodeWithText("Success").assertIsDisplayed()
        // Payload docs box.
        compose.onNodeWithText("Available payload variables").assertIsDisplayed()
        // Accessibility: every row action affordance is announced.
        compose.onAllNodesWithContentDescription("Test webhook").onFirst().assertIsDisplayed()
        compose.onAllNodesWithContentDescription("Edit webhook").onFirst().assertIsDisplayed()
        compose.onAllNodesWithContentDescription("Delete webhook").onFirst().assertIsDisplayed()
    }

    @Test
    fun rowActionsInvokeCallbacksWithAccessibleLabels() {
        var tested: Long? = null
        var edited: Long? = null
        var deleted: Long? = null
        val single =
            listOf(
                NotificationChannel.Webhook(id = 9, name = "Solo", enabled = true, url = "https://x/webhook", method = "POST"),
            )
        setContent(
            channelsState = UiState(UiPhase.Content, single),
            onTest = { tested = it.id },
            onEdit = { edited = it.id },
            onDelete = { deleted = it.id },
        )
        compose.onNodeWithContentDescription("Test webhook").performClick()
        compose.onNodeWithContentDescription("Edit webhook").performClick()
        compose.onNodeWithContentDescription("Delete webhook").performClick()
        assertTrue(tested == 9L && edited == 9L && deleted == 9L)
    }

    @Test
    fun offlineShowsCachedContentWithOfflineChip() {
        setContent(
            channelsState =
                UiState(
                    phase = UiPhase.Content,
                    data = webhooks(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
        )
        compose.onNodeWithText("Discord #alerts").assertIsDisplayed()
        compose.onAllNodesWithContentDescription("Offline").onFirst().assertIsDisplayed()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            channelsState =
                UiState(
                    phase = UiPhase.Content,
                    data = webhooks(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Discord #alerts").assertIsDisplayed()
        assertTrue(refreshed)
    }

    @Test
    fun addAffordanceOpensCreateModalWithFields() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                val vm =
                    remember {
                        WebhookChannelsSectionViewModel(
                            source = FakeUiSource(),
                            logger = SilentLogger,
                            scope = null,
                        )
                    }
                WebhookChannelsSection(viewModel = vm)
            }
        }
        compose.onNodeWithText("Add webhook").performClick()
        // The create modal: the four fields the backend persists.
        compose.onNodeWithText("HTTP method").assertIsDisplayed()
        compose.onNodeWithText("Signing secret").assertIsDisplayed()
    }

    private object SilentLogger : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

    private class FakeUiSource : WebhookChannelsSectionSource {
        override fun webhookChannels(): Flow<Resource<List<NotificationChannel.Webhook>>> = flowOf(Resource.Success(emptyList(), 1L, false))

        override fun invalidate() = Unit

        override suspend fun saveChannel(input: NotificationChannelInput): Result<NotificationChannel> =
            Result.success(NotificationChannel.Webhook(id = 1))

        override suspend fun deleteChannel(id: Long): Result<Unit> = Result.success(Unit)

        override suspend fun toggleChannel(id: Long): Result<NotificationChannel> = Result.success(NotificationChannel.Webhook(id = 1))

        override suspend fun testWebhookChannel(
            id: Long,
            title: String?,
            message: String?,
        ): Result<WebhookTestResult> = Result.success(WebhookTestResult(success = true))

        override suspend fun previewWebhookSignature(
            secret: String,
            body: String,
        ): Result<WebhookSignaturePreviewResult> = Result.success(WebhookSignaturePreviewResult("sha256=x"))
    }
}
