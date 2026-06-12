// On-device Compose UI + accessibility verification of [TeslaAuthCardContent] across every state the surface renders:
// the loading skeleton, the hard-error retry surface, the empty state, the loaded card in each severity (connected /
// expiring-soon / expired / disconnected / unknown), and the stale/offline cached views. Asserts the rendered i18n
// strings, that the CTA fires its callback, that the stale state auto-refreshes, and that the shield icon exposes a
// TalkBack status label. Runs under `connectedAndroidTest`; the offline `testReleaseUnitTest` gate covers the pure
// logic, this covers render + a11y. Mirrors the web spec
// (web/src/features/system/components/status/TeslaAuthCard.tsx).
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.teslaauthcard

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
import java.time.Instant

class TeslaAuthCardUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val now: Instant = Instant.parse("2026-01-01T00:00:00Z")

    private fun status(
        authenticated: Boolean?,
        expiresAt: String?,
    ): TeslaAuthStatus = TeslaAuthStatus(authenticated, expiresAt)

    private fun setContent(
        state: UiState<TeslaAuthStatus>,
        onManage: () -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                TeslaAuthCardContent(state = state, onManage = onManage, onRetry = onRetry, now = now)
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
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
        setContent(UiState(UiPhase.Empty, data = null))
        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun connectedRendersTitleStatusBadgeAndManageCta() {
        setContent(UiState(UiPhase.Content, data = status(authenticated = true, expiresAt = "2999-01-01T00:00:00Z")))
        compose.onNodeWithText("Tesla Account").assertIsDisplayed()
        compose.onNodeWithText("Connected").assertIsDisplayed()
        compose.onNodeWithText("Open").assertIsDisplayed()
    }

    @Test
    fun expiringSoonShowsTokenExpiresBadgeAndCountdownDetail() {
        setContent(UiState(UiPhase.Content, data = status(authenticated = true, expiresAt = "2026-01-04T00:00:00Z")))
        compose.onNodeWithText("Token expires").assertIsDisplayed()
        compose.onNodeWithText("Expires in 3d").assertIsDisplayed()
    }

    @Test
    fun expiredShowsExpiredBadgeAndReauthorizeCtaInvokesManage() {
        var managed = false
        setContent(
            state = UiState(UiPhase.Content, data = status(authenticated = true, expiresAt = "2025-12-01T00:00:00Z")),
            onManage = { managed = true },
        )
        compose.onNodeWithText("Expired").assertIsDisplayed()
        compose.onNodeWithText("Re-authorize").performClick()
        assertTrue(managed)
    }

    @Test
    fun disconnectedShowsNotConnectedBadgeAndConnectGuidance() {
        setContent(UiState(UiPhase.Content, data = status(authenticated = false, expiresAt = null)))
        compose.onNodeWithText("Not connected").assertIsDisplayed()
        compose.onNodeWithText("Connect your Tesla account to sync vehicles and data").assertIsDisplayed()
    }

    @Test
    fun unknownShowsUnknownBadge() {
        setContent(UiState(UiPhase.Content, data = status(authenticated = true, expiresAt = null)))
        compose.onNodeWithText("Unknown").assertIsDisplayed()
    }

    @Test
    fun shieldIconExposesStatusContentDescriptionForTalkBack() {
        setContent(UiState(UiPhase.Content, data = status(authenticated = true, expiresAt = "2999-01-01T00:00:00Z")))
        compose.onNodeWithContentDescription("Connected").assertIsDisplayed()
    }

    @Test
    fun offlineShowsCachedContentWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = status(authenticated = true, expiresAt = "2999-01-01T00:00:00Z"),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Tesla Account").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertIsDisplayed()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = status(authenticated = true, expiresAt = "2999-01-01T00:00:00Z"),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Tesla Account").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
