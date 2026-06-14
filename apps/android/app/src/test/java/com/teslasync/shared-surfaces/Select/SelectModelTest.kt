// Off-device verification of the Select surface's pure logic — the native mirror of every decision the web
// component makes (web/src/components/ui/Select.tsx): the id resolver (`id || slug(label)`), the
// selected-vs-empty-label-vs-empty trigger display, the error/hint precedence + `aria-describedby` target, the
// render classifier across every conditional, and the PII-safe diagnostics slug. Because the composable is a
// thin render layer over SelectModel, the per-branch assertions here double as the surface's per-state snapshot.
// No Compose / Android framework / HTTP — runs in the :android:testReleaseUnitTest gate; the on-device render +
// accessibility live in SelectUiTest.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/Select) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.select

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SelectModelTest {
    // ── registration slug mirrors the prompt-mandated surface slug ──────────────────

    @Test
    fun slugIsThePromptSurfaceSlug() {
        assertEquals("Select", SELECT_SLUG)
        assertEquals(SELECT_SLUG, SelectDiagnostics.SLUG)
        assertEquals(SELECT_SLUG, SelectRegistration.SLUG)
        assertEquals("select", SelectRegistration.ID)
    }

    // ── id resolver (web `id || label?.toLowerCase().replace(/\s+/g, '-')`) ──────────

    @Test
    fun resolveSelectIdPrefersAnExplicitId() {
        assertEquals("custom-id", resolveSelectId(id = "custom-id", label = "Vehicle Name"))
    }

    @Test
    fun resolveSelectIdSlugifiesTheLabelWhenNoId() {
        assertEquals("vehicle-name", resolveSelectId(id = null, label = "Vehicle Name"))
        // Collapses whitespace runs and lower-cases (web `toLowerCase().replace(/\s+/g, '-')`).
        assertEquals("charge-limit-target", resolveSelectId(id = null, label = "  Charge   Limit\tTarget  "))
    }

    @Test
    fun resolveSelectIdIsNullWhenNeitherIdNorLabelIsUsable() {
        assertNull(resolveSelectId(id = null, label = null))
        assertNull(resolveSelectId(id = "   ", label = null))
        assertNull(resolveSelectId(id = null, label = "   "))
        // A blank explicit id falls through to the label.
        assertEquals("vehicle", resolveSelectId(id = "  ", label = "Vehicle"))
    }

    // ── described-by + element ids (web `${id}-error` / `${id}-hint`) ────────────────

    @Test
    fun elementIdsAreNamespacedToTheResolvedId() {
        assertEquals("vehicle-error", errorElementId("vehicle"))
        assertEquals("vehicle-hint", hintElementId("vehicle"))
        assertNull(errorElementId(null))
        assertNull(hintElementId(null))
    }

    @Test
    fun describedByPrefersErrorThenHintElseNull() {
        // web `error ? '${id}-error' : hint ? '${id}-hint' : undefined`
        assertEquals("vehicle-error", describedById("vehicle", hasError = true, hasHint = true))
        assertEquals("vehicle-error", describedById("vehicle", hasError = true, hasHint = false))
        assertEquals("vehicle-hint", describedById("vehicle", hasError = false, hasHint = true))
        assertNull(describedById("vehicle", hasError = false, hasHint = false))
    }

    @Test
    fun shouldShowHintOnlyWhenThereIsNoError() {
        assertTrue(shouldShowHint(hasHint = true, hasError = false))
        assertFalse(shouldShowHint(hasHint = true, hasError = true))
        assertFalse(shouldShowHint(hasHint = false, hasError = false))
    }

    // ── trigger display: selected vs empty-value label vs empty ─────────────────────

    @Test
    fun displayShowsTheSelectedOptionLabel() {
        val display = resolveSelectDisplay(OPTIONS, selectedValue = "model_3", emptyLabel = "Pick one")
        assertEquals("Model 3", display.text)
        assertEquals(SelectDisplayKind.SelectedValue, display.kind)
        assertTrue(display.hasValue)
        assertFalse(display.isEmptyLabel)
    }

    @Test
    fun displayFallsBackToTheEmptyLabelWhenNothingIsSelected() {
        val display = resolveSelectDisplay(OPTIONS, selectedValue = null, emptyLabel = "Pick one")
        assertEquals("Pick one", display.text)
        assertEquals(SelectDisplayKind.EmptyLabel, display.kind)
        assertTrue(display.isEmptyLabel)
        assertFalse(display.hasValue)
    }

    @Test
    fun displayFallsBackToTheEmptyLabelWhenTheValueIsUnknown() {
        // A value with no matching option is not "selected" — the empty-value label still shows (web parity).
        val display = resolveSelectDisplay(OPTIONS, selectedValue = "spaceship", emptyLabel = "Pick one")
        assertEquals("Pick one", display.text)
        assertEquals(SelectDisplayKind.EmptyLabel, display.kind)
    }

    @Test
    fun displayIsEmptyWhenNoSelectionAndNoEmptyLabel() {
        val display = resolveSelectDisplay(OPTIONS, selectedValue = null, emptyLabel = null)
        assertEquals("", display.text)
        assertEquals(SelectDisplayKind.Empty, display.kind)
        assertFalse(display.hasValue)
        assertFalse(display.isEmptyLabel)
    }

    @Test
    fun displayUsesTheFirstMatchingOption() {
        val dupes =
            listOf(
                SelectOption(value = "x", label = "First X"),
                SelectOption(value = "x", label = "Second X"),
            )
        assertEquals("First X", resolveSelectDisplay(dupes, selectedValue = "x", emptyLabel = null).text)
    }

    @Test
    fun selectOptionDefaultsToEnabled() {
        assertTrue(SelectOption(value = "v", label = "L").enabled)
        assertFalse(SelectOption(value = "v", label = "L", enabled = false).enabled)
    }

    // ── classifier: every render branch / state ─────────────────────────────────────

    @Test
    fun classifyShowsEveryRegionWhenAllInputsPresent() {
        val render =
            classifySelect(
                SelectInput(
                    optionCount = 3,
                    hasLabel = true,
                    hasHelp = true,
                    hasEmptyLabel = true,
                    hasEmptyMessage = false,
                    hasError = false,
                    hasHint = true,
                    required = true,
                    enabled = true,
                ),
            )
        assertTrue(render.showLabelRow)
        assertTrue(render.showHelp)
        assertTrue(render.showEmptyLabel)
        assertEquals(3, render.optionCount)
        assertFalse(render.showEmptyMenu)
        assertTrue(render.canOpen)
        assertFalse(render.invalid)
        assertFalse(render.showError)
        assertTrue(render.showHint)
        assertTrue(render.required)
        assertTrue(render.enabled)
    }

    @Test
    fun classifyGatesHelpOnTheLabelRow() {
        // The web nests HelpIcon inside the label block, so no label means no help even when help is provided.
        val render = classifySelect(baseInput().copy(hasLabel = false, hasHelp = true))
        assertFalse(render.showLabelRow)
        assertFalse(render.showHelp)
    }

    @Test
    fun classifyShowsErrorAndSuppressesHintWhenBothPresent() {
        val render = classifySelect(baseInput().copy(hasError = true, hasHint = true))
        assertTrue(render.invalid)
        assertTrue(render.showError)
        assertFalse(render.showHint)
    }

    @Test
    fun classifyShowsHintOnlyWithoutError() {
        val render = classifySelect(baseInput().copy(hasError = false, hasHint = true))
        assertFalse(render.showError)
        assertTrue(render.showHint)
    }

    @Test
    fun classifyLightsTheEmptyMenuOnlyWithNoOptionsAndAMessage() {
        // The prompt's "empty → friendly empty state, never a blank box" contract.
        val withMessage = classifySelect(baseInput().copy(optionCount = 0, hasEmptyMessage = true))
        assertTrue(withMessage.showEmptyMenu)
        assertTrue(withMessage.canOpen)

        val withoutMessage = classifySelect(baseInput().copy(optionCount = 0, hasEmptyMessage = false))
        assertFalse(withoutMessage.showEmptyMenu)
        // No options and no empty row → nothing to show → the menu cannot open (never a blank box).
        assertFalse(withoutMessage.canOpen)

        // Options present → the empty row never shows even if a message was supplied.
        val withOptions = classifySelect(baseInput().copy(optionCount = 2, hasEmptyMessage = true))
        assertFalse(withOptions.showEmptyMenu)
        assertTrue(withOptions.canOpen)
    }

    @Test
    fun classifyCannotOpenWhenDisabled() {
        val render = classifySelect(baseInput().copy(optionCount = 5, enabled = false))
        assertFalse(render.canOpen)
        assertFalse(render.enabled)
    }

    @Test
    fun classifyPropagatesTheEmptyLabelAndRequiredFlags() {
        assertTrue(classifySelect(baseInput().copy(hasEmptyLabel = true)).showEmptyLabel)
        assertFalse(classifySelect(baseInput().copy(hasEmptyLabel = false)).showEmptyLabel)
        assertTrue(classifySelect(baseInput().copy(required = true)).required)
        assertFalse(classifySelect(baseInput().copy(required = false)).required)
    }

    // ── diagnostics: one PII-safe view.opened (P1/S11) ──────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeSurfaceSlug() {
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
        SelectDiagnostics.recordViewOpened(logger)
        assertEquals(1, records.size)
        assertEquals(LogLevel.Info, records[0].level)
        assertEquals("view.opened", records[0].event)
        // Only the surface slug — no selected value, label, or option can leak through the diagnostic.
        assertEquals(mapOf("surface" to "Select"), records[0].fields)
    }

    private fun baseInput(): SelectInput =
        SelectInput(
            optionCount = 1,
            hasLabel = true,
            hasHelp = false,
            hasEmptyLabel = false,
            hasEmptyMessage = false,
            hasError = false,
            hasHint = false,
            required = false,
            enabled = true,
        )

    private companion object {
        val OPTIONS =
            listOf(
                SelectOption(value = "model_s", label = "Model S"),
                SelectOption(value = "model_3", label = "Model 3"),
                SelectOption(value = "model_x", label = "Model X", enabled = false),
            )
    }
}
