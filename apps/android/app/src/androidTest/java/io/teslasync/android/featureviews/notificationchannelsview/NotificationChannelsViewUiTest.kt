package io.teslasync.android.featureviews.notificationchannelsview

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
import io.teslasync.shared.core.presentation.notifications.ChannelTestResult
import io.teslasync.shared.core.presentation.notifications.NotificationChannelInput
import io.teslasync.shared.core.presentation.notifications.NotificationStats
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the NotificationChannels surface across every state it
 * renders: the loading skeleton chrome, the hard-error retry surface, the no-channels empty state, the populated
 * stats tiles + channel cards (with their action affordances + TalkBack labels), the stale/offline cached view,
 * and the create modal opened from the Add affordance. The offline gate's `testReleaseUnitTest` covers the pure
 * logic + view-model; this covers render + a11y. Mirrors the web spec
 * (web/src/features/notifications/components/NotificationChannelsView.tsx).
 */
class NotificationChannelsViewUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun channels(): List<NotificationChannel> =
        listOf(
            NotificationChannel.Discord(id = 1, name = "Ops Discord", enabled = true, webhookUrl = "https://discord/x"),
            NotificationChannel.Email(
                id = 2,
                name = "Email alerts",
                enabled = false,
                smtpHost = "smtp.example.com",
                smtpPort = 587,
                smtpUsername = "u@example.com",
                smtpPassword = "secret",
                fromAddress = "from@example.com",
                toAddresses = listOf("you@example.com"),
                useTls = true,
            ),
        )

    private fun stats() = NotificationStats(totalSent = 1300, sent = 1240, failed = 12, pending = 3, totalChannels = 4, enabledChannels = 3)

    private fun setContent(
        channelsState: UiState<List<NotificationChannel>>,
        statsState: UiState<NotificationStats>,
        testingChannelId: Long? = null,
        onToggle: (NotificationChannel) -> Unit = {},
        onTest: (NotificationChannel) -> Unit = {},
        onEdit: (NotificationChannel) -> Unit = {},
        onDelete: (NotificationChannel) -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                NotificationChannelsViewContent(
                    channelsState = channelsState,
                    statsState = statsState,
                    testingChannelId = testingChannelId,
                    onAddClick = {},
                    onToggle = onToggle,
                    onTest = onTest,
                    onEdit = onEdit,
                    onDelete = onDelete,
                    onRetry = onRetry,
                )
            }
        }
    }

    @Test
    fun loadingShowsAddAffordanceAndAccessibleSkeletonNotABlankPanel() {
        setContent(UiState(UiPhase.Loading), UiState(UiPhase.Loading))
        compose.onNodeWithText("Add Channel").assertIsDisplayed()
        compose.onAllNodesWithContentDescription("Loading").onFirst().assertExists()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(
            channelsState = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            statsState = UiState(UiPhase.Content, stats()),
            onRetry = { retried = true },
        )
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsFriendlyNoChannelsMessage() {
        setContent(UiState(UiPhase.Empty, emptyList()), UiState(UiPhase.Content, stats()))
        compose.onNodeWithText("No channels configured").assertIsDisplayed()
        compose.onNodeWithText("Add Channel").assertIsDisplayed()
    }

    @Test
    fun contentRendersStatsCardsBadgesAndAccessibleStatIcons() {
        setContent(UiState(UiPhase.Content, channels()), UiState(UiPhase.Content, stats()))
        // Stats tiles (labels + the active ratio value).
        compose.onNodeWithText("Total Sent").assertIsDisplayed()
        compose.onNodeWithText("Failed").assertIsDisplayed()
        compose.onNodeWithText("Pending").assertIsDisplayed()
        compose.onNodeWithText("Active Channels").assertIsDisplayed()
        compose.onNodeWithText("3/4").assertIsDisplayed()
        // Channel cards.
        compose.onNodeWithText("Ops Discord").assertIsDisplayed()
        compose.onNodeWithText("Email alerts").assertIsDisplayed()
        compose.onNodeWithText("Active").assertIsDisplayed()
        compose.onNodeWithText("Disabled").assertIsDisplayed()
        // Accessibility: every stat icon is announced with its label.
        compose.onNodeWithContentDescription("Total Sent").assertExists()
    }

    @Test
    fun cardActionsInvokeCallbacksAndDeleteHasAccessibleLabel() {
        var tested: Long? = null
        var edited: Long? = null
        var deleted: Long? = null
        val single =
            listOf(
                NotificationChannel.Discord(id = 9, name = "Solo", enabled = true, webhookUrl = "https://x"),
            )
        setContent(
            channelsState = UiState(UiPhase.Content, single),
            statsState = UiState(UiPhase.Content, stats()),
            onTest = { tested = it.id },
            onEdit = { edited = it.id },
            onDelete = { deleted = it.id },
        )
        compose.onNodeWithContentDescription("Delete").assertExists()
        compose.onNodeWithText("Test").performClick()
        compose.onNodeWithText("Edit").performClick()
        compose.onNodeWithContentDescription("Delete").performClick()
        assertTrue(tested == 9L && edited == 9L && deleted == 9L)
    }

    @Test
    fun offlineShowsCachedContentWithOfflineChip() {
        setContent(
            channelsState =
                UiState(
                    phase = UiPhase.Content,
                    data = channels(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            statsState = UiState(UiPhase.Content, stats()),
        )
        compose.onNodeWithText("Ops Discord").assertIsDisplayed()
        compose.onAllNodesWithContentDescription("Offline").onFirst().assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            channelsState =
                UiState(
                    phase = UiPhase.Content,
                    data = channels(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            statsState = UiState(UiPhase.Content, stats()),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Ops Discord").assertIsDisplayed()
        assertTrue(refreshed)
    }

    @Test
    fun addAffordanceOpensCreateModalWithTypeSelector() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                val vm =
                    remember {
                        NotificationChannelsViewModel(
                            source = FakeUiSource(),
                            logger = SilentLogger,
                            scope = null,
                        )
                    }
                NotificationChannelsView(viewModel = vm)
            }
        }
        compose.onNodeWithText("Add Channel").performClick()
        // The create modal: type selector label, the type chips, and the Create action.
        compose.onNodeWithText("Channel Type").assertIsDisplayed()
        compose.onNodeWithContentDescription("Discord").assertExists()
        compose.onNodeWithText("Create").assertIsDisplayed()
    }

    private object SilentLogger : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

    private class FakeUiSource : NotificationChannelsViewSource {
        override fun channels(): Flow<Resource<List<NotificationChannel>>> = flowOf(Resource.Success(emptyList(), 1L, false))

        override fun stats(): Flow<Resource<NotificationStats>> = flowOf(Resource.Loading(null, null, false))

        override suspend fun saveChannel(input: NotificationChannelInput): Result<NotificationChannel> =
            Result.success(NotificationChannel.Discord(id = 1))

        override suspend fun deleteChannel(id: Long): Result<Unit> = Result.success(Unit)

        override suspend fun toggleChannel(id: Long): Result<NotificationChannel> = Result.success(NotificationChannel.Discord(id = 1))

        override suspend fun testChannel(id: Long): Result<ChannelTestResult> = Result.success(ChannelTestResult(success = true))
    }
}
