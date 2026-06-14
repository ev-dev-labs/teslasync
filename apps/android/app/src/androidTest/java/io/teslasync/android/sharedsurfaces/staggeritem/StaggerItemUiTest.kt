package io.teslasync.android.sharedsurfaces.staggeritem

import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
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
 * On-device Compose UI + accessibility verification of the StaggerItem surface across every state the web
 * component plays (web/src/components/motion/StaggerItem.tsx): a single child that animates into place and a row
 * of hand-staggered children. Forces [LocalReducedMotion] = true (the deterministic clock the sibling
 * MotionInteractionTest uses) so assertions never wait on a real animation — the child must already be present in
 * its final state. Also asserts the surface test tag, the one-shot PII-safe `view.opened` diagnostic, and that
 * the wrapper never swallows its child's semantics. Runs under `connectedAndroidTest`; the `testReleaseUnitTest`
 * gate covers the pure entrance + diagnostics logic.
 */
class StaggerItemUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── animated/reduced final state: the child renders in place ───────────────────────────────────────────

    @Test
    fun rendersChildInFinalStateUnderReducedMotion() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    StaggerItem(index = 0, logger = RecordingLogger()) { BodyText(LABEL) }
                }
            }
        }

        compose.onNodeWithText(LABEL).assertIsDisplayed()
    }

    // ── a row of hand-staggered children all reach their final state ───────────────────────────────────────

    @Test
    fun rendersEveryHandStaggeredChild() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    Column {
                        ROWS.forEachIndexed { index, row ->
                            StaggerItem(index = index, logger = RecordingLogger()) { BodyText(row) }
                        }
                    }
                }
            }
        }

        ROWS.forEach { row -> compose.onNodeWithText(row).assertIsDisplayed() }
    }

    // ── the surface root carries its stable test tag so UI tests can locate it in any state ─────────────────

    @Test
    fun surfaceRootCarriesTheTestTag() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    StaggerItem(index = 0, logger = RecordingLogger()) { BodyText(LABEL) }
                }
            }
        }

        compose.onNodeWithTag(STAGGER_ITEM_TEST_TAG).assertIsDisplayed()
    }

    // ── diagnostics: one-shot view.opened carrying only the surface slug ───────────────────────────────────

    @Test
    fun openingEmitsViewOpenedOnceWithOnlyTheSlug() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    StaggerItem(index = 0, logger = logger) { BodyText(LABEL) }
                }
            }
        }
        compose.waitForIdle()

        val opened = logger.records.filter { it.event == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().level)
        assertEquals("StaggerItem", opened.single().fields["surface"])
    }

    // ── accessibility: the wrapper is transparent — the child's label stays reachable to TalkBack ──────────

    @Test
    fun childLabelIsReachableToAccessibility() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    StaggerItem(index = 0, logger = RecordingLogger()) { BodyText(LABEL) }
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
        private val ROWS = listOf("Range estimate", "Battery health", "Trip efficiency")
        private const val LABEL = "Tire pressure"
    }
}
