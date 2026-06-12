package io.teslasync.android.featureviews.signalhistorytable

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
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.ZoneOffset
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [SignalHistoryTableContent] across every state the
 * surface renders: the loading skeleton, the hard-error retry surface, the empty state, the populated table
 * (color-coded signal / formatted value / type badge), the raw-payload row expansion, and the stale/offline
 * cached views. Asserts the rendered i18n strings, the header meta badge, the expand-toggle reveal, and that
 * the pagination control carries a TalkBack label. Runs under `connectedAndroidTest`; the offline gate's
 * `testReleaseUnitTest` covers the pure model. Mirrors the web spec
 * (web/src/features/telemetry/components/SignalHistoryTable.tsx).
 */
class SignalHistoryTableUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<SignalHistoryData>,
        onPageChange: (Int) -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SignalHistoryTableContent(
                    state = state,
                    onPageChange = onPageChange,
                    onRetry = onRetry,
                    locale = Locale.US,
                    zoneId = ZoneOffset.UTC,
                )
            }
        }
    }

    private fun data(): SignalHistoryData =
        SignalHistoryData(
            rows =
                listOf(
                    SignalLogEntry("2026-06-11T11:59:40Z", "VehicleSpeed", valueNum = 64.0),
                    SignalLogEntry("2026-06-11T11:59:38Z", "Gear", valueStr = "D"),
                    SignalLogEntry("2026-06-11T11:59:36Z", "Locked", valueBool = true),
                ),
            selectedSignals = listOf("VehicleSpeed", "Gear", "Locked"),
            page = 1,
            pageSize = 50,
            totalRows = 128,
        )

    @Test
    fun titleAndAllColumnHeadersAreDisplayed() {
        setContent(UiState(UiPhase.Content, data = data()))
        compose.onNodeWithText("Signal Log").assertIsDisplayed()
        compose.onNodeWithText("Timestamp").assertIsDisplayed()
        compose.onNodeWithText("Signal").assertIsDisplayed()
        compose.onNodeWithText("Value").assertIsDisplayed()
        compose.onNodeWithText("Type").assertIsDisplayed()
    }

    @Test
    fun headerMetaShowsPageAndTotal() {
        setContent(UiState(UiPhase.Content, data = data()))
        compose.onNodeWithText("Page 1", substring = true).assertIsDisplayed()
    }

    @Test
    fun dataRendersSignalValueAndTypeBadgeCells() {
        setContent(UiState(UiPhase.Content, data = data()))
        compose.onNodeWithText("VehicleSpeed").assertIsDisplayed()
        compose.onNodeWithText("64").assertIsDisplayed()
        compose.onNodeWithText("D").assertIsDisplayed()
        compose.onNodeWithText("true").assertIsDisplayed()
        // Type badges (web TYPE_BADGE_VARIANT keys, rendered verbatim).
        compose.onNodeWithText("number").assertIsDisplayed()
        compose.onNodeWithText("string").assertIsDisplayed()
        compose.onNodeWithText("boolean").assertIsDisplayed()
    }

    @Test
    fun expandToggleRevealsRawPayload() {
        setContent(UiState(UiPhase.Content, data = data()))
        compose.onAllNodesWithContentDescription("Details").onFirst().performClick()
        compose.onNodeWithText("\"created_at\"", substring = true).assertIsDisplayed()
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
    fun emptyShowsNoDataMessage() {
        setContent(UiState(UiPhase.Empty, data = SignalHistoryData.EMPTY))
        compose.onNodeWithText("No signal data available").assertIsDisplayed()
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
        compose.onNodeWithText("64").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertIsDisplayed()
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
        compose.onNodeWithText("64").assertIsDisplayed()
        assertTrue(refreshed)
    }

    @Test
    fun paginationControlIsLabeledForAccessibility() {
        setContent(UiState(UiPhase.Content, data = data()))
        compose.onNodeWithContentDescription("First page").assertIsDisplayed()
    }
}
