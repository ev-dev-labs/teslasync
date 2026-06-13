package io.teslasync.android.sharedsurfaces.sectionerrorboundary

import androidx.compose.material3.Text
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.components.feedback.ErrorBoundaryState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the SectionErrorBoundary surface across every branch
 * the web component renders (web/src/components/feedback/SectionErrorBoundary.tsx): the transparent healthy
 * pass-through, the inline default card (title + detail + a working Retry that resets the boundary), the
 * `fallbackTitle` card (title + subtitle, no Retry), and a host-supplied custom fallback node. Asserts the
 * rendered text, the merged TalkBack announcement on the alert region, the labelled clickable Retry, and the
 * one-shot PII-safe `view.opened` plus the `caught` diagnostic on the stateful boundary. Runs under
 * `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the pure model + diagnostics logic.
 */
class SectionErrorBoundaryUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── Healthy: the boundary is transparent and renders its children (web `return children`) ───────────

    @Test
    fun healthyBoundaryRendersItsChildren() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SectionErrorBoundary(name = "chart", state = ErrorBoundaryState(), logger = RecordingLogger()) {
                    Text(CONTENT)
                }
            }
        }

        compose.onNodeWithText(CONTENT).assertIsDisplayed()
        compose.onAllNodesWithText(RETRY).assertCountEquals(0)
    }

    // ── Inline default: title + detail + Retry, and Retry resets the boundary back to the children ──────

    @Test
    fun inlineFallbackShowsTitleDetailAndRetryThenResets() {
        val state = ErrorBoundaryState()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SectionErrorBoundary(name = "chart", state = state, logger = RecordingLogger()) {
                    Text(CONTENT)
                }
            }
        }
        compose.onNodeWithText(CONTENT).assertIsDisplayed()

        compose.runOnIdle { state.report(IllegalStateException(MESSAGE)) }

        compose.onNodeWithText(SECTION_TITLE, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(MESSAGE, useUnmergedTree = true).assertIsDisplayed()
        val retry = compose.onNodeWithText(RETRY)
        retry.assertIsDisplayed().assertHasClickAction()

        retry.performClick()

        compose.onNodeWithText(CONTENT).assertIsDisplayed()
        compose.onAllNodesWithText(RETRY).assertCountEquals(0)
    }

    // ── Title fallback: the custom title + the subtitle, and no Retry (web `fallbackTitle`) ─────────────

    @Test
    fun titleFallbackShowsTitleAndSubtitleWithoutRetry() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SectionErrorFallback(kind = SectionFallbackKind.Title, fallbackTitle = CUSTOM_TITLE)
            }
        }

        compose.onNodeWithText(CUSTOM_TITLE, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(SUBTITLE, useUnmergedTree = true).assertIsDisplayed()
        compose.onAllNodesWithText(RETRY).assertCountEquals(0)
    }

    // ── Custom fallback: the host node is rendered verbatim, with no Retry chrome (web `fallback`) ──────

    @Test
    fun customFallbackRendersTheHostNode() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SectionErrorFallback(kind = SectionFallbackKind.Custom, custom = { Text(CUSTOM_NODE) })
            }
        }

        compose.onNodeWithText(CUSTOM_NODE).assertIsDisplayed()
        compose.onAllNodesWithText(RETRY).assertCountEquals(0)
    }

    // ── Accessibility: the title + detail are exposed as one merged assertive announcement ──────────────

    @Test
    fun fallbackCardExposesAMergedSpokenLabel() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SectionErrorFallback(kind = SectionFallbackKind.Inline, detailMessage = MESSAGE)
            }
        }

        compose.onNodeWithContentDescription("$SECTION_TITLE. $MESSAGE").assertIsDisplayed()
    }

    // ── Diagnostics: one-shot view.opened, plus the PII-safe caught event when the boundary flips ───────

    @Test
    fun mountingEmitsViewOpenedOnceAndCaughtOnFlip() {
        val state = ErrorBoundaryState()
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SectionErrorBoundary(name = NAME, state = state, logger = logger) {
                    Text(CONTENT)
                }
            }
        }
        compose.waitForIdle()
        assertEquals(1, logger.records.count { it.event == "view.opened" })

        compose.runOnIdle { state.report(IllegalStateException(MESSAGE)) }
        compose.waitForIdle()

        val caught = logger.records.single { it.event == "sectionErrorBoundary.caught" }
        assertEquals(LogLevel.Warn, caught.level)
        assertEquals("SectionErrorBoundary", caught.fields["surface"])
        assertEquals(NAME, caught.fields["name"])
        assertEquals("IllegalStateException", caught.fields["errorType"])
        assertTrue("the captured message must never leak", caught.fields.values.none { it.contains(MESSAGE) })
        assertEquals(1, logger.records.count { it.event == "view.opened" })
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
        private const val CONTENT = "Healthy chart body"
        private const val CUSTOM_TITLE = "Battery chart failed"
        private const val CUSTOM_NODE = "Host fallback content"
        private const val SECTION_TITLE = "This section failed to load"
        private const val SUBTITLE = "Other parts of the page should still work."
        private const val MESSAGE = "render blew up"
        private const val RETRY = "Retry"
        private const val NAME = "BatteryDegradationChart"
    }
}
