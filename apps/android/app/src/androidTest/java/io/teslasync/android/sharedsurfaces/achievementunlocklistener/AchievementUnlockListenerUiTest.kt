// On-device UI + accessibility verification of the AchievementUnlockListener stateless renderer — proves the
// reproduced web states render the right chrome and a11y affordances: the two dormant states (toasts disabled /
// nothing pending) render NO overlay, the celebrating state renders one celebration card per unlock with the
// "Achievement Unlocked" eyebrow, name, and description folded into one polite live-region content description,
// the dismiss control carries a TalkBack label + invokes the callback, and the View control exposes a click
// action. Reduced motion is forced so the confetti/fade settle instantly and the assertions are deterministic.
// Runs on a device/emulator via `:android:connectedAndroidTest`.

package io.teslasync.android.sharedsurfaces.achievementunlocklistener

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class AchievementUnlockListenerUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: AchievementListenerState,
        onDismiss: (String) -> Unit = {},
        onView: (String) -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    AchievementUnlockListenerContent(state = state, onDismiss = onDismiss, onView = onView)
                }
            }
        }
    }

    private fun unlock(
        id: String,
        name: String,
        description: String,
        icon: String = "🏆",
    ): AchievementUnlock =
        AchievementUnlock(
            vehicleId = 1L,
            unlockedAt = "2026-01-01T00:00:00Z",
            achievement = Achievement(id = id, name = name, description = description, icon = icon),
        )

    @Test
    fun disabledRendersNoOverlay() {
        setContent(
            AchievementListenerState(
                prefs = AchievementCelebrationPrefs(showToasts = false),
                queue = listOf(unlock("road_warrior", "Road Warrior", "Drove 10,000 km")),
            ),
        )

        compose.onAllNodesWithContentDescription("Road Warrior", substring = true).assertCountEquals(0)
        compose.onAllNodesWithContentDescription("Dismiss achievement notification").assertCountEquals(0)
    }

    @Test
    fun idleRendersNoOverlay() {
        setContent(AchievementListenerState())

        compose.onAllNodesWithContentDescription("Dismiss achievement notification").assertCountEquals(0)
    }

    @Test
    fun celebratingShowsEyebrowNameAndDescriptionAsOnePoliteAnnouncement() {
        setContent(
            AchievementListenerState(
                queue = listOf(unlock("road_warrior", "Road Warrior", "Drove 10,000 km")),
            ),
        )

        // The whole card is one polite live region announcing eyebrow + name + description.
        compose
            .onNodeWithContentDescription("Achievement Unlocked: Road Warrior. Drove 10,000 km")
            .assertIsDisplayed()
        // The View affordance is exposed as a separate, clickable, labeled control.
        compose.onNodeWithText("View").assertHasClickAction()
    }

    @Test
    fun dismissControlIsLabeledAndInvokesCallback() {
        var dismissed: String? = null
        setContent(
            state =
                AchievementListenerState(
                    queue = listOf(unlock("road_warrior", "Road Warrior", "Drove 10,000 km")),
                ),
            onDismiss = { dismissed = it },
        )

        compose
            .onNodeWithContentDescription("Dismiss achievement notification")
            .assertHasClickAction()
            .performClick()
        assertEquals("road_warrior", dismissed)
    }

    @Test
    fun viewControlInvokesViewThenDismiss() {
        var viewed: String? = null
        var dismissed: String? = null
        setContent(
            state =
                AchievementListenerState(
                    queue = listOf(unlock("night_owl", "Night Owl", "Drove after midnight")),
                ),
            onDismiss = { dismissed = it },
            onView = { viewed = it },
        )

        compose.onNodeWithText("View").performClick()
        assertEquals("night_owl", viewed)
        assertEquals("night_owl", dismissed)
    }

    @Test
    fun stackRendersOneCardPerPendingUnlock() {
        setContent(
            AchievementListenerState(
                queue =
                    listOf(
                        unlock("night_owl", "Night Owl", "Drove after midnight"),
                        unlock("road_warrior", "Road Warrior", "Drove 10,000 km"),
                    ),
            ),
        )

        compose.onNodeWithContentDescription("Night Owl", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("Road Warrior", substring = true).assertIsDisplayed()
    }
}
