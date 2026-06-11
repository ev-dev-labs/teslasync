package io.teslasync.android.dashboard.widgets.subscriptions

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
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
 * On-device Compose UI + accessibility verification of [SubscriptionsWidgetContent] across every state the web
 * component renders (loading skeleton, hard error + retry, standard detail rows with title + refresh + the
 * Active/Expired badges, the compact active-count hero, the no-subscriptions empty, stale/offline cached).
 * Asserts the rendered i18n strings and the per-row + hero TalkBack content descriptions are present. Runs
 * under `connectedAndroidTest` (a device/emulator) — the offline `testReleaseUnitTest` gate covers the
 * projection + state logic; this covers render + a11y.
 */
class SubscriptionsWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val standardSize = SubscriptionsRegistration.defaultSize
    private val compactSize = SubscriptionsSize(cols = 1, rows = 4)

    /** Envelope with one active (future) + one expired (past) subscription, relative to [NOW]. */
    private fun populatedEnvelope(): JsonElement =
        buildJsonObject {
            put(
                "data",
                buildJsonObject {
                    put("premium_connectivity", true)
                    put("premium_connectivity_expiry_date", "2025-06-01")
                    put("full_self_driving", true)
                    put("full_self_driving_expiry_date", "2024-06-01")
                },
            )
        }

    private fun setContent(
        state: UiState<JsonElement>,
        size: SubscriptionsSize = standardSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SubscriptionsWidgetContent(
                    state = state,
                    size = size,
                    onRefresh = onRefresh,
                    nowMillis = NOW,
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
    fun standardContentShowsTitleRowsAndBadges() {
        setContent(UiState(UiPhase.Content, data = populatedEnvelope(), fetchedAt = NOW))
        compose.onNodeWithText("Subscriptions").assertIsDisplayed()
        // Each detail row folds name + value + badge into one TalkBack phrase.
        compose.onNodeWithContentDescription("Premium Connectivity, Jun 1, 2025, Active", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("Full Self-Driving, Jun 1, 2024, Expired", substring = true).assertIsDisplayed()
    }

    @Test
    fun standardContentExposesRefreshAction() {
        setContent(UiState(UiPhase.Content, data = populatedEnvelope(), fetchedAt = NOW))
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun compactContentShowsActiveCountHero() {
        setContent(
            state = UiState(UiPhase.Content, data = populatedEnvelope(), fetchedAt = NOW),
            size = compactSize,
        )
        // Hero folds active count + soonest expiry into one phrase (1 active, soonest expiry Jun 1, 2025).
        compose.onNodeWithContentDescription("1 active, Jun 1, 2025", substring = true).assertIsDisplayed()
    }

    @Test
    fun emptyShowsNoSubscriptionsMessage() {
        setContent(UiState(UiPhase.Empty, data = JsonNull, fetchedAt = NOW))
        compose.onNodeWithText("No subscriptions").assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedContentVisible() {
        setContent(
            UiState(
                UiPhase.Content,
                data = populatedEnvelope(),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached rows stay visible (never blanked) when offline/stale.
        compose.onNodeWithContentDescription("Premium Connectivity", substring = true).assertIsDisplayed()
    }

    private companion object {
        /** 2025-01-01T00:00:00Z — anchors the deterministic expiry math. */
        const val NOW: Long = 1_735_689_600_000L
    }
}
