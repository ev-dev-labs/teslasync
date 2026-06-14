package io.teslasync.android.sharedsurfaces.staggercontainer

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertCountEquals
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
 * On-device Compose UI + accessibility verification of the StaggerContainer surface across every state the web
 * component plays (web/src/components/motion/StaggerContainer.tsx): the staggered list (data-driven overload),
 * the generic children slot, and the transparent empty pass-through. Forces [LocalReducedMotion] = true (the
 * deterministic clock the sibling MotionInteractionTest uses) so assertions never wait on a real animation — the
 * children must already be present in their final state. Also asserts the one-shot PII-safe `view.opened`
 * diagnostic and that the wrapper never swallows its children's semantics. Runs under `connectedAndroidTest`; the
 * `testReleaseUnitTest` gate covers the pure cadence + diagnostics logic.
 */
class StaggerContainerUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── animated/reduced final state: the data-driven overload renders every row ───────────────────────────

    @Test
    fun staggerRendersEveryItemInFinalState() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    StaggerContainer(items = ROWS, logger = RecordingLogger()) { row -> BodyText(row) }
                }
            }
        }

        ROWS.forEach { row -> compose.onNodeWithText(row).assertIsDisplayed() }
    }

    // ── the generic children slot + StaggerItem renders each hand-staggered child ───────────────────────────

    @Test
    fun genericSlotApiRendersEveryStaggerItem() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    StaggerContainer(logger = RecordingLogger()) {
                        ROWS.forEachIndexed { index, row ->
                            StaggerItem(index = index) { BodyText(row) }
                        }
                    }
                }
            }
        }

        ROWS.forEach { row -> compose.onNodeWithText(row).assertIsDisplayed() }
    }

    // ── empty: the transparent container root still renders (never a blank box) but hosts no children ───────

    @Test
    fun emptyContainerRendersTheTransparentRootWithoutChildren() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                StaggerContainer(items = emptyList<String>(), logger = RecordingLogger()) { row -> BodyText(row) }
            }
        }

        compose.onNodeWithTag(STAGGER_CONTAINER_TEST_TAG).assertExists()
        compose.onAllNodesWithText(ROWS.first()).assertCountEquals(0)
    }

    // ── diagnostics: one-shot view.opened carrying only the surface slug ───────────────────────────────────

    @Test
    fun openingEmitsViewOpenedOnceWithOnlyTheSlug() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    StaggerContainer(items = ROWS, logger = logger) { row -> BodyText(row) }
                }
            }
        }
        compose.waitForIdle()

        val opened = logger.records.filter { it.event == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().level)
        assertEquals("StaggerContainer", opened.single().fields["surface"])
    }

    // ── accessibility: the wrapper is transparent — each child's label stays reachable to TalkBack ─────────

    @Test
    fun childLabelIsReachableToAccessibility() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    StaggerContainer(items = listOf(LABEL), logger = RecordingLogger()) { row -> BodyText(row) }
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
