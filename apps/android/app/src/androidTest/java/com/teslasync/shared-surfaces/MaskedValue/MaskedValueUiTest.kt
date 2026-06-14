// Instrumented Compose UI + accessibility verification of [MaskedValueField] / [MaskedValue] across every branch
// the web component renders (web/src/components/ui/MaskedValue.tsx): the masked code + reveal affordance, the
// revealed raw value + hide affordance, the round-trip back to masked, the auto-hide window, the empty em-dash
// (no toggle), the optional copy affordance, the value's semantic accessible name (web wrapper `aria-label`),
// and the one-shot PII-safe `view.opened` diagnostic. Runs under `connectedAndroidTest` (a device/emulator);
// the offline gate's `testReleaseUnitTest` covers the pure model (masking math, projection, toggle, audit port,
// diagnostics) in MaskedValueModelTest / MaskedValueDiagnosticsTest.
//
// `assertExists` / `assertDoesNotExist` are SemanticsNodeInteraction MEMBERS (called on the result, not
// imported); only the matcher/assertion extensions are imported below. `InvalidPackageDeclaration` is
// suppressed: the mandated surface directory (com/teslasync/shared-surfaces/MaskedValue) cannot form a valid
// Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.maskedvalue

import androidx.compose.runtime.Composable
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class MaskedValueUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun host(content: @Composable () -> Unit) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) { content() }
        }
    }

    // ── Masked default: the mask shows and the reveal affordance is present (web initial `useState(false)`) ─

    @Test
    fun maskedInitiallyShowsTheMaskAndTheRevealAffordance() {
        host {
            MaskedValueField(value = TOKEN, variant = MaskVariant.Token, contentDescription = LABEL)
        }
        compose.onNodeWithTag(MASKED_VALUE_TEST_TAG, useUnmergedTree = true).assertTextEquals(MASKED)
        compose.onNodeWithContentDescription(REVEAL).assertIsDisplayed().assertHasClickAction()
    }

    // ── Reveal: tapping the eye shows the raw value and flips the toggle (web `reveal()`) ────────────────

    @Test
    fun revealingShowsTheRawValueAndFlipsTheToggle() {
        host {
            MaskedValueField(value = TOKEN, variant = MaskVariant.Token, contentDescription = LABEL)
        }
        compose.onNodeWithContentDescription(REVEAL).performClick()
        compose.onNodeWithTag(MASKED_VALUE_TEST_TAG, useUnmergedTree = true).assertTextEquals(TOKEN)
        compose.onNodeWithContentDescription(HIDE).assertIsDisplayed()
    }

    // ── Hide: tapping again returns to the mask (web `hide()`) ────────────────────────────────────────────

    @Test
    fun hidingReturnsToTheMask() {
        host {
            MaskedValueField(value = TOKEN, variant = MaskVariant.Token, contentDescription = LABEL)
        }
        compose.onNodeWithContentDescription(REVEAL).performClick()
        compose.onNodeWithContentDescription(HIDE).performClick()
        compose.onNodeWithTag(MASKED_VALUE_TEST_TAG, useUnmergedTree = true).assertTextEquals(MASKED)
    }

    // ── Empty: an em-dash and no toggle (web `raw.length === 0` short-circuit) ───────────────────────────

    @Test
    fun emptyValueRendersTheEmDashWithoutAToggle() {
        host {
            MaskedValueField(value = null, variant = MaskVariant.Token, contentDescription = LABEL)
        }
        compose.onNodeWithTag(MASKED_VALUE_TEST_TAG, useUnmergedTree = true).assertTextEquals(EM_DASH)
        compose.onNodeWithContentDescription(REVEAL).assertDoesNotExist()
    }

    // ── Copyable: the copy affordance is present and operable (web `copyable`) ───────────────────────────

    @Test
    fun copyableRendersTheCopyAffordance() {
        host {
            MaskedValueField(
                value = TOKEN,
                variant = MaskVariant.Token,
                contentDescription = LABEL,
                copyable = true,
            )
        }
        compose.onNodeWithContentDescription(COPY).assertIsDisplayed().assertHasClickAction()
    }

    // ── Accessibility: a screen reader names the value, not its bullets/cleartext (web wrapper `aria-label`) ─

    @Test
    fun theValueExposesItsSemanticName() {
        host {
            MaskedValueField(value = TOKEN, variant = MaskVariant.Token, contentDescription = LABEL)
        }
        compose.onNodeWithContentDescription(LABEL, useUnmergedTree = true).assertIsDisplayed()
    }

    // ── Auto-hide: a revealed value re-masks after the window (web 30 s `setTimeout`, shortened here) ─────

    @Test
    fun aRevealAutoHidesBackToTheMaskAfterTheWindow() {
        compose.mainClock.autoAdvance = false
        host {
            MaskedValueField(
                value = TOKEN,
                variant = MaskVariant.Token,
                contentDescription = LABEL,
                autoHideMs = AUTO_HIDE_MS,
            )
        }
        compose.onNodeWithContentDescription(REVEAL).performClick()
        compose.waitForIdle()
        compose.onNodeWithContentDescription(HIDE).assertExists()

        // Cross the auto-hide window on the controlled clock; the value re-masks on its own.
        compose.mainClock.advanceTimeBy(AUTO_HIDE_MS + WINDOW_BUFFER_MS)
        compose.waitForIdle()
        compose.onNodeWithContentDescription(REVEAL).assertExists()
        compose.onNodeWithTag(MASKED_VALUE_TEST_TAG, useUnmergedTree = true).assertTextEquals(MASKED)
    }

    // ── Diagnostics: one-shot view.opened with only the surface slug ─────────────────────────────────────

    @Test
    fun mountingEmitsViewOpenedOnceWithOnlyTheSlug() {
        val logger = RecordingLogger()
        host {
            MaskedValue(value = TOKEN, variant = MaskVariant.Token, contentDescription = LABEL, logger = logger)
        }
        compose.waitForIdle()

        val opened = logger.records.filter { it.event == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().level)
        assertEquals(mapOf("surface" to "MaskedValue"), opened.single().fields)
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
        const val TOKEN = "abcd1234EFGH"
        val MASKED = "\u2022".repeat(12) + "EFGH"
        const val LABEL = "API key"

        // English fallbacks resolved from the P1/S10 catalog (translation_mask_*).
        const val REVEAL = "Reveal value"
        const val HIDE = "Hide value"
        const val COPY = "Copy value"

        const val AUTO_HIDE_MS = 50L
        const val WINDOW_BUFFER_MS = 100L
    }
}
