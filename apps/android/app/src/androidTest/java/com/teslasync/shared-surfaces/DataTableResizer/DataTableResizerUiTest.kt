// Instrumented Compose UI + accessibility verification of [DataTableResizerHandle] / [DataTableResizer] across the
// states the web DataTableResizer renders: the idle grip, the adjustable-node accessibility contract (the web
// `aria-label` → contentDescription, the `aria-valuenow/min/max` → ProgressBarRangeInfo, and the keyboard-equivalent
// → a `setProgress` action), the drag-to-resize gesture (continuous onResize + a settled onResizeEnd on release),
// the hardware keyboard map (DPad-Right grows + commits), and the diagnostics-bearing entry point resolving its
// label from the column key. Runs under `connectedAndroidTest` (a device/emulator); the offline gate's
// `testReleaseUnitTest` covers the pure model (clamp/nudge/applyCommand, the label resolver, and the diagnostics)
// in DataTableResizerModelTest.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/DataTableResizer) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.datatableresizer

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performKeyInput
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.pressKey
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class DataTableResizerUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun host(content: @Composable () -> Unit) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) { content() }
        }
    }

    @Composable
    private fun HostHandle(
        width: Dp,
        onResize: (Dp) -> Unit,
        onResizeEnd: ((Dp) -> Unit)? = null,
        contentDescription: String = LABEL,
    ) {
        // A tall, fixed-width box so the handle has a real on-screen drag/keyboard target.
        Box(modifier = Modifier.height(200.dp).width(48.dp)) {
            DataTableResizerHandle(
                width = width,
                onResize = onResize,
                contentDescription = contentDescription,
                onResizeEnd = onResizeEnd,
            )
        }
    }

    @Test
    fun renders_theGripWithItsAccessibleLabel() {
        host { HostHandle(width = 120.dp, onResize = {}) }
        compose.onNodeWithTag(DATA_TABLE_RESIZER_TEST_TAG).assertIsDisplayed()
        // The web `aria-label` → contentDescription (the a11y label contract).
        compose.onNodeWithContentDescription(LABEL).assertIsDisplayed()
    }

    @Test
    fun exposes_theValueAndBoundsAsProgressRangeInfo() {
        host { HostHandle(width = 120.dp, onResize = {}) }
        // The web `aria-valuenow/min/max` → ProgressBarRangeInfo(current, min..max).
        compose
            .onNodeWithTag(DATA_TABLE_RESIZER_TEST_TAG)
            .assert(
                SemanticsMatcher.expectValue(
                    SemanticsProperties.ProgressBarRangeInfo,
                    ProgressBarRangeInfo(current = 120f, range = 60f..800f),
                ),
            )
    }

    @Test
    fun setProgressAction_commitsAClampedWidth() {
        var last: Dp? = null
        var settled: Dp? = null
        host { HostHandle(width = 120.dp, onResize = { last = it }, onResizeEnd = { settled = it }) }

        // The accessibility "set value" path (TalkBack / Switch Access) — the keyboard-equivalent the web exposes.
        compose
            .onNodeWithTag(DATA_TABLE_RESIZER_TEST_TAG)
            .performSemanticsAction(SemanticsActions.SetProgress) { setProgress -> setProgress(300f) }

        compose.runOnIdle {
            assertEquals(300.dp, last)
            // A discrete a11y adjust persists immediately (web onResize + onResizeEnd).
            assertEquals(300.dp, settled)
        }
    }

    @Test
    fun setProgressAction_clampsBeyondTheMaximum() {
        var last: Dp? = null
        host { HostHandle(width = 120.dp, onResize = { last = it }) }
        compose
            .onNodeWithTag(DATA_TABLE_RESIZER_TEST_TAG)
            .performSemanticsAction(SemanticsActions.SetProgress) { setProgress -> setProgress(5000f) }
        compose.runOnIdle { assertEquals(800.dp, last) } // web clamp(maxWidth)
    }

    @Test
    fun horizontalDrag_growsTheWidthAndSettlesOnRelease() {
        val emitted = mutableListOf<Dp>()
        var settled: Dp? = null
        host { HostHandle(width = 120.dp, onResize = { emitted += it }, onResizeEnd = { settled = it }) }

        compose.onNodeWithTag(DATA_TABLE_RESIZER_TEST_TAG).performTouchInput {
            down(center)
            moveBy(Offset(120f, 0f))
            up()
        }

        compose.runOnIdle {
            assertTrue("a drag emits at least one continuous onResize", emitted.isNotEmpty())
            assertTrue("dragging right grows the column past its start width", emitted.last() > 120.dp)
            // The release persists the settled width (web onResizeEnd).
            assertTrue("the drag settles via onResizeEnd", settled != null)
        }
    }

    @Test
    fun keyboard_arrowRightGrowsByTheStepAndCommits() {
        var last: Dp? = null
        var settled: Dp? = null
        host { HostHandle(width = 120.dp, onResize = { last = it }, onResizeEnd = { settled = it }) }

        // A tap focuses the splitter (web tabIndex), then ArrowRight grows it one step (web `clamp(width + 8)`).
        compose.onNodeWithTag(DATA_TABLE_RESIZER_TEST_TAG).performTouchInput {
            down(center)
            up()
        }
        compose.onNodeWithTag(DATA_TABLE_RESIZER_TEST_TAG).performKeyInput { pressKey(Key.DirectionRight) }

        compose.runOnIdle {
            assertEquals(128.dp, last)
            assertEquals(128.dp, settled)
        }
    }

    @Test
    fun statefulEntryPoint_resolvesTheLabelFromTheColumnKeyAndRecordsTheDiagnostic() {
        val records = mutableListOf<LogRecord>()
        val logger =
            object : Logger {
                override fun log(
                    level: LogLevel,
                    event: String,
                    fields: Map<String, String>,
                ) {
                    records += LogRecord(level, event, fields)
                }
            }
        host {
            Box(modifier = Modifier.height(200.dp).width(48.dp)) {
                DataTableResizer(columnKey = "speed", width = 120.dp, onResize = {}, logger = logger)
            }
        }
        // Default accessible name is the localized "Resize column {columnKey}" (the catalog key is absent in test,
        // so the English template fallback formats the column key).
        compose.onNodeWithContentDescription("Resize column speed").assertIsDisplayed()
        compose.runOnIdle {
            assertEquals(1, records.size)
            assertEquals("view.opened", records[0].event)
            assertEquals(mapOf("surface" to "DataTableResizer"), records[0].fields)
        }
    }

    private companion object {
        const val LABEL = "Resize column speed"
    }
}
