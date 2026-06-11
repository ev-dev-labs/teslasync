package io.teslasync.android.dashboard.widgets.versioninfo

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
 * On-device Compose UI + accessibility verification of [VersionInfoWidgetContent] across every state the web
 * component renders (loading skeleton, hard error + retry, standard definition rows with title + refresh,
 * compact version + SHA badge without a title, wide stat tiles + OS/Arch line, no-version empty, stale/
 * offline cached). Asserts the rendered i18n strings and the per-row TalkBack content descriptions are
 * present. Runs under `connectedAndroidTest` (a device/emulator) — the offline `testReleaseUnitTest` gate
 * covers the projection + state logic; this covers render + a11y.
 */
class VersionInfoWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val standardSize = VersionInfoRegistration.defaultSize
    private val wideSize = VersionInfoSize(cols = 4, rows = 4)
    private val compactSize = VersionInfoSize(cols = 1, rows = 2)

    private fun populatedState(): VersionInfoState =
        VersionInfoState(
            version =
                VersionFields(
                    chartVersion = "1.4.2",
                    buildDate = "2026-01-15",
                    gitSha = "abcdef1",
                    goVersion = "go1.25",
                    uptime = "3h12m",
                    os = "linux",
                    arch = "amd64",
                ),
            capture = CaptureFields(signalsPerSec = 12.34, messagesToday = 1234, bytesProcessed = 1536, avgLatencyMs = 5.67),
        )

    private fun setContent(
        state: UiState<VersionInfoState>,
        size: VersionInfoSize = standardSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                VersionInfoWidgetContent(
                    state = state,
                    size = size,
                    onRefresh = onRefresh,
                    locale = Locale.US,
                )
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRefresh() {
        var retried = false
        setContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRefresh = { retried = true },
        )
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun standardContentShowsTitleAndDefinitionRows() {
        setContent(UiState(UiPhase.Content, data = populatedState(), fetchedAt = NOW))
        compose.onNodeWithText("Version Info").assertIsDisplayed()
        // Each definition row folds its label + value into one TalkBack phrase.
        compose.onNodeWithContentDescription("Version, 1.4.2").assertIsDisplayed()
        compose.onNodeWithContentDescription("Build Date, 2026-01-15").assertIsDisplayed()
        compose.onNodeWithContentDescription("Git SHA, abcdef1").assertIsDisplayed()
        compose.onNodeWithContentDescription("Go Version, go1.25").assertIsDisplayed()
        compose.onNodeWithContentDescription("Uptime, 3h12m").assertIsDisplayed()
    }

    @Test
    fun standardContentExposesRefreshAction() {
        setContent(UiState(UiPhase.Content, data = populatedState(), fetchedAt = NOW))
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun standardContentShowsBaseStatTiles() {
        setContent(UiState(UiPhase.Content, data = populatedState(), fetchedAt = NOW))
        compose.onNodeWithText("Signals/sec").assertIsDisplayed()
        compose.onNodeWithText("Messages Today").assertIsDisplayed()
    }

    @Test
    fun wideContentAddsExtraTilesAndOsArchLine() {
        setContent(UiState(UiPhase.Content, data = populatedState(), fetchedAt = NOW), size = wideSize)
        compose.onNodeWithText("Bytes Processed").assertIsDisplayed()
        compose.onNodeWithText("Avg Latency").assertIsDisplayed()
        compose.onNodeWithText("OS: linux").assertIsDisplayed()
        compose.onNodeWithText("Arch: amd64").assertIsDisplayed()
    }

    @Test
    fun compactContentShowsVersionAndSha() {
        setContent(UiState(UiPhase.Content, data = populatedState(), fetchedAt = NOW), size = compactSize)
        compose.onNodeWithText("1.4.2").assertIsDisplayed()
        compose.onNodeWithText("abcdef1").assertIsDisplayed()
    }

    @Test
    fun emptyWithoutVersionShowsNoDataMessage() {
        setContent(UiState(UiPhase.Empty, data = VersionInfoState(version = null, capture = CaptureFields.ZERO), fetchedAt = NOW))
        compose.onNodeWithText("No version data available").assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedContentVisible() {
        setContent(
            UiState(
                UiPhase.Content,
                data = populatedState(),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached rows stay visible (never blanked) when offline/stale.
        compose.onNodeWithContentDescription("Git SHA, abcdef1").assertIsDisplayed()
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
    }
}
