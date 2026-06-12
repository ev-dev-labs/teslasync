package io.teslasync.android.featureviews.appearancesettings

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [AppearanceSettingsContent] across every state the web
 * component renders: the header + every section in the loaded editor, the skeleton-vs-pickers loading split,
 * the empty document still showing the editor with defaults, the hard-error retry surface (keeping the local
 * sections usable), the device-local pref toggles firing, and the TalkBack content descriptions on interactive
 * controls. Runs under `connectedAndroidTest` (a device/emulator) — the offline gate's `testReleaseUnitTest`
 * covers the projection/state logic; this covers the render + a11y.
 */
class AppearanceSettingsUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun contentState(present: Boolean = true): UiState<AppearanceServerPrefs> =
        UiState(
            phase = if (present) UiPhase.Content else UiPhase.Empty,
            data =
                AppearanceServerPrefs(
                    density = DensityId.Comfortable,
                    timeFormat = TimeFormatId.Relative,
                    chartPalette = ChartPaletteId.CbSafe,
                    present = present,
                ),
            fetchedAt = 1L,
        )

    private fun setContent(
        state: UiState<AppearanceServerPrefs>,
        statusBar: StatusBarPrefs = StatusBarPrefs(),
        celebration: CelebrationPrefs = CelebrationPrefs(),
        sidebarStyle: SidebarStyle = SidebarStyle.Linear,
        onDensityChange: (DensityId) -> Unit = {},
        onStatusBarEnabledChange: (Boolean) -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AppearanceSettingsContent(
                    serverState = state,
                    statusBar = statusBar,
                    celebration = celebration,
                    sidebarStyle = sidebarStyle,
                    saving = false,
                    onDensityChange = onDensityChange,
                    onStatusBarEnabledChange = onStatusBarEnabledChange,
                    onRetry = onRetry,
                )
            }
        }
    }

    @Test
    fun contentRendersHeaderAndEverySection() {
        setContent(contentState())
        compose.onNodeWithText("Appearance").assertIsDisplayed()
        compose.onNodeWithText("Information density").assertIsDisplayed()
        compose.onNodeWithText("Spacious").assertIsDisplayed()
        // Sidebar style labels resolve through the by-name i18n fallback (catalog-absent keys).
        compose.onNodeWithText("Minimal").assertIsDisplayed()
        compose.onNodeWithText("Classic").assertIsDisplayed()
        compose.onNodeWithText("Relative (2h ago)").assertIsDisplayed()
        compose.onNodeWithText("Chart palette").assertIsDisplayed()
        compose.onNodeWithText("Show status bar").assertIsDisplayed()
        compose.onNodeWithText("Celebration").assertIsDisplayed()
        compose.onNodeWithText("Replay dashboard tour").assertIsDisplayed()
        compose.onNodeWithText("Reset all tours").assertIsDisplayed()
    }

    @Test
    fun loadingShowsSkeletonsNotPickersButKeepsLocalSections() {
        setContent(UiState.loading())
        // Server-backed pickers are skeletons while the document loads.
        compose.onNodeWithText("Spacious").assertDoesNotExist()
        compose.onNodeWithText("Relative (2h ago)").assertDoesNotExist()
        // Device-local sections always render.
        compose.onNodeWithText("Show status bar").assertIsDisplayed()
        compose.onNodeWithText("Minimal").assertIsDisplayed()
    }

    @Test
    fun emptyDocumentStillRendersTheEditorWithDefaults() {
        setContent(contentState(present = false))
        compose.onNodeWithText("Information density").assertIsDisplayed()
        compose.onNodeWithText("Spacious").assertIsDisplayed()
    }

    @Test
    fun hardErrorShowsRetryAndKeepsHeaderAndLocalSections() {
        var refreshed = false
        setContent(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { refreshed = true })
        compose.onNodeWithText("Appearance").assertIsDisplayed()
        compose.onNodeWithText("Spacious").assertDoesNotExist()
        compose.onNodeWithText("Show status bar").assertIsDisplayed()
        compose.onAllNodesWithText("Retry").onFirst().performClick()
        assertTrue(refreshed)
    }

    @Test
    fun densityChoiceClickFiresCallback() {
        var picked: DensityId? = null
        setContent(contentState(), onDensityChange = { picked = it })
        compose.onNodeWithText("Spacious").performClick()
        assertEquals(DensityId.Spacious, picked)
    }

    @Test
    fun statusBarToggleExposesItsLabelForTalkBack() {
        setContent(contentState())
        compose.onNodeWithContentDescription("Show status bar").assertIsDisplayed()
        compose.onNodeWithContentDescription("Always icon-only").assertIsDisplayed()
    }

    @Test
    fun statusBarToggleFiresCallback() {
        var enabled: Boolean? = null
        setContent(contentState(), onStatusBarEnabledChange = { enabled = it })
        compose.onNodeWithContentDescription("Show status bar").performClick()
        assertEquals(false, enabled)
    }
}
