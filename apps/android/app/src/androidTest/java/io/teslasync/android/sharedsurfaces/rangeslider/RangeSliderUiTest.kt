package io.teslasync.android.sharedsurfaces.rangeslider

import androidx.compose.runtime.Composable
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the RangeSlider surface across every state the web
 * component renders (web/src/components/ui/RangeSlider.tsx): the labelled value row (label + `low – high`
 * summary), the no-label variant, the disabled render, the two thumbs each exposing their own accessible name
 * (the web per-thumb `aria-label`), the stateful surface resolving the i18n thumb labels from the `label`, and
 * the one-shot PII-safe `view.opened` diagnostic on mount. Runs under `connectedAndroidTest`; the
 * `testReleaseUnitTest` gate covers the pure model + diagnostics logic off-device.
 */
class RangeSliderUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── Labelled value row: the label + the formatted `low – high` summary (web `showLabel` true) ─────────

    @Test
    fun labelledContentShowsTheLabelAndSummary() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                LabelledContent()
            }
        }

        compose.onNodeWithText(LABEL).assertIsDisplayed()
        compose.onNodeWithText(SUMMARY).assertIsDisplayed()
    }

    // ── Per-thumb accessibility: each thumb carries its own name (web per-thumb `aria-label`) ─────────────

    @Test
    fun bothThumbsExposeTheirAccessibleNames() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                LabelledContent()
            }
        }

        compose.onNodeWithContentDescription(LOW_THUMB, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(HIGH_THUMB, useUnmergedTree = true).assertIsDisplayed()
    }

    // ── No-label variant: the label/summary row is hidden, the thumbs remain (web `showLabel` false) ──────

    @Test
    fun noLabelVariantHidesTheLabelAndSummaryRowButKeepsTheThumbs() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                RangeSliderContent(
                    value = 30f..70f,
                    onValueChange = {},
                    label = LABEL,
                    summary = SUMMARY,
                    lowThumbLabel = LOW_THUMB,
                    highThumbLabel = HIGH_THUMB,
                    lowValueText = "30",
                    highValueText = "70",
                    valueRange = 0f..100f,
                    showLabel = false,
                )
            }
        }

        compose.onAllNodesWithText(LABEL).assertCountEquals(0)
        compose.onAllNodesWithText(SUMMARY).assertCountEquals(0)
        compose.onNodeWithContentDescription(LOW_THUMB, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(HIGH_THUMB, useUnmergedTree = true).assertIsDisplayed()
    }

    // ── Disabled render: both thumbs still render (web `disabled`) ─────────────────────────────────────────

    @Test
    fun disabledSliderStillRendersBothThumbs() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                RangeSliderContent(
                    value = 20f..80f,
                    onValueChange = {},
                    label = LABEL,
                    summary = SUMMARY,
                    lowThumbLabel = LOW_THUMB,
                    highThumbLabel = HIGH_THUMB,
                    lowValueText = "20",
                    highValueText = "80",
                    valueRange = 0f..100f,
                    enabled = false,
                )
            }
        }

        compose.onNodeWithContentDescription(LOW_THUMB, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(HIGH_THUMB, useUnmergedTree = true).assertIsDisplayed()
    }

    // ── Stateful surface: the i18n thumb labels are resolved from the `label` (web `{{label}} minimum/maximum`) ─

    @Test
    fun statefulSurfaceResolvesTheI18nThumbLabelsFromTheLabel() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                RangeSlider(
                    value = 20f..80f,
                    onValueChange = {},
                    label = LABEL,
                    valueRange = 0f..100f,
                    logger = RecordingLogger(),
                )
            }
        }

        compose.onNodeWithContentDescription(LOW_THUMB, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(HIGH_THUMB, useUnmergedTree = true).assertIsDisplayed()
    }

    // ── Diagnostics: one-shot view.opened with only the surface slug, never the label ─────────────────────

    @Test
    fun mountingEmitsViewOpenedExactlyOnceWithOnlyTheSlug() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                RangeSlider(
                    value = 20f..80f,
                    onValueChange = {},
                    label = LABEL,
                    valueRange = 0f..100f,
                    logger = logger,
                )
            }
        }
        compose.waitForIdle()

        val opened = logger.records.filter { it.event == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().level)
        assertEquals(mapOf("surface" to "RangeSlider"), opened.single().fields)
        assertTrue("the label must never leak", logger.records.none { it.fields.containsValue(LABEL) })
    }

    @Composable
    private fun LabelledContent() {
        RangeSliderContent(
            value = 20f..80f,
            onValueChange = {},
            label = LABEL,
            summary = SUMMARY,
            lowThumbLabel = LOW_THUMB,
            highThumbLabel = HIGH_THUMB,
            lowValueText = "20",
            highValueText = "80",
            valueRange = 0f..100f,
        )
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
        private const val LABEL = "Battery range"
        private const val SUMMARY = "20 \u2013 80"
        private const val LOW_THUMB = "Battery range minimum"
        private const val HIGH_THUMB = "Battery range maximum"
    }
}
