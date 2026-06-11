package io.teslasync.android.featureviews.achievementbadge

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test
import java.text.NumberFormat
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [AchievementBadgeContent] across every state the
 * surface renders: the unlocked state (name + description + "✓ Unlocked" status), the in-progress state
 * (name + description + `{pct}%` status over the progress ring), the near-complete state (gold ring +
 * pulse), and a non-default size. Also asserts the emoji exposes the achievement name as its TalkBack
 * label (web `role="img" aria-label={name}`). Runs under `connectedAndroidTest`; the offline gate's
 * `testReleaseUnitTest` covers the pure projection logic, this covers render + a11y. Mirrors the web spec
 * (web/src/features/analytics/components/AchievementBadge.tsx).
 */
class AchievementBadgeUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val unlocked =
        AchievementData(
            id = "first-drive",
            name = "First Drive",
            description = "Complete your first recorded drive",
            icon = "🏁",
            unlocked = true,
            unlockedAt = "2026-01-01T00:00:00Z",
            progress = 1.0,
            target = 1.0,
            current = 1.0,
        )

    private val inProgress =
        AchievementData(
            id = "road-tripper",
            name = "Road Tripper",
            description = "Drive 1,000 km in a single month",
            icon = "🛣️",
            unlocked = false,
            progress = 0.45,
            target = 1_000.0,
            current = 450.0,
        )

    private val nearComplete =
        AchievementData(
            id = "supercharged",
            name = "Supercharged",
            description = "Use 50 Supercharger sessions",
            icon = "⚡",
            unlocked = false,
            progress = 0.9,
            target = 50.0,
            current = 45.0,
        )

    private fun percentLabel(progress: Double): String = NumberFormat.getPercentInstance(Locale.getDefault()).format(progress)

    private fun setContent(
        achievement: AchievementData,
        size: AchievementBadgeSize = AchievementBadgeSize.Md,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AchievementBadgeContent(achievement = achievement, size = size)
            }
        }
    }

    @Test
    fun unlockedStateRendersNameDescriptionAndUnlockedStatus() {
        setContent(unlocked)
        compose.onNodeWithText(unlocked.name).assertIsDisplayed()
        compose.onNodeWithText(unlocked.description).assertIsDisplayed()
        compose.onNodeWithText("✓ Unlocked").assertIsDisplayed()
    }

    @Test
    fun inProgressStateRendersNameDescriptionAndPercent() {
        setContent(inProgress)
        compose.onNodeWithText(inProgress.name).assertIsDisplayed()
        compose.onNodeWithText(inProgress.description).assertIsDisplayed()
        // Web `{pct}%`: 45% over the progress ring.
        compose.onNodeWithText(percentLabel(0.45)).assertIsDisplayed()
    }

    @Test
    fun nearCompleteStateRendersItsPercent() {
        setContent(nearComplete)
        compose.onNodeWithText(nearComplete.name).assertIsDisplayed()
        compose.onNodeWithText(percentLabel(0.9)).assertIsDisplayed()
    }

    @Test
    fun emojiExposesTheAchievementNameAsItsAccessibilityLabel() {
        // Web parity: `role="img" aria-label={name}` — the emoji announces the achievement name.
        setContent(unlocked)
        compose.onNodeWithContentDescription(unlocked.name).assertIsDisplayed()
    }

    @Test
    fun lockedEmojiStillExposesItsAccessibilityLabel() {
        // The grayed/dimmed in-progress emoji keeps its name label for TalkBack.
        setContent(inProgress)
        compose.onNodeWithContentDescription(inProgress.name).assertIsDisplayed()
    }

    @Test
    fun largeSizeStillRendersTheName() {
        setContent(unlocked, size = AchievementBadgeSize.Lg)
        compose.onNodeWithText(unlocked.name).assertIsDisplayed()
    }
}
