package io.teslasync.android.featureviews.teslaaccountsection

import androidx.compose.runtime.remember
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.settings.AuthStatus
import io.teslasync.shared.core.presentation.settings.AuthUrlResult
import io.teslasync.shared.core.presentation.settings.SyncVehiclesResult
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.Instant

/**
 * On-device Compose UI + accessibility verification of the TeslaAccountSection surface across every state
 * it renders: the loading skeleton chrome, the hard-error retry surface, the Connected content (with the
 * "Expires in Nd" soft-warning pill + the manage actions and their TalkBack labels), the Not-connected and
 * Disconnected (re-auth) content, the inline synced-count line, and the stale/offline cached view. The
 * offline gate's `testReleaseUnitTest` covers the pure logic + view-model; this covers render + a11y.
 * Mirrors the web spec (web/src/features/settings/components/TeslaAccountSection.tsx).
 */
class TeslaAccountSectionUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val fixedNow: Long = Instant.parse("2026-06-01T00:00:00Z").toEpochMilli()

    private fun authed(expiresAt: String? = "2027-01-01T00:00:00Z"): AuthStatus = AuthStatus(authenticated = true, expiresAt = expiresAt)

    private fun setContent(
        authStatus: UiState<AuthStatus>,
        reauthNeeded: Boolean = false,
        actions: TeslaAccountActions = TeslaAccountActions(),
        syncedCount: Int? = null,
        onConnect: () -> Unit = {},
        onRefreshToken: () -> Unit = {},
        onSyncVehicles: () -> Unit = {},
        onDisconnect: () -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                TeslaAccountSectionContent(
                    authStatus = authStatus,
                    reauthNeeded = reauthNeeded,
                    actions = actions,
                    syncedCount = syncedCount,
                    onConnect = onConnect,
                    onRefreshToken = onRefreshToken,
                    onSyncVehicles = onSyncVehicles,
                    onDisconnect = onDisconnect,
                    onRetry = onRetry,
                    nowMs = fixedNow,
                )
            }
        }
    }

    @Test
    fun loadingShowsHeaderAndAccessibleSkeletonNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText("Tesla Account").assertIsDisplayed()
        compose.onAllNodesWithContentDescription("Loading").onFirst().assertExists()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Tesla Account").assertIsDisplayed()
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun connectedContentRendersStatusManageActionsAndExpiryLine() {
        setContent(UiState(UiPhase.Content, authed()))
        compose.onNodeWithText("Tesla Account").assertIsDisplayed()
        compose.onNodeWithText("Connect your Tesla account to sync vehicles and data").assertIsDisplayed()
        compose.onNodeWithText("Connected").assertIsDisplayed()
        compose.onNodeWithText("Token expires", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Refresh Token").assertIsDisplayed()
        compose.onNodeWithText("Sync Vehicles").assertIsDisplayed()
        compose.onNodeWithText("Re-authorize").assertIsDisplayed()
        compose.onNodeWithText("Disconnect").assertIsDisplayed()
    }

    @Test
    fun connectedWithSoonExpiryShowsTheExpiringPill() {
        val soon = Instant.ofEpochMilli(fixedNow + TeslaAccountView.DAY_MS * 3).toString()
        setContent(UiState(UiPhase.Content, authed(expiresAt = soon)))
        compose.onNodeWithText("Connected").assertIsDisplayed()
        compose.onNodeWithText("Expires in 3d").assertIsDisplayed()
    }

    @Test
    fun notConnectedShowsConnectActionOnly() {
        setContent(UiState(UiPhase.Content, AuthStatus(authenticated = false)))
        compose.onNodeWithText("Not connected").assertIsDisplayed()
        compose.onNodeWithText("Connect Tesla Account").assertIsDisplayed()
    }

    @Test
    fun disconnectedReauthShowsExpiredCopy() {
        setContent(UiState(UiPhase.Content, authed()), reauthNeeded = true)
        compose.onNodeWithText("Disconnected").assertIsDisplayed()
        compose.onNodeWithText("Reconnect to resume live data and commands.").assertIsDisplayed()
    }

    @Test
    fun syncedLineRendersTheCount() {
        setContent(UiState(UiPhase.Content, authed()), syncedCount = 2)
        compose.onNodeWithText("Synced 2 vehicle(s).").assertIsDisplayed()
    }

    @Test
    fun connectInvokesCallback() {
        var connected = false
        setContent(UiState(UiPhase.Content, AuthStatus(authenticated = false)), onConnect = { connected = true })
        compose.onNodeWithText("Connect Tesla Account").performClick()
        assertTrue(connected)
    }

    @Test
    fun disconnectInvokesCallback() {
        var requested = false
        setContent(UiState(UiPhase.Content, authed()), onDisconnect = { requested = true })
        compose.onNodeWithText("Disconnect").performClick()
        assertTrue(requested)
    }

    @Test
    fun offlineShowsCachedContentWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = authed(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Connected").assertIsDisplayed()
        compose.onAllNodesWithContentDescription("Offline").onFirst().assertExists()
    }

    @Test
    fun stableEntryBindsViewModelAndRendersPanel() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                val vm =
                    remember {
                        TeslaAccountSectionViewModel(
                            source = FakeUiSource(),
                            logger = SilentLogger,
                            scope = null,
                        )
                    }
                TeslaAccountSection(viewModel = vm, onOpenUrl = {})
            }
        }
        compose.onNodeWithText("Tesla Account").assertIsDisplayed()
        compose.onNodeWithText("Refresh Token").assertIsDisplayed()
    }

    private fun state(
        phase: UiPhase,
        errorKind: ErrorKind? = null,
    ): UiState<AuthStatus> = UiState(phase = phase, errorKind = errorKind)

    private object SilentLogger : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

    private class FakeUiSource : TeslaAccountSource {
        override fun authStatus(): Flow<Resource<AuthStatus>> =
            flowOf(Resource.Success(AuthStatus(authenticated = true, expiresAt = "2027-01-01T00:00:00Z"), 1L, false))

        override fun reauthNeeded(): Flow<Boolean> = flowOf(false)

        override suspend fun authUrl(): Result<AuthUrlResult> = Result.success(AuthUrlResult(authUrl = "https://example/auth"))

        override suspend fun refreshAuth(): Result<Unit> = Result.success(Unit)

        override suspend fun disconnectAuth(): Result<Unit> = Result.success(Unit)

        override suspend fun syncVehicles(): Result<SyncVehiclesResult> = Result.success(SyncVehiclesResult(synced = 1))
    }
}
