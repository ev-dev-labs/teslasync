package io.teslasync.android.featureviews.signalselector

import io.teslasync.android.components.forms.ComboOption
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the SignalSelector's pure logic — the native mirror of the decisions the web
 * component makes (web/src/features/telemetry/components/SignalSelector.tsx): the three label forms, the
 * `maxItems` guard that disables further additions at the cap, and the
 * `onChange(Number.isFinite(cap) ? next.slice(0, cap) : next)` safety slice. Because the surface is purely
 * presentational, each [SignalSelectorDisplay] is exactly what the thin composable renders, so these
 * assertions double as the per-state "snapshot" (below cap / at cap / uncapped / empty catalog / override).
 * The data adapter under test is the cached props → display/toggle projection; the owning page owns the
 * cache-then-network feed of `options`.
 */
class SignalSelectorProjectionTest {
    @Test
    fun cappedLabelMatchesTheWebTernary() {
        assertEquals("Signals (2 / 5)", SignalSelectorProjection.resolveLabel("Signals", count = 2, max = 5, labelOverride = null))
    }

    @Test
    fun uncappedLabelDropsTheMaxSegment() {
        assertEquals("Signals (1)", SignalSelectorProjection.resolveLabel("Signals", count = 1, max = null, labelOverride = null))
    }

    @Test
    fun labelOverrideWinsVerbatim() {
        // Web `labelOverride ?? …`: a supplied override replaces the computed label entirely, cap or not.
        assertEquals(
            "Compare signals",
            SignalSelectorProjection.resolveLabel("Signals", count = 3, max = 5, labelOverride = "Compare signals"),
        )
    }

    @Test
    fun belowCapEveryOptionStaysEnabled() {
        val display =
            SignalSelectorProjection.project(
                label = "Signals (1 / 5)",
                options = listOf("a", "b", "c"),
                value = listOf("a"),
                max = 5,
                showLayerHelp = true,
            )

        assertFalse(display.atCap)
        assertTrue(display.hasOptions)
        assertEquals(setOf("a"), display.selectedValues)
        assertEquals(
            listOf(
                ComboOption("a", "a", enabled = true),
                ComboOption("b", "b", enabled = true),
                ComboOption("c", "c", enabled = true),
            ),
            display.options,
        )
    }

    @Test
    fun atCapDisablesUnselectedButKeepsSelectedRemovable() {
        // Web `maxItems` guard: once value.length >= max, not-yet-selected options can no longer be added,
        // while already-selected options stay interactive so they can be removed.
        val display =
            SignalSelectorProjection.project(
                label = "Signals (2 / 2)",
                options = listOf("a", "b", "c"),
                value = listOf("a", "b"),
                max = 2,
                showLayerHelp = true,
            )

        assertTrue(display.atCap)
        assertEquals(
            listOf(
                ComboOption("a", "a", enabled = true),
                ComboOption("b", "b", enabled = true),
                ComboOption("c", "c", enabled = false),
            ),
            display.options,
        )
    }

    @Test
    fun uncappedSelectionIsNeverAtCap() {
        val display =
            SignalSelectorProjection.project(
                label = SignalSelectorProjection.resolveLabel("Signals", count = 2, max = null, labelOverride = null),
                options = listOf("a", "b"),
                value = listOf("a", "b"),
                max = null,
                showLayerHelp = true,
            )

        assertFalse(display.atCap)
        assertEquals("Signals (2)", display.label)
        assertTrue(display.options.all { it.enabled })
    }

    @Test
    fun emptyCatalogFlagsNoOptionsSoTheSurfaceIsNeverBlank() {
        val display =
            SignalSelectorProjection.project(
                label = SignalSelectorProjection.resolveLabel("Signals", count = 0, max = 5, labelOverride = null),
                options = emptyList(),
                value = emptyList(),
                max = 5,
                showLayerHelp = true,
            )

        assertFalse(display.hasOptions)
        assertFalse(display.atCap)
        assertTrue(display.options.isEmpty())
        assertEquals("Signals (0 / 5)", display.label)
    }

    @Test
    fun toggleAddsAnAbsentSignalToTheEndOfTheOrderedSelection() {
        assertEquals(listOf("a", "b"), SignalSelectorProjection.applyToggle(listOf("a"), "b", max = 5))
    }

    @Test
    fun toggleRemovesAPresentSignalPreservingOrder() {
        assertEquals(listOf("a", "c"), SignalSelectorProjection.applyToggle(listOf("a", "b", "c"), "b", max = 5))
    }

    @Test
    fun toggleClampsAdditionsToTheCap() {
        // Web slice(0, cap) safety net: adding past the cap drops the overflow (the option is also disabled).
        assertEquals(
            listOf("a", "b", "c", "d", "e"),
            SignalSelectorProjection.applyToggle(listOf("a", "b", "c", "d", "e"), "f", max = 5),
        )
    }

    @Test
    fun toggleKeepsEverythingWhenUncapped() {
        assertEquals(
            listOf("a", "b", "c", "d", "e", "f"),
            SignalSelectorProjection.applyToggle(listOf("a", "b", "c", "d", "e"), "f", max = null),
        )
    }

    @Test
    fun toggleRemovalIsNeverBlockedByTheCap() {
        assertEquals(listOf("b"), SignalSelectorProjection.applyToggle(listOf("a", "b"), "a", max = 1))
    }
}
