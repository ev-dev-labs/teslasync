package io.teslasync.android.sharedsurfaces.achievementunlockedtoast

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.featureviews.achievementbadge.AchievementData
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the AchievementUnlockedToast shared surface across
 * every state the web source renders (web/src/components/feedback/AchievementUnlockedToast.tsx): the
 * celebratory toast (badge + "Achievement Unlocked" eyebrow + name + description + "View →" + dismiss), the
 * cached-toast offline surface, the friendly empty state, the reconnect/retry error surface, and the
 * "listening" loading skeleton. It asserts the rendered i18n strings, that the "View" and dismiss controls
 * invoke their callbacks with the achievement id, and that the dismiss control exposes its TalkBack label
 * (web `aria-label`). Every render is built with reduced motion so the confetti + entry animation never keep
 * the test clock busy. Runs under `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the pure
 * projection + the ViewModel, this covers the render.
 */
class AchievementUnlockedToastUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    private val sampleToast =
        AchievementToast(
            id = "first-drive",
            achievement =
                AchievementData(
                    id = "first-drive",
                    name = "First Drive",
                    description = "Complete your first recorded drive",
                    icon = "\uD83C\uDFC1",
                    unlocked = true,
                    unlockedAt = "2026-01-01T00:00:00Z",
                    progress = 1.0,
                    target = 1.0,
                    current = 1.0,
                ),
        )

    private fun feed(
        phase: AchievementToastPhase,
        toasts: List<AchievementToast> = emptyList(),
        connection: LiveConnectionStatus = LiveConnectionStatus.Connected,
        stale: Boolean = false,
        offline: Boolean = false,
    ): AchievementToastFeed =
        AchievementToastFeed(
            phase = phase,
            toasts = toasts,
            connection = connection,
            stale = stale,
            offline = offline,
            refreshing = false,
            lastMessageAtMillis = 0L,
        )

    private fun setSurface(
        state: AchievementToastFeed,
        onView: (String) -> Unit = {},
        onDismiss: (String) -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    AchievementUnlockedToastContent(
                        state = state,
                        reducedMotion = true,
                        onView = onView,
                        onDismiss = onDismiss,
                        onRetry = onRetry,
                    )
                }
            }
        }
    }

    private fun label(resId: Int) = context.getString(resId)

    @Test
    fun contentRendersBadgeEyebrowNameDescriptionViewAndDismiss() {
        setSurface(feed(AchievementToastPhase.Content, toasts = listOf(sampleToast)))

        compose.onNodeWithTag(ACHIEVEMENT_TOAST_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText(label(R.string.translation_achievements_toastEyebrow), useUnmergedTree = true).assertIsDisplayed()
        // Name + description appear inside the badge AND the toast body (web parity) — assert presence.
        compose.onAllNodesWithText("First Drive", useUnmergedTree = true).onFirst().assertIsDisplayed()
        compose.onAllNodesWithText("Complete your first recorded drive", useUnmergedTree = true).onFirst().assertIsDisplayed()
        compose.onNodeWithText(label(R.string.translation_achievements_view) + " \u2192").assertIsDisplayed()
        compose.onNodeWithContentDescription(label(R.string.translation_achievements_dismiss)).assertIsDisplayed()
    }

    @Test
    fun dismissControlInvokesOnDismissWithTheAchievementId() {
        val dismissed = mutableListOf<String>()
        setSurface(feed(AchievementToastPhase.Content, toasts = listOf(sampleToast)), onDismiss = { dismissed += it })

        compose.onNodeWithContentDescription(label(R.string.translation_achievements_dismiss)).performClick()

        assertEquals(listOf("first-drive"), dismissed)
    }

    @Test
    fun viewControlInvokesOnViewWithTheAchievementId() {
        val opened = mutableListOf<String>()
        setSurface(feed(AchievementToastPhase.Content, toasts = listOf(sampleToast)), onView = { opened += it })

        compose.onNodeWithText(label(R.string.translation_achievements_view) + " \u2192").performClick()

        assertEquals(listOf("first-drive"), opened)
    }

    @Test
    fun offlineContentKeepsTheCachedToastVisible() {
        setSurface(
            feed(
                AchievementToastPhase.Content,
                toasts = listOf(sampleToast),
                connection = LiveConnectionStatus.Disconnected,
                offline = true,
            ),
        )

        compose.onNodeWithTag(ACHIEVEMENT_TOAST_TEST_TAG).assertIsDisplayed()
        compose.onAllNodesWithText("First Drive", useUnmergedTree = true).onFirst().assertIsDisplayed()
    }

    @Test
    fun emptyStateRendersTheNoneYetMessage() {
        setSurface(feed(AchievementToastPhase.Empty))

        compose.onNodeWithText(label(R.string.translation_achievements_noneYet)).assertIsDisplayed()
        compose.onNodeWithTag(ACHIEVEMENT_TOAST_SURFACE_TEST_TAG).assertIsDisplayed()
    }

    @Test
    fun errorStateRendersARetryAffordance() {
        setSurface(feed(AchievementToastPhase.Error, connection = LiveConnectionStatus.Disconnected))

        compose.onNodeWithText("Retry", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag(ACHIEVEMENT_TOAST_SURFACE_TEST_TAG).assertIsDisplayed()
    }

    @Test
    fun loadingStateRendersANonBlankSurface() {
        // The loading skeleton shimmer is an infinite animation; freeze the clock so waitForIdle returns.
        compose.mainClock.autoAdvance = false
        setSurface(feed(AchievementToastPhase.Loading, connection = LiveConnectionStatus.Unknown))

        compose.onNodeWithTag(ACHIEVEMENT_TOAST_SURFACE_TEST_TAG).assertIsDisplayed()
    }

    @Test
    fun dismissControlIsLabelledForTalkBack() {
        setSurface(feed(AchievementToastPhase.Content, toasts = listOf(sampleToast)))

        compose.onNodeWithContentDescription(label(R.string.translation_achievements_dismiss)).assertIsDisplayed()
    }
}
