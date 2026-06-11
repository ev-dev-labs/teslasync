package io.teslasync.android.dashboard.widgets.securitystatus

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.R
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [SecurityStatusWidgetContent] across every state the
 * web component renders (loading skeleton, status grid, empty, hard error with retry, stale/offline cached).
 * Asserts the rendered i18n strings and the per-cell TalkBack content descriptions are present, and that the
 * refresh control fires. Runs under `connectedAndroidTest` (a device/emulator) — the offline gate's
 * `testReleaseUnitTest` covers the projection/state logic; this covers the render.
 */
class SecurityStatusWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun security(): JsonElement =
        buildJsonObject {
            put("locked", true)
            put("sentry_mode", true)
            put("door_state", "df_closed")
            put("fd_window", "open")
            put("fp_window", "closed")
            put("rd_window", "closed")
            put("rp_window", "closed")
        }

    @Composable
    private fun securityStrings(): SecurityStatusStrings =
        SecurityStatusStrings(
            security = stringResource(R.string.translation_widget_security),
            lock = stringResource(R.string.translation_widget_lock),
            locked = stringResource(R.string.translation_widget_locked),
            unlocked = stringResource(R.string.translation_widget_unlocked),
            sentry = stringResource(R.string.translation_widget_sentry),
            active = stringResource(R.string.translation_widget_active),
            off = stringResource(R.string.translation_widget_off),
            doors = stringResource(R.string.translation_widget_doors),
            windows = stringResource(R.string.translation_widget_windows),
            allClosed = stringResource(R.string.translation_widget_allClosed),
            open = stringResource(R.string.translation_widget_open),
        )

    private fun setWidget(
        state: UiState<JsonElement>,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SecurityStatusWidgetContent(state = state, strings = securityStrings(), onRefresh = onRefresh)
            }
        }
    }

    private fun contentState(): UiState<JsonElement> = UiState(phase = UiPhase.Content, data = security(), fetchedAt = 1L)

    @Test
    fun loadingShowsSkeletonNotCells() {
        setWidget(UiState.loading())
        compose.onNodeWithContentDescription("Loading").assertIsDisplayed()
        compose.onNodeWithText("Lock").assertDoesNotExist()
        compose.onNodeWithText("No security data").assertDoesNotExist()
    }

    @Test
    fun contentShowsGridLabelsAndValues() {
        setWidget(contentState())
        compose.onNodeWithText("Lock").assertIsDisplayed()
        compose.onNodeWithText("Locked").assertIsDisplayed()
        compose.onNodeWithText("Sentry").assertIsDisplayed()
        compose.onNodeWithText("Active").assertIsDisplayed()
        compose.onNodeWithText("Doors").assertIsDisplayed()
        compose.onNodeWithText("All Closed").assertIsDisplayed()
        compose.onNodeWithText("Windows").assertIsDisplayed()
        compose.onNodeWithText("1 Open").assertIsDisplayed()
    }

    @Test
    fun headerExposesTitleAndRefreshAccessibility() {
        setWidget(contentState())
        compose.onNodeWithText("Security").assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun cellsExposeMergedTalkBackLabels() {
        setWidget(contentState())
        compose.onNodeWithContentDescription("Lock, Locked").assertIsDisplayed()
        compose.onNodeWithContentDescription("Windows, 1 Open").assertIsDisplayed()
    }

    @Test
    fun emptyShowsNoSecurityData() {
        setWidget(UiState(phase = UiPhase.Empty, data = JsonNull, fetchedAt = 1L))
        compose.onNodeWithText("No security data").assertIsDisplayed()
        compose.onNodeWithText("Lock").assertDoesNotExist()
    }

    @Test
    fun errorShowsEmptyBodyWithRefreshRetry() {
        var refreshed = false
        setWidget(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network), onRefresh = { refreshed = true })
        compose.onNodeWithText("No security data").assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").performClick()
        assertTrue(refreshed)
    }

    @Test
    fun offlineKeepsCachedCellsVisible() {
        setWidget(
            UiState(
                phase = UiPhase.Content,
                data = security(),
                fetchedAt = 1L,
                stale = true,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Locked").assertIsDisplayed()
        compose.onNodeWithText("1 Open").assertIsDisplayed()
    }
}
