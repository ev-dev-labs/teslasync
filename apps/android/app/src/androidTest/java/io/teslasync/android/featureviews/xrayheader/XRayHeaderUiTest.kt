package io.teslasync.android.featureviews.xrayheader

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
 * On-device Compose UI + accessibility verification of [XRayHeaderContent] across every state the surface
 * renders: the loading skeleton, the hard-error retry surface, the empty (zero-sample) strip with its
 * friendly hint, the populated three-card strip, and the stale/offline cached views. Asserts the rendered
 * i18n strings and the TalkBack content descriptions are present. Runs under `connectedAndroidTest`; the
 * offline gate's `testReleaseUnitTest` covers the pure logic, this covers render + a11y. Mirrors the web
 * spec (web/src/features/admin/components/ingest-xray/XRayHeader.tsx).
 */
class XRayHeaderUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<IngestXRaySummary>,
        window: XRayWindow = XRayWindow.H1,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                XRayHeaderContent(
                    state = state,
                    window = window,
                    onRetry = onRetry,
                    locale = Locale.US,
                )
            }
        }
    }

    private fun summary(): IngestXRaySummary = IngestXRaySummary(totalSamples = 124_530, uniqueFields = 87)

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
    fun contentRendersAllThreeCardsWithFormattedValuesAndWindowLabel() {
        setContent(UiState(UiPhase.Content, data = summary()), window = XRayWindow.H1)
        compose.onNodeWithText("Total samples").assertIsDisplayed()
        compose.onNodeWithText("124,530").assertIsDisplayed()
        compose.onNodeWithText("Distinct fields").assertIsDisplayed()
        compose.onNodeWithText("87").assertIsDisplayed()
        compose.onNodeWithText("Window").assertIsDisplayed()
        compose.onNodeWithText("1 hour").assertIsDisplayed()
    }

    @Test
    fun emptyShowsZeroValuedCardsWithFriendlyHint() {
        setContent(
            UiState(UiPhase.Empty, data = IngestXRaySummary(totalSamples = 0, uniqueFields = 0)),
            window = XRayWindow.M15,
        )
        compose.onNodeWithText("Total samples").assertIsDisplayed()
        compose.onNodeWithText("15 minutes").assertIsDisplayed()
        compose.onNodeWithText("No samples in this window", substring = true).assertIsDisplayed()
    }

    @Test
    fun offlineShowsCachedContentWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = summary(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("124,530").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertIsDisplayed()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = summary(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("124,530").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
