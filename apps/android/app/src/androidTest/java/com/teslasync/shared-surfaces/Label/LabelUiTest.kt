// Instrumented Compose UI + accessibility verification of the Label surface across the states the web component
// renders (web/src/components/ui/Label.tsx): the optional label (bare content, no required announcement), the
// required label (whose merged accessible name gains the localized "required" suffix — the web VisuallyHidden
// span), the aria-hidden required glyph (the web `*` with `aria-hidden="true"`, never voiced by assistive tech),
// the arbitrary-content slot (the web `children`), the empty-content edge case, and the one-shot PII-safe
// `view.opened` diagnostic. Runs under `connectedAndroidTest` (a device/emulator); the offline gate's
// `testReleaseUnitTest` covers the pure model. `assertDoesNotExist` is a SemanticsNodeInteraction member and is
// deliberately called without an import (an explicit import does not resolve).
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.label

import androidx.compose.material3.Text
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class LabelUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── State: an optional label shows its content and never announces "required" ──────────────────────────────

    @Test
    fun optionalLabelShowsContentWithoutRequiredAnnouncement() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                LabelContent { Text(LABEL_TEXT) }
            }
        }

        compose.onNodeWithText(LABEL_TEXT).assertIsDisplayed()
        compose.onNodeWithContentDescription(REQUIRED_SUFFIX).assertDoesNotExist()
    }

    // ── State: a required label announces the localized "required" suffix (web VisuallyHidden) ─────────────────

    @Test
    fun requiredLabelAnnouncesRequiredSuffix() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                LabelContent(required = true) { Text(LABEL_TEXT) }
            }
        }

        compose.onNodeWithText(LABEL_TEXT).assertIsDisplayed()
        // The web asterisk's screen-reader replacement (`VisuallyHidden` "required") is merged into the label node.
        compose.onNodeWithContentDescription(REQUIRED_SUFFIX).assertIsDisplayed()
    }

    // ── Accessibility: the required glyph is hidden from assistive tech (web `aria-hidden="true"`) ─────────────

    @Test
    fun requiredGlyphIsHiddenFromAssistiveTech() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                LabelContent(required = true) { Text(LABEL_TEXT) }
            }
        }

        // The required state did render (non-vacuous): the "required" suffix is present…
        compose.onNodeWithContentDescription(REQUIRED_SUFFIX).assertIsDisplayed()
        // …but the visible `*` glyph is never voiced — no node carries it as text or as a description.
        compose.onNodeWithText(LABEL_REQUIRED_MARKER).assertDoesNotExist()
        compose.onNodeWithContentDescription(LABEL_REQUIRED_MARKER).assertDoesNotExist()
    }

    // ── State: the arbitrary-content slot (web `children`) renders with the required announcement ──────────────

    @Test
    fun slotContentRendersWithRequiredAnnouncement() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                LabelContent(required = true) { Text(SLOT_TEXT) }
            }
        }

        compose.onNodeWithText(SLOT_TEXT).assertIsDisplayed()
        compose.onNodeWithContentDescription(REQUIRED_SUFFIX).assertIsDisplayed()
    }

    // ── State: empty content still announces the requirement (web `{children}` empty + required) ──────────────

    @Test
    fun emptyRequiredLabelStillAnnouncesRequired() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                LabelContent(required = true) {}
            }
        }

        compose.onNodeWithContentDescription(REQUIRED_SUFFIX).assertIsDisplayed()
    }

    // ── Text overload: the convenience form-label path renders the visible text + the required suffix ─────────

    @Test
    fun textOverloadRendersVisibleLabelAndRequiredSuffix() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Label(text = LABEL_TEXT, required = true, logger = RecordingLogger())
            }
        }

        compose.onNodeWithText(LABEL_TEXT).assertIsDisplayed()
        compose.onNodeWithContentDescription(REQUIRED_SUFFIX).assertIsDisplayed()
    }

    // ── Diagnostics: the one-shot PII-safe view.opened (P1/S11) fires once on mount ───────────────────────────

    @Test
    fun mountingEmitsThePiiSafeViewOpenedDiagnosticOnce() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Label(text = LABEL_TEXT, logger = logger)
            }
        }
        compose.waitForIdle()

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "Label"), fields)
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
        const val LABEL_TEXT = "Email"
        const val SLOT_TEXT = "Custom field"

        // The en catalog value (instrumentation default locale) the surface announces for `form.required`.
        const val REQUIRED_SUFFIX = "required"
    }
}
