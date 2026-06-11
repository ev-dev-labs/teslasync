package io.teslasync.android.dashboard.widgets.watchsummary

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.presentation.watch.WatchSummary
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [WatchSummaryWidgetContent] across every state the
 * web component renders (loading skeleton, compact gauge body, standard hero + detail grid, empty, hard
 * error with retry, stale/offline cached). Asserts the rendered i18n strings and the TalkBack content
 * descriptions are present, and that the refresh + retry controls fire. Runs under `connectedAndroidTest`
 * (a device/emulator); the offline gate's `testReleaseUnitTest` covers the projection/state logic.
 */
class WatchSummaryWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val formatter = UnitFormatter.default()

    private val compact = WatchSummarySize(cols = 1, rows = 2)
    private val standard = WatchSummarySize(cols = 2, rows = 2)

    private fun summary(
        charging: Boolean = false,
        locked: Boolean = true,
        state: String = "online",
    ): WatchSummary =
        WatchSummary(
            vehicleName = "Model 3",
            state = state,
            batteryLevel = 72.0,
            rangeKm = 312.0,
            isCharging = charging,
            isLocked = locked,
            insideTempC = 21.0,
            lastUpdated = "2026-06-11T18:25:00Z",
        )

    private fun content(
        charging: Boolean = false,
        locked: Boolean = true,
        stale: Boolean = false,
        errorKind: ErrorKind? = null,
    ): UiState<WatchView> =
        UiState(
            phase = UiPhase.Content,
            data = WatchView(summary(charging = charging, locked = locked), charging = charging),
            fetchedAt = 1L,
            stale = stale,
            errorKind = errorKind,
        )

    private fun setWidget(
        state: UiState<WatchView>,
        size: WatchSummarySize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                WatchSummaryWidgetContent(state = state, formatter = formatter, size = size, onRefresh = onRefresh)
            }
        }
    }

    @Test
    fun loadingShowsSkeletonNotContent() {
        setWidget(UiState.loading(), standard)
        compose.onNodeWithContentDescription("Loading").assertIsDisplayed()
        compose.onNodeWithText("Watch Summary").assertDoesNotExist()
        compose.onNodeWithText("Battery").assertDoesNotExist()
    }

    @Test
    fun standardContentShowsHeroGridAndLabels() {
        setWidget(content(charging = false, locked = true), standard)
        compose.onNodeWithText("Watch Summary").assertIsDisplayed()
        compose.onNodeWithText("Battery").assertIsDisplayed()
        compose.onNodeWithText("Range").assertIsDisplayed()
        compose.onNodeWithText("Lock").assertIsDisplayed()
        compose.onNodeWithText("Cabin").assertIsDisplayed()
        compose.onNodeWithText("Last Seen").assertIsDisplayed()
        compose.onNodeWithText("312 km").assertIsDisplayed()
        compose.onNodeWithText("Locked").assertIsDisplayed()
    }

    @Test
    fun compactContentShowsStateRangeAndCharging() {
        setWidget(content(charging = true, locked = true), compact)
        compose.onNodeWithText("Online").assertIsDisplayed()
        compose.onNodeWithText("312 km").assertIsDisplayed()
        compose.onNodeWithText("Charging").assertIsDisplayed()
        // Compact has no title chrome (web title-less 1-column footprint).
        compose.onNodeWithText("Watch Summary").assertDoesNotExist()
    }

    @Test
    fun headerExposesRefreshAccessibility() {
        setWidget(content(), standard)
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun emptyShowsNoWatchData() {
        setWidget(
            UiState(phase = UiPhase.Empty, data = WatchView(WatchSummary(), charging = false), fetchedAt = 1L),
            standard,
        )
        compose.onNodeWithText("No watch data").assertIsDisplayed()
        compose.onNodeWithText("Battery").assertDoesNotExist()
    }

    @Test
    fun errorShowsRetryThatFires() {
        var retried = false
        setWidget(
            UiState(phase = UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = 500),
            standard,
            onRefresh = { retried = true },
        )
        compose.onNodeWithText("Retry").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun offlineKeepsCachedContentVisible() {
        setWidget(content(stale = true, errorKind = ErrorKind.Network), standard)
        compose.onNodeWithText("312 km").assertIsDisplayed()
        compose.onNodeWithText("Battery").assertIsDisplayed()
    }
}
