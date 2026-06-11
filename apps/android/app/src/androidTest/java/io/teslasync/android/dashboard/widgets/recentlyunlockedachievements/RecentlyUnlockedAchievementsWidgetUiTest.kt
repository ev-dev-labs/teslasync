package io.teslasync.android.dashboard.widgets.recentlyunlockedachievements

import androidx.compose.ui.test.assertHasClickAction
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
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [RecentlyUnlockedAchievementsWidgetContent] across
 * every state the web component renders (loading skeleton, hard error + retry, the deep-linkable badge
 * strip, the `showOnDashboard` opt-out empty state, the "none yet" empty state, stale/offline cached).
 * Asserts the rendered i18n strings, the per-badge TalkBack labels, and the badge deep-link callback. Runs
 * under `connectedAndroidTest` (a device/emulator); the offline gate's `testReleaseUnitTest` covers the
 * logic, this covers render + a11y.
 */
class RecentlyUnlockedAchievementsWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val defaultSize = RecentlyUnlockedAchievementsRegistration.defaultSize

    private fun unlockedJson(): JsonElement =
        buildJsonObject {
            putJsonArray("achievements") {
                addJsonObject {
                    put("id", "first-drive")
                    put("name", "First Drive")
                    put("icon", "\uD83C\uDFC1")
                    put("unlocked", true)
                    put("unlocked_at", "2024-03-20T10:00:00Z")
                }
            }
        }

    private fun lockedJson(): JsonElement =
        buildJsonObject {
            putJsonArray("achievements") {
                addJsonObject {
                    put("id", "locked")
                    put("name", "Locked")
                    put("unlocked", false)
                }
            }
        }

    private fun setContent(
        state: UiState<JsonElement>,
        showOnDashboard: Boolean = true,
        onRefresh: () -> Unit = {},
        onOpenAchievement: (String) -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                RecentlyUnlockedAchievementsWidgetContent(
                    state = state,
                    showOnDashboard = showOnDashboard,
                    size = defaultSize,
                    onRefresh = onRefresh,
                    onOpenAchievement = onOpenAchievement,
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
    fun contentShowsTitleAndDeepLinkableBadge() {
        setContent(UiState(UiPhase.Content, data = unlockedJson(), fetchedAt = NOW))
        compose.onNodeWithText("Recently Unlocked").assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
        compose.onNodeWithContentDescription("View achievement: First Drive").assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun badgeClickInvokesOpenAchievementWithId() {
        var opened: String? = null
        setContent(
            state = UiState(UiPhase.Content, data = unlockedJson(), fetchedAt = NOW),
            onOpenAchievement = { opened = it },
        )
        compose.onNodeWithContentDescription("View achievement: First Drive").performClick()
        assertEquals("first-drive", opened)
    }

    @Test
    fun emptyShowsNoneYetMessage() {
        setContent(UiState(UiPhase.Empty, data = lockedJson(), fetchedAt = NOW))
        compose.onNodeWithText("achievements will appear here", substring = true).assertIsDisplayed()
    }

    @Test
    fun disabledShowsOptOutMessageAndHidesBadges() {
        setContent(
            state = UiState(UiPhase.Content, data = unlockedJson(), fetchedAt = NOW),
            showOnDashboard = false,
        )
        compose.onNodeWithText("hidden in your settings", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("View achievement: First Drive").assertDoesNotExist()
    }

    @Test
    fun offlineKeepsCachedBadgeVisible() {
        setContent(
            UiState(
                UiPhase.Content,
                data = unlockedJson(),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached badges stay visible (never blanked) when offline/stale.
        compose.onNodeWithContentDescription("View achievement: First Drive").assertIsDisplayed()
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
    }
}
