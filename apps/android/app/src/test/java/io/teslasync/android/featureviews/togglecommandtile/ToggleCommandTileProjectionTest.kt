package io.teslasync.android.featureviews.togglecommandtile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the ToggleCommandTile's pure logic — the native mirror of every derivation the web
 * component performs (web/src/features/system/components/ToggleCommandTile.tsx): the `isOn` derivation
 * (`def.stateField && state ? Boolean(state[def.stateField]) : localToggle`), the `handleClick` precedence
 * (here [ToggleClickResolver]), the `def.variant ?? 'default'` union, the dynamic `t(key, fallback)` label
 * resolution, and the `lastStatus.startsWith('✓')` success-vs-failure status line. Because the surface is purely
 * presentational each [ToggleCommandTileDisplay] is exactly what the thin composable renders, so these
 * assertions double as the per-state "snapshot". Runs in the :android:testReleaseUnitTest gate.
 */
class ToggleCommandTileProjectionTest {
    private val tick = "\u2713"
    private val cross = "\u2717"

    private fun lookupOf(vararg pairs: Pair<String, String?>): (String) -> String? {
        val table = pairs.toMap()
        return { name -> table[name] }
    }

    // ── Variant classification (web `def.variant` union, default 'default') ─────────

    @Test
    fun fromRawMapsEveryKnownVariantKey() {
        assertEquals(ToggleVariant.Danger, ToggleVariant.fromRaw("danger"))
        assertEquals(ToggleVariant.Success, ToggleVariant.fromRaw("success"))
        assertEquals(ToggleVariant.Default, ToggleVariant.fromRaw("default"))
    }

    @Test
    fun fromRawFoldsAbsentBlankOrUnknownVariantToDefault() {
        assertEquals(ToggleVariant.Default, ToggleVariant.fromRaw(null))
        assertEquals(ToggleVariant.Default, ToggleVariant.fromRaw(""))
        assertEquals(ToggleVariant.Default, ToggleVariant.fromRaw("warning"))
    }

    @Test
    fun fromRawIsCaseSensitiveLikeTheWebUnion() {
        assertEquals(ToggleVariant.Default, ToggleVariant.fromRaw("DANGER"))
        assertEquals(ToggleVariant.Default, ToggleVariant.fromRaw("Success"))
    }

    // ── Tap resolution (web `handleClick`) ──────────────────────────────────────────

    @Test
    fun resolveIgnoresWhileLoading() {
        // web `if (loading) return` — regardless of any other flag.
        assertEquals(ToggleAction.Ignore, ToggleClickResolver.resolve(loading = true, isOn = false, hasInputConfig = false))
    }

    @Test
    fun loadingTakesPrecedenceOverEveryOtherFlag() {
        // web checks loading FIRST, so a loading on/input tile still ignores the tap.
        assertEquals(ToggleAction.Ignore, ToggleClickResolver.resolve(loading = true, isOn = true, hasInputConfig = true))
    }

    @Test
    fun resolveTurnsOffWhenOn() {
        // web `if (isOn) { … onExecute(def.commandOff!) }` — and isOn wins over inputConfig.
        assertEquals(ToggleAction.TurnOff, ToggleClickResolver.resolve(loading = false, isOn = true, hasInputConfig = false))
        assertEquals(ToggleAction.TurnOff, ToggleClickResolver.resolve(loading = false, isOn = true, hasInputConfig = true))
    }

    @Test
    fun resolveRequestsDialogWhenOffAndInputIsNeeded() {
        // web else-branch: `if (def.inputConfig) onRequestDialog(def)`.
        assertEquals(
            ToggleAction.RequestDialog,
            ToggleClickResolver.resolve(loading = false, isOn = false, hasInputConfig = true),
        )
    }

    @Test
    fun resolveTurnsOnWhenOffAndNoInputIsNeeded() {
        // web else-branch: `onExecute(def.command, def.params)`.
        assertEquals(ToggleAction.TurnOn, ToggleClickResolver.resolve(loading = false, isOn = false, hasInputConfig = false))
    }

    // ── On/off derivation (web `def.stateField && state ? Boolean(state[def.stateField]) : localToggle`) ──

    @Test
    fun isOnReadsTheControlledStateFieldWhenPresent() {
        val state = mapOf("sentry_mode" to true, "is_climate_on" to false)
        // localToggle is ignored when a stateField + state are both present.
        assertTrue(ToggleCommandTileProjection.isOn("sentry_mode", state, localToggle = false))
        assertFalse(ToggleCommandTileProjection.isOn("is_climate_on", state, localToggle = true))
    }

    @Test
    fun isOnTreatsAMissingOrNullStateKeyAsOff() {
        // web `Boolean(state[def.stateField])`: an absent/null key coerces to false.
        assertFalse(ToggleCommandTileProjection.isOn("sentry_mode", mapOf("is_locked" to true), localToggle = true))
        assertFalse(ToggleCommandTileProjection.isOn("sentry_mode", mapOf("sentry_mode" to null), localToggle = true))
    }

    @Test
    fun isOnFallsBackToLocalToggleWithoutAStateFieldOrState() {
        // web `def.stateField && state ? … : localToggle` — either guard failing uses the local toggle.
        assertTrue(ToggleCommandTileProjection.isOn(stateField = null, vehicleState = mapOf("x" to false), localToggle = true))
        assertTrue(ToggleCommandTileProjection.isOn(stateField = "  ", vehicleState = mapOf("x" to false), localToggle = true))
        assertTrue(ToggleCommandTileProjection.isOn(stateField = "sentry_mode", vehicleState = null, localToggle = true))
        assertFalse(ToggleCommandTileProjection.isOn(stateField = "sentry_mode", vehicleState = null, localToggle = false))
    }

    // ── Status line (web `lastStatus.startsWith('✓') ? green : red`) ─────────────────

    @Test
    fun statusLineForReturnsNullWhenThereIsNoStatus() {
        assertNull(ToggleCommandTileProjection.statusLineFor(null))
        assertNull(ToggleCommandTileProjection.statusLineFor(""))
        assertNull(ToggleCommandTileProjection.statusLineFor("   "))
    }

    @Test
    fun statusLineForClassifiesTickPrefixedResultsAsSuccess() {
        assertEquals(
            CommandStatusLine("$tick Sent", CommandOutcome.Success),
            ToggleCommandTileProjection.statusLineFor("$tick Sent"),
        )
        assertEquals(CommandOutcome.Success, ToggleCommandTileProjection.statusLineFor(tick)?.outcome)
    }

    @Test
    fun statusLineForClassifiesEverythingElseAsFailure() {
        assertEquals(CommandOutcome.Failure, ToggleCommandTileProjection.statusLineFor("$cross Failed")?.outcome)
        assertEquals(CommandOutcome.Failure, ToggleCommandTileProjection.statusLineFor("Error: timeout")?.outcome)
        // A tick that is not the FIRST character does not count (web `startsWith`).
        assertEquals(CommandOutcome.Failure, ToggleCommandTileProjection.statusLineFor("done $tick")?.outcome)
    }

    @Test
    fun statusTextIsPreservedVerbatimForDisplay() {
        val raw = "$tick Sentry enabled"
        assertSame(raw, ToggleCommandTileProjection.statusLineFor(raw)?.text)
    }

    // ── Catalog key folding + label resolution (web `t(key, fallback)`) ──────────────

    @Test
    fun foldCatalogKeyPrefixesAndUnderscoresTheDottedKey() {
        assertEquals("translation_commands_on", foldCatalogKey("commands.on"))
        assertEquals("translation_commands_sentryMode_label", foldCatalogKey("commands.sentryMode.label"))
    }

    @Test
    fun foldCatalogKeyCollapsesNonIdentifierRunsAndTrimsEdges() {
        assertEquals("translation_a_b", foldCatalogKey(".a--b."))
        assertEquals("translation_commands_test", foldCatalogKey("commands..test"))
    }

    @Test
    fun resolveTextReturnsTheFallbackForABlankKeyWithoutConsultingTheCatalog() {
        var consulted = false
        val lookup: (String) -> String? = {
            consulted = true
            null
        }
        assertEquals("Fallback", ToggleCommandTileProjection.resolveText(lookup, "", "Fallback"))
        assertTrue("blank key must short-circuit before any catalog lookup", !consulted)
    }

    @Test
    fun resolveTextPrefersTheCatalogEntryThenFallsBack() {
        val hit = lookupOf("translation_commands_sentry_label" to "Sentry")
        assertEquals("Sentry", ToggleCommandTileProjection.resolveText(hit, "commands.sentry.label", "Sentry Mode"))
        // Catalog miss + blank entry both fall back to the definition's English text.
        assertEquals("Sentry Mode", ToggleCommandTileProjection.resolveText(lookupOf(), "commands.sentry.label", "Sentry Mode"))
        val blank = lookupOf("translation_commands_sentry_label" to "   ")
        assertEquals("Sentry Mode", ToggleCommandTileProjection.resolveText(blank, "commands.sentry.label", "Sentry Mode"))
    }

    // ── End-to-end projection per rendered state ─────────────────────────────────────

    @Test
    fun projectsAnOffUncontrolledDefaultTile() {
        val display =
            ToggleCommandTileProjection.project(
                data = data(labelKey = "commands.fart.label", labelFallback = "Boombox"),
                vehicleState = null,
                localToggle = false,
                lastStatus = null,
                lookup = lookupOf("translation_commands_fart_label" to "Boombox"),
            )

        assertEquals("Boombox", display.label)
        assertFalse(display.isOn)
        assertEquals(ToggleVariant.Default, display.variant)
        assertNull(display.statusLine)
    }

    @Test
    fun projectsAnOnControlledDangerTileWithSuccessStatus() {
        val display =
            ToggleCommandTileProjection.project(
                data =
                    data(
                        labelKey = "commands.sentry.label",
                        labelFallback = "Sentry",
                        stateField = "sentry_mode",
                        variant = ToggleVariant.Danger,
                    ),
                vehicleState = mapOf("sentry_mode" to true),
                localToggle = false,
                lastStatus = "$tick Enabled",
                lookup = lookupOf("translation_commands_sentry_label" to "Sentry Mode"),
            )

        assertEquals("Sentry Mode", display.label)
        assertTrue(display.isOn)
        assertEquals(ToggleVariant.Danger, display.variant)
        assertEquals(CommandStatusLine("$tick Enabled", CommandOutcome.Success), display.statusLine)
    }

    @Test
    fun projectsAnOnUncontrolledTileFromLocalToggleWithLabelFallback() {
        val display =
            ToggleCommandTileProjection.project(
                data = data(labelKey = "commands.steering.label", labelFallback = "Steering Heater", variant = ToggleVariant.Success),
                vehicleState = null,
                localToggle = true,
                lastStatus = "$cross Timed out",
                lookup = lookupOf(),
            )

        // Catalog miss -> the definition's English fallback, exactly like web `t(key, fallback)`.
        assertEquals("Steering Heater", display.label)
        assertTrue(display.isOn)
        assertEquals(ToggleVariant.Success, display.variant)
        assertEquals(CommandOutcome.Failure, display.statusLine?.outcome)
    }

    // ── Accessibility label contract (the favourite / on / off keys) ─────────────────

    @Test
    fun accessibilityLabelKeysFoldToTheShippedCatalogResources() {
        // The favourite control's `aria-label` and the ON/OFF line resolve through the P1/S10 catalog rather
        // than English literals; these assert each web key folds to the shipped Android resource name.
        assertEquals("translation_commands_toggleFavorite", foldCatalogKey(ToggleCommandTileDiagnostics.FAVORITE_LABEL_KEY))
        assertEquals("translation_commands_on", foldCatalogKey(ToggleCommandTileDiagnostics.ON_LABEL_KEY))
        assertEquals("translation_commands_off", foldCatalogKey(ToggleCommandTileDiagnostics.OFF_LABEL_KEY))
    }

    @Test
    fun dataAppliesSafeDefaults() {
        val bare = ToggleCommandTileData(labelKey = "commands.x.label", labelFallback = "X", command = "x_on")
        assertNull(bare.commandOff)
        assertNull(bare.stateField)
        assertFalse(bare.hasInputConfig)
        assertEquals(ToggleVariant.Default, bare.variant)
        assertTrue(bare.params.isEmpty())
    }

    private fun data(
        labelKey: String = "commands.test.label",
        labelFallback: String = "Test",
        stateField: String? = null,
        variant: ToggleVariant = ToggleVariant.Default,
    ) = ToggleCommandTileData(
        labelKey = labelKey,
        labelFallback = labelFallback,
        command = "cmd_on",
        commandOff = "cmd_off",
        stateField = stateField,
        variant = variant,
    )
}
