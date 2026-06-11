package io.teslasync.android.components.motion

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose tests for the motion layer. They force [LocalReducedMotion] = true (the
 * deterministic clock) so assertions never wait on a real animation: the content must already be
 * present in its final state. The duration / stagger / skip math is covered by [MotionLogicTest].
 */
class MotionInteractionTest {
    @get:Rule
    val rule = createComposeRule()

    @Test
    fun fadeInShowsContentInFinalState() {
        rule.setContent {
            TeslaSyncTheme {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    FadeIn { BodyText("Hello fade") }
                }
            }
        }
        rule.onNodeWithText("Hello fade").assertIsDisplayed()
    }

    @Test
    fun staggerRendersEveryItem() {
        rule.setContent {
            TeslaSyncTheme {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    StaggerContainer {
                        listOf("Alpha", "Beta", "Gamma").forEachIndexed { index, label ->
                            StaggerItem(index = index) { BodyText(label) }
                        }
                    }
                }
            }
        }
        rule.onNodeWithText("Alpha").assertIsDisplayed()
        rule.onNodeWithText("Beta").assertIsDisplayed()
        rule.onNodeWithText("Gamma").assertIsDisplayed()
    }

    @Test
    fun carAnimationExposesContentDescription() {
        rule.setContent {
            TeslaSyncTheme {
                CarAnimation(contentDescription = "Tesla illustration")
            }
        }
        rule.onNodeWithContentDescription("Tesla illustration").assertIsDisplayed()
    }
}
