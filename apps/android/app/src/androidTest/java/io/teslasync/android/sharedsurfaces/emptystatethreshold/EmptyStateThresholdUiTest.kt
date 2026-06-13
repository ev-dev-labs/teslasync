package io.teslasync.android.sharedsurfaces.emptystatethreshold

import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * On-device verification of the [EmptyStateThreshold] view — the parity port of the web `EmptyStateThreshold`
 * (web/src/components/feedback/EmptyStateThreshold.tsx). Covers what the offline model test cannot: the section
 * title + composed count message render and resolve their `emptyState.threshold.*` keys through the P1/S10
 * catalog (custom noun, fallback "items", and the custom-message override), the description + action slots
 * render, the surface is a polite live region (web `role="status" aria-live="polite"`), and the one-shot
 * PII-safe `view.opened` diagnostic fires once on mount. The offline `:app:testReleaseUnitTest` gate covers the
 * pure projection + the diagnostics emitter.
 */
class EmptyStateThresholdUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── State: the section title renders ──────────────────────────────────────────────────────────────────

    @Test
    fun theSectionTitleRenders() {
        mount(currentCount = 5, threshold = 30, sectionLabel = "Cost Heatmap")

        compose.onNodeWithText("Cost Heatmap").assertExists()
    }

    // ── State: the composed count message uses the supplied noun + counts (catalog-resolved) ──────────────

    @Test
    fun theComposedMessageUsesTheSuppliedNounAndCounts() {
        mount(currentCount = 5, threshold = 30, sectionLabel = "Cost Heatmap", itemNoun = "sessions")

        compose.onNodeWithText("at least 30 sessions", substring = true).assertExists()
        compose.onNodeWithText("You have 5 so far", substring = true).assertExists()
    }

    // ── State: a missing noun falls back to the localized "items" ─────────────────────────────────────────

    @Test
    fun theComposedMessageFallsBackToTheLocalizedItemsNoun() {
        mount(currentCount = 1, threshold = 10, sectionLabel = "Section")

        compose.onNodeWithText("at least 10 items", substring = true).assertExists()
    }

    // ── State: a custom message override wins and the default copy is not composed ────────────────────────

    @Test
    fun aCustomMessageOverrideRendersAndTheDefaultIsNotComposed() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                EmptyStateThreshold(
                    currentCount = 1,
                    threshold = 10,
                    sectionLabel = "Section",
                    message = "Custom prompt here",
                    logger = RecordingLogger(),
                )
            }
        }
        compose.waitForIdle()

        compose.onNodeWithText("Custom prompt here", substring = true).assertExists()
        compose.onNodeWithText("at least 10", substring = true).assertDoesNotExist()
    }

    // ── State: the description renders below the title ────────────────────────────────────────────────────

    @Test
    fun theDescriptionRenders() {
        mount(
            currentCount = 1,
            threshold = 10,
            sectionLabel = "Section",
            description = "A subtitle that explains the section",
        )

        compose.onNodeWithText("A subtitle that explains the section").assertExists()
    }

    // ── State: the action slot renders its caller-supplied control ────────────────────────────────────────

    @Test
    fun theActionSlotRenders() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                EmptyStateThreshold(
                    currentCount = 1,
                    threshold = 10,
                    sectionLabel = "Section",
                    action = {
                        Button(label = ACTION_LABEL, onClick = {}, variant = ButtonVariant.Outline, size = ButtonSize.Sm)
                    },
                    logger = RecordingLogger(),
                )
            }
        }
        compose.waitForIdle()

        compose.onNodeWithText(ACTION_LABEL).assertExists()
    }

    // ── Accessibility: the surface is a polite live region (web `role="status" aria-live="polite"`) ───────

    @Test
    fun theSurfaceIsAPoliteLiveRegion() {
        mount(currentCount = 5, threshold = 30, sectionLabel = "Cost Heatmap")

        compose
            .onNodeWithTag(EMPTY_STATE_THRESHOLD_TEST_TAG)
            .assertIsDisplayed()
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite))
    }

    // ── Diagnostics: the one-shot PII-safe view.opened (P1/S11) ───────────────────────────────────────────

    @Test
    fun mountingEmitsThePiiSafeViewOpenedDiagnosticOnce() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                EmptyStateThreshold(currentCount = 5, threshold = 30, sectionLabel = "Cost Heatmap", logger = logger)
            }
        }
        compose.waitForIdle()

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "EmptyStateThreshold"), fields)
    }

    private fun mount(
        currentCount: Int,
        threshold: Int,
        sectionLabel: String,
        itemNoun: String? = null,
        description: String? = null,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                EmptyStateThreshold(
                    currentCount = currentCount,
                    threshold = threshold,
                    sectionLabel = sectionLabel,
                    itemNoun = itemNoun,
                    description = description,
                    logger = RecordingLogger(),
                )
            }
        }
        compose.waitForIdle()
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
        const val ACTION_LABEL = "Adjust filters"
    }
}
