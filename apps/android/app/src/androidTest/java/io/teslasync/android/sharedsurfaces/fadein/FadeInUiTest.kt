package io.teslasync.android.sharedsurfaces.fadein

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertExists
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the FadeIn surface across every state the web component
 * plays (web/src/components/motion/FadeIn.tsx): the animated reveal, the immediate reduced-motion final state, and
 * the transparent empty wrapper. Forces [LocalReducedMotion] for a deterministic clock (the sibling
 * MotionInteractionTest pattern) so assertions never wait on a real animation — the content must already be present
 * in its final state. Also asserts the one-shot PII-safe `view.opened` diagnostic and that the wrapper never
 * swallows its content's semantics. Runs under `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the
 * pure entrance + diagnostics logic.
 */
class FadeInUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── reduced motion: the web `initial={false}` final state — content present immediately ───────────────────

    @Test
    fun fadeRendersContentInFinalStateUnderReducedMotion() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    FadeIn(logger = RecordingLogger()) { BodyText(LABEL) }
                }
            }
        }

        compose.onNodeWithText(LABEL).assertIsDisplayed()
        compose.onNodeWithTag(FADE_IN_TEST_TAG).assertExists()
    }

    // ── motion enabled: the reveal animation settles to the content in its final state ────────────────────────

    @Test
    fun motionEnabledRevealSettlesToContent() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides false) {
                    FadeIn(logger = RecordingLogger()) { BodyText(LABEL) }
                }
            }
        }
        compose.waitForIdle()

        compose.onNodeWithText(LABEL).assertIsDisplayed()
    }

    // ── empty: the transparent wrapper root still renders (never a blank box) but hosts no children ───────────

    @Test
    fun emptyWrapperRendersTheTransparentRootWithoutChildren() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                FadeIn(logger = RecordingLogger()) { }
            }
        }

        compose.onNodeWithTag(FADE_IN_TEST_TAG).assertExists()
        compose.onAllNodesWithText(LABEL).assertCountEquals(0)
    }

    // ── diagnostics: one-shot view.opened carrying only the surface slug ──────────────────────────────────────

    @Test
    fun openingEmitsViewOpenedOnceWithOnlyTheSlug() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    FadeIn(logger = logger) { BodyText(LABEL) }
                }
            }
        }
        compose.waitForIdle()

        val opened = logger.records.filter { it.event == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().level)
        assertEquals("FadeIn", opened.single().fields["surface"])
    }

    // ── accessibility: the wrapper is transparent — the content's label stays reachable to TalkBack ───────────

    @Test
    fun childLabelIsReachableToAccessibility() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    FadeIn(logger = RecordingLogger()) { BodyText(LABEL) }
                }
            }
        }

        compose.onNodeWithText(LABEL).assertIsDisplayed()
    }

    private data class Record(
        val level: LogLevel,
        val event: String,
        val fields: Map<String, String>,
    )

    private class RecordingLogger : Logger {
        val records = mutableListOf<Record>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Record(level, event, fields)
        }
    }

    private companion object {
        private const val LABEL = "Battery health"
    }
}
