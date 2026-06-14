// On-device Compose UI + accessibility verification of the BackgroundWorkSegment shared surface across every
// state the web component renders (web/src/components/layout/status-bar/BackgroundWorkSegment.tsx): the content
// trigger (the "1 task" / "{{count}} tasks" summary), the icon-only trigger, the idle / empty trigger, and the
// hard-error trigger; plus the "Running" popover (heading + job rows) and the error popover's retry. It asserts
// the rendered i18n summary string and that the trigger exposes its state as a single TalkBack content
// description (web `aria-label`), plus that the error surface's retry is a labelled, clickable button. Every
// render is built with reduced motion so the infinite spin transition never keeps the test clock busy. Runs
// under `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the pure model + fold, this covers render.
package io.teslasync.android.sharedsurfaces.backgroundworksegment

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class BackgroundWorkSegmentUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    private fun exportJob(label: String) =
        BackgroundJob(
            id = "export:1",
            kind = BackgroundJobKind.Export,
            startedAtIso = "2026-06-13T10:00:00Z",
            label = label,
            detail = ExportProgress.Processing,
        )

    private fun customJob(label: String) =
        BackgroundJob(
            id = "backup",
            kind = BackgroundJobKind.Custom,
            startedAtIso = "2026-06-13T10:01:00Z",
            label = label,
        )

    private fun setContent(
        state: BackgroundWorkState,
        iconOnly: Boolean = false,
        onRetry: (() -> Unit)? = null,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    BackgroundWorkSegmentContent(state = state, iconOnly = iconOnly, onRetry = onRetry)
                }
            }
        }
    }

    private fun aria(stateWord: String) = context.getString(R.string.translation_statusBar_background_aria) + ": " + stateWord

    @Test
    fun oneTaskShowsSummaryAndIsLabelled() {
        setContent(BackgroundWorkState(WorkPhase.Content, listOf(exportJob("drives.csv"))))

        val oneTask = context.getString(R.string.translation_statusBar_background_one)
        compose.onNodeWithText(oneTask, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(aria(oneTask)).assertIsDisplayed()
    }

    @Test
    fun manyTasksShowsTheCountSummary() {
        setContent(
            BackgroundWorkState(
                WorkPhase.Content,
                listOf(exportJob("a.csv"), customJob("Backup"), customJob("Backup 2").copy(id = "backup2")),
            ),
        )

        val manyTasks = context.getString(R.string.translation_statusBar_background_many, 3)
        compose.onNodeWithText(manyTasks, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(aria(manyTasks)).assertIsDisplayed()
    }

    @Test
    fun iconOnlyHidesTheSummaryText() {
        setContent(BackgroundWorkState(WorkPhase.Content, listOf(exportJob("drives.csv"))), iconOnly = true)

        val oneTask = context.getString(R.string.translation_statusBar_background_one)
        compose.onNodeWithText(oneTask, useUnmergedTree = true).assertDoesNotExist()
        compose.onNodeWithTag(BACKGROUND_WORK_SEGMENT_TEST_TAG).assertIsDisplayed()
    }

    @Test
    fun emptyRendersALabelledIdleTrigger() {
        setContent(BackgroundWorkState(WorkPhase.Empty, emptyList()))

        val idle = context.getString(R.string.translation_Idle)
        compose.onNodeWithTag(BACKGROUND_WORK_SEGMENT_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithContentDescription(aria(idle)).assertIsDisplayed()
    }

    @Test
    fun contentTriggerOpensTheRunningList() {
        setContent(BackgroundWorkState(WorkPhase.Content, listOf(customJob("Generating backup"))))

        compose.onNodeWithTag(BACKGROUND_WORK_SEGMENT_TEST_TAG).performClick()
        compose.waitForIdle()

        val running = context.getString(R.string.translation_statusBar_background_heading)
        compose.onNodeWithText(running, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("Generating backup").assertIsDisplayed()
    }

    @Test
    fun errorTriggerOpensARetryAffordance() {
        setContent(BackgroundWorkState(WorkPhase.Error, emptyList()), onRetry = {})

        compose.onNodeWithTag(BACKGROUND_WORK_SEGMENT_TEST_TAG).performClick()
        compose.waitForIdle()

        val title = context.getString(R.string.translation_queryError_title)
        val retry = context.getString(R.string.translation_queryError_retry)
        compose.onNodeWithText(title, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(retry).assertHasClickAction()
    }

    @Test
    fun tappingRetryInvokesTheCallback() {
        var clicks = 0
        setContent(BackgroundWorkState(WorkPhase.Error, emptyList()), onRetry = { clicks++ })

        compose.onNodeWithTag(BACKGROUND_WORK_SEGMENT_TEST_TAG).performClick()
        compose.waitForIdle()
        val retry = context.getString(R.string.translation_queryError_retry)
        compose.onNodeWithText(retry).performClick()
        compose.waitForIdle()

        assertEquals(1, clicks)
    }
}
