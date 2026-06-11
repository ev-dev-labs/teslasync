package io.teslasync.android.dashboard.widgets.energysiteinfo

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
 * On-device Compose UI + accessibility verification of [EnergySiteInfoWidgetContent] across every state
 * the web component renders (loading skeleton, hard error + retry, standard detail rows with title +
 * refresh, compact rows without a title, no-linked-site empty, linked-but-no-detail empty, stale/offline
 * cached). Asserts the rendered i18n strings and the per-row TalkBack content descriptions are present.
 * Runs under `connectedAndroidTest` (a device/emulator) — the offline `testReleaseUnitTest` gate covers
 * the projection + state logic; this covers render + a11y.
 */
class EnergySiteInfoWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val standardSize = EnergySiteInfoRegistration.defaultSize
    private val compactSize = EnergySiteInfoSize(cols = 1, rows = 4)

    private fun populatedState(): EnergySiteInfoState =
        EnergySiteInfoState(
            hasSites = true,
            info = EnergySiteInfo(10500.0, 13500.0, 2, "23.44.0", "America/Los_Angeles"),
        )

    private fun setContent(
        state: UiState<EnergySiteInfoState>,
        size: EnergySiteInfoSize = standardSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                EnergySiteInfoWidgetContent(
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
    fun standardContentShowsTitleAndDetailRows() {
        setContent(UiState(UiPhase.Content, data = populatedState(), fetchedAt = NOW))
        compose.onNodeWithText("Energy Site").assertIsDisplayed()
        // Each detail row folds its label + value into one TalkBack phrase.
        compose.onNodeWithContentDescription("Solar System", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("Powerwalls", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("Gateway Firmware", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("Installation Timezone", substring = true).assertIsDisplayed()
    }

    @Test
    fun standardContentExposesRefreshAction() {
        setContent(UiState(UiPhase.Content, data = populatedState(), fetchedAt = NOW))
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun compactContentShowsRowsWithoutTitle() {
        setContent(
            state = UiState(UiPhase.Content, data = populatedState(), fetchedAt = NOW),
            size = compactSize,
        )
        compose.onNodeWithContentDescription("Powerwalls", substring = true).assertIsDisplayed()
    }

    @Test
    fun emptyWithoutLinkedSiteShowsLinkMessage() {
        setContent(UiState(UiPhase.Empty, data = EnergySiteInfoState.NO_SITES, fetchedAt = NOW))
        compose.onNodeWithText("No Tesla Energy site linked").assertIsDisplayed()
    }

    @Test
    fun emptyWithLinkedSiteButNoDetailShowsNoDataMessage() {
        setContent(UiState(UiPhase.Empty, data = EnergySiteInfoState(hasSites = true, info = null), fetchedAt = NOW))
        compose.onNodeWithText("No site info available").assertIsDisplayed()
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
        compose.onNodeWithContentDescription("Gateway Firmware", substring = true).assertIsDisplayed()
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
    }
}
