package io.teslasync.android.widgetprimitives.widgetshell

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the WidgetShell primitive across every state the web source
 * plays (web/src/features/dashboard/widgets/WidgetShell.tsx): the loading skeleton chrome, the classified error
 * panel with a retry affordance, the titled content header (icon-less title + help "?" + pin) over the body, the
 * title-less overlay-freshness layout, and the empty branch delegated to the body slot. Forces [LocalReducedMotion]
 * = true and freezes the main clock so the shimmer / freshness / glow never spin `waitForIdle`. Also asserts the
 * one-shot PII-safe `view.opened` diagnostic and the accessibility labels (the original-case title, the help
 * trigger, the pin). Runs under `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the pure projection
 * + diagnostics logic.
 */
class WidgetShellUiTest {
    @get:Rule
    val compose = createComposeRule()

    @Before
    fun freezeClock() {
        // The shell composes infinite-loop atoms (Skeleton shimmer, DataFreshness 30s tick) — without freezing the
        // clock, autoAdvance would never let waitForIdle settle.
        compose.mainClock.autoAdvance = false
    }

    // ── loading: the skeleton chrome renders with a single coherent "Loading" description, never a blank box ──

    @Test
    fun loadingRendersSkeletonChrome() {
        setShell { WidgetShell(title = "Charging", loading = true, logger = RecordingLogger()) {} }

        compose.onNodeWithContentDescription("Loading").assertIsDisplayed()
        compose.onNodeWithTag(WIDGET_SHELL_TEST_TAG).assertIsDisplayed()
    }

    // ── error: the centered QueryError with a retry affordance that invokes onRefresh ─────────────────────────

    @Test
    fun errorRendersQueryErrorWithWorkingRetry() {
        var retried = false
        setShell {
            WidgetShell(title = "Drives", error = "request failed", onRefresh = { retried = true }, logger = RecordingLogger()) {}
        }

        compose.onNodeWithTag(WIDGET_SHELL_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText("Retry").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue("tapping retry should invoke onRefresh", retried)
    }

    // ── titled content: title (original-case a11y), help trigger, pin, and the host body all render ────────────

    @Test
    fun titledContentRendersHeaderAffordancesAndBody() {
        setShell {
            WidgetShell(
                title = "Battery Health",
                updatedAtMillis = 1_700_000_000_000L,
                help = WidgetShellHelp("Estimated capacity versus EPA rating."),
                widgetId = "battery-health",
                dashboardId = "overview",
                onTogglePin = {},
                logger = RecordingLogger(),
            ) {
                Text("96 percent")
            }
        }

        // Visual title is uppercased; TalkBack reads the original case (clearAndSetSemantics).
        compose.onNodeWithContentDescription("Battery Health").assertIsDisplayed()
        // Help trigger names the title (web "More info about {title}" → native "Help for {title}").
        compose.onNodeWithContentDescription("Help for Battery Health").assertIsDisplayed()
        // Pin trigger (not yet pinned) is labelled "Pin".
        compose.onNodeWithContentDescription("Pin").assertIsDisplayed()
        compose.onNodeWithText("96 percent").assertIsDisplayed()
    }

    // ── pinned state flips the pin label and the toggle fires ─────────────────────────────────────────────────

    @Test
    fun pinnedWidgetShowsUnpinAndToggles() {
        var toggled = false
        setShell {
            WidgetShell(
                title = "Battery",
                widgetId = "battery",
                dashboardId = "overview",
                pinned = true,
                onTogglePin = { toggled = true },
                logger = RecordingLogger(),
            ) {
                Text("body")
            }
        }

        compose.onNodeWithContentDescription("Unpin").assertIsDisplayed()
        compose.onNodeWithContentDescription("Unpin").performClick()
        assertTrue("tapping the pin should invoke onTogglePin", toggled)
    }

    // ── title-less content: the body renders and the freshness overlay sits over the cell ─────────────────────

    @Test
    fun titlelessContentRendersBodyWithOverlayFreshness() {
        setShell {
            WidgetShell(updatedAtMillis = 1_700_000_000_000L, logger = RecordingLogger()) {
                Text("42 kWh")
            }
        }

        compose.onNodeWithTag(WIDGET_SHELL_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText("42 kWh").assertIsDisplayed()
    }

    // ── empty branch: delegated to the body slot, never a blank box (web parity) ──────────────────────────────

    @Test
    fun emptyStateIsDelegatedToTheBodySlot() {
        setShell {
            WidgetShell(title = "Drives", logger = RecordingLogger()) {
                Text("No data available")
            }
        }

        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    // ── diagnostics: one-shot view.opened carrying only the surface slug ──────────────────────────────────────

    @Test
    fun openingEmitsViewOpenedOnceWithOnlyTheSlug() {
        val logger = RecordingLogger()
        setShell {
            WidgetShell(title = "Battery", logger = logger) { Text("body") }
        }
        compose.waitForIdle()

        val opened = logger.records.filter { it.event == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().level)
        assertEquals("WidgetShell", opened.single().fields["surface"])
    }

    private fun setShell(content: @Composable () -> Unit) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    content()
                }
            }
        }
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
}
