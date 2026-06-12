package io.teslasync.android.featureviews.inputcommandtile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the InputCommandTile's pure logic — the native mirror of every derivation the web
 * component performs (web/src/features/system/components/InputCommandTile.tsx): the `def.variant ?? 'default'`
 * union, the `def.sublabelFallback && …` sublabel gate, the dynamic `t(key, fallback)` label resolution, and
 * the `lastStatus.startsWith('✓')` success-vs-failure status line. Because the surface is purely presentational
 * each [InputCommandTileDisplay] is exactly what the thin composable renders, so these assertions double as the
 * per-state "snapshot". Runs in the :android:testReleaseUnitTest gate.
 */
class InputCommandTileProjectionTest {
    private val tick = "\u2713"
    private val cross = "\u2717"

    private fun lookupOf(vararg pairs: Pair<String, String?>): (String) -> String? {
        val table = pairs.toMap()
        return { name -> table[name] }
    }

    // ── Variant classification (web `def.variant` union, default 'default') ─────────

    @Test
    fun fromRawMapsEveryKnownVariantKey() {
        assertEquals(CommandTileVariant.Danger, CommandTileVariant.fromRaw("danger"))
        assertEquals(CommandTileVariant.Success, CommandTileVariant.fromRaw("success"))
        assertEquals(CommandTileVariant.Default, CommandTileVariant.fromRaw("default"))
    }

    @Test
    fun fromRawFoldsAbsentBlankOrUnknownVariantToDefault() {
        // Web parity: the `?? 'default'` default applies for a missing prop, and the typed union never produces
        // an out-of-set value, so anything unrecognised folds to the default.
        assertEquals(CommandTileVariant.Default, CommandTileVariant.fromRaw(null))
        assertEquals(CommandTileVariant.Default, CommandTileVariant.fromRaw(""))
        assertEquals(CommandTileVariant.Default, CommandTileVariant.fromRaw("warning"))
    }

    @Test
    fun fromRawIsCaseSensitiveLikeTheWebUnion() {
        assertEquals(CommandTileVariant.Default, CommandTileVariant.fromRaw("DANGER"))
        assertEquals(CommandTileVariant.Default, CommandTileVariant.fromRaw("Success"))
    }

    // ── Status line (web `lastStatus.startsWith('✓') ? green : red`) ────────────────

    @Test
    fun statusLineForReturnsNullWhenThereIsNoStatus() {
        assertNull(InputCommandTileProjection.statusLineFor(null))
        assertNull(InputCommandTileProjection.statusLineFor(""))
        assertNull(InputCommandTileProjection.statusLineFor("   "))
    }

    @Test
    fun statusLineForClassifiesTickPrefixedResultsAsSuccess() {
        val withText = InputCommandTileProjection.statusLineFor("$tick Sent")
        assertEquals(CommandStatusLine("$tick Sent", CommandOutcome.Success), withText)

        // A bare tick is still a success, and the raw text is preserved verbatim for display.
        assertEquals(CommandOutcome.Success, InputCommandTileProjection.statusLineFor(tick)?.outcome)
    }

    @Test
    fun statusLineForClassifiesEverythingElseAsFailure() {
        assertEquals(CommandOutcome.Failure, InputCommandTileProjection.statusLineFor("$cross Failed")?.outcome)
        assertEquals(CommandOutcome.Failure, InputCommandTileProjection.statusLineFor("Error: timeout")?.outcome)
        // A tick that is not the FIRST character does not count (web `startsWith`).
        assertEquals(CommandOutcome.Failure, InputCommandTileProjection.statusLineFor("done $tick")?.outcome)
    }

    // ── Catalog key folding (web dotted key -> Android resource name) ───────────────

    @Test
    fun foldCatalogKeyPrefixesAndUnderscoresTheDottedKey() {
        assertEquals("translation_commands_toggleFavorite", foldCatalogKey("commands.toggleFavorite"))
        assertEquals("translation_commands_setChargeLimit_label", foldCatalogKey("commands.setChargeLimit.label"))
    }

    @Test
    fun foldCatalogKeyCollapsesNonIdentifierRunsAndTrimsEdges() {
        assertEquals("translation_a_b", foldCatalogKey(".a--b."))
        assertEquals("translation_commands_test", foldCatalogKey("commands..test"))
    }

    // ── Label resolution (web `t(key, fallback)`) ──────────────────────────────────

    @Test
    fun resolveTextReturnsTheFallbackForABlankKeyWithoutConsultingTheCatalog() {
        var consulted = false
        val lookup: (String) -> String? = {
            consulted = true
            null
        }
        assertEquals("Fallback", InputCommandTileProjection.resolveText(lookup, "", "Fallback"))
        assertTrue("blank key must short-circuit before any catalog lookup", !consulted)
    }

    @Test
    fun resolveTextPrefersTheCatalogEntryByFoldedResourceName() {
        val lookup = lookupOf("translation_commands_honk_label" to "Honk")
        assertEquals("Honk", InputCommandTileProjection.resolveText(lookup, "commands.honk.label", "Honk Horn"))
    }

    @Test
    fun resolveTextFallsBackWhenTheCatalogHasNoOrABlankEntry() {
        assertEquals("Honk Horn", InputCommandTileProjection.resolveText(lookupOf(), "commands.honk.label", "Honk Horn"))
        val blank = lookupOf("translation_commands_honk_label" to "   ")
        assertEquals("Honk Horn", InputCommandTileProjection.resolveText(blank, "commands.honk.label", "Honk Horn"))
    }

    // ── Sublabel gate (web `def.sublabelFallback && …`) ─────────────────────────────

    @Test
    fun sublabelIsHiddenWhenTheFallbackIsAbsentOrBlank() {
        assertNull(InputCommandTileProjection.sublabel(data(sublabelFallback = null), lookupOf()))
        assertNull(InputCommandTileProjection.sublabel(data(sublabelFallback = "  "), lookupOf()))
    }

    @Test
    fun sublabelResolvesThroughItsKeyThenFallsBackToTheProvidedText() {
        val lookup = lookupOf("translation_commands_x_sub" to "Resolved sub")
        val resolved = data(sublabelKey = "commands.x.sub", sublabelFallback = "Raw sub")
        assertEquals("Resolved sub", InputCommandTileProjection.sublabel(resolved, lookup))

        // Web `t(def.sublabelKey ?? '', def.sublabelFallback)`: a null key resolves straight to the fallback.
        val noKey = data(sublabelKey = null, sublabelFallback = "Raw sub")
        assertEquals("Raw sub", InputCommandTileProjection.sublabel(noKey, lookupOf()))
    }

    // ── End-to-end projection per rendered state ────────────────────────────────────

    @Test
    fun projectsAMinimalDefaultTile() {
        val lookup = lookupOf("translation_commands_wake_label" to "Wake")
        val display =
            InputCommandTileProjection.project(
                data(labelKey = "commands.wake.label", labelFallback = "Wake Up", sublabelFallback = null),
                lastStatus = null,
                lookup = lookup,
            )

        assertEquals("Wake", display.label)
        assertNull(display.sublabel)
        assertEquals(CommandTileVariant.Default, display.variant)
        assertNull(display.statusLine)
    }

    @Test
    fun projectsAFullDangerTileWithSuccessStatus() {
        val lookup =
            lookupOf(
                "translation_commands_start_label" to "Remote Start",
                "translation_commands_start_sub" to "Keyless drive",
            )
        val display =
            InputCommandTileProjection.project(
                data(
                    labelKey = "commands.start.label",
                    labelFallback = "Start",
                    sublabelKey = "commands.start.sub",
                    sublabelFallback = "Keyless",
                    variant = CommandTileVariant.Danger,
                ),
                lastStatus = "$tick Started",
                lookup = lookup,
            )

        assertEquals("Remote Start", display.label)
        assertEquals("Keyless drive", display.sublabel)
        assertEquals(CommandTileVariant.Danger, display.variant)
        assertEquals(CommandStatusLine("$tick Started", CommandOutcome.Success), display.statusLine)
    }

    @Test
    fun projectsASuccessVariantTileWithFailureStatusAndLabelFallback() {
        val display =
            InputCommandTileProjection.project(
                data(
                    labelKey = "commands.vent.label",
                    labelFallback = "Vent Windows",
                    variant = CommandTileVariant.Success,
                ),
                lastStatus = "$cross Timed out",
                lookup = lookupOf(),
            )

        // Catalog miss -> the definition's English fallback, exactly like web `t(key, fallback)`.
        assertEquals("Vent Windows", display.label)
        assertEquals(CommandTileVariant.Success, display.variant)
        assertEquals(CommandOutcome.Failure, display.statusLine?.outcome)
    }

    // ── Accessibility label contract (the favorite toggle's `aria-label` key) ───────

    @Test
    fun favoriteToggleLabelKeyFoldsToTheShippedCatalogResource() {
        // The web favorite control's `aria-label` is `t('commands.toggleFavorite', 'Toggle favorite')`; the
        // composable resolves R.string.translation_commands_toggleFavorite, which is the fold of that key. This
        // asserts the accessibility label routes through the P1/S10 catalog rather than an English literal.
        assertEquals(
            "translation_commands_toggleFavorite",
            foldCatalogKey(InputCommandTileDiagnostics.FAVORITE_LABEL_KEY),
        )
    }

    @Test
    fun statusTextIsPreservedVerbatimForDisplay() {
        // The render layer shows the status text as-is (it already carries its marker), so the projection must
        // not rewrite it.
        val raw = "$tick Charge limit set to 80%"
        assertSame(raw, InputCommandTileProjection.statusLineFor(raw)?.text)
    }

    private fun data(
        labelKey: String = "commands.test.label",
        labelFallback: String = "Test",
        sublabelKey: String? = null,
        sublabelFallback: String? = null,
        variant: CommandTileVariant = CommandTileVariant.Default,
    ) = CommandTileData(
        labelKey = labelKey,
        labelFallback = labelFallback,
        sublabelKey = sublabelKey,
        sublabelFallback = sublabelFallback,
        variant = variant,
    )
}
