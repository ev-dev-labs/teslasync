package io.teslasync.android.featureviews.commandtile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the CommandTile's pure logic — the native analogue of every derivation the web
 * component performs (web/src/features/system/components/CommandTile.tsx): the `handleClick` precedence
 * (here [CommandTileClickResolver]), the `lastStatus.startsWith('✓')` tone (here [CommandStatusTone]), the
 * `def.variant ?? 'default'` fallback (here [CommandVariant]), the [CommandTileDef] defaults, and the surface
 * registration identifiers. Runs in the :android:testReleaseUnitTest gate; the on-device render + accessibility
 * are covered by CommandTileUiTest.
 */
class CommandTileModelTest {
    // ── Tap resolution (web `handleClick`) ────────────────────────────────────────

    @Test
    fun resolveExecutesForAnOrdinaryTile() {
        // web else-branch: onExecute(def.command, def.params).
        assertEquals(CommandTileAction.Execute, CommandTileClickResolver.resolve(loading = false, dangerous = false))
    }

    @Test
    fun resolveRequestsDialogForADangerousTile() {
        // web: if (def.dangerous) { onRequestDialog(def); return; }
        assertEquals(CommandTileAction.RequestDialog, CommandTileClickResolver.resolve(loading = false, dangerous = true))
    }

    @Test
    fun resolveIgnoresWhileLoading() {
        // web: if (loading) return — regardless of any other flag.
        assertEquals(CommandTileAction.Ignore, CommandTileClickResolver.resolve(loading = true, dangerous = false))
    }

    @Test
    fun loadingTakesPrecedenceOverDangerous() {
        // web `handleClick` checks loading FIRST, so a loading dangerous tile still ignores the tap.
        assertEquals(CommandTileAction.Ignore, CommandTileClickResolver.resolve(loading = true, dangerous = true))
    }

    // ── Status tone (web `lastStatus.startsWith('✓') ? green : red`, gated by truthiness) ──

    @Test
    fun statusToneIsNoneForNullOrBlank() {
        // web `{lastStatus && …}` — a falsy status renders no line.
        assertEquals(CommandStatusTone.None, CommandStatusTone.fromStatus(null))
        assertEquals(CommandStatusTone.None, CommandStatusTone.fromStatus(""))
        assertEquals(CommandStatusTone.None, CommandStatusTone.fromStatus("   "))
    }

    @Test
    fun statusToneIsSuccessForCheckPrefix() {
        assertEquals(CommandStatusTone.Success, CommandStatusTone.fromStatus("${CommandStatusTone.SUCCESS_PREFIX} Sent"))
        assertEquals(CommandStatusTone.Success, CommandStatusTone.fromStatus(CommandStatusTone.SUCCESS_PREFIX))
    }

    @Test
    fun statusToneIsErrorForAnyOtherNonBlank() {
        assertEquals(CommandStatusTone.Error, CommandStatusTone.fromStatus("Failed"))
        assertEquals(CommandStatusTone.Error, CommandStatusTone.fromStatus("✗ Timed out"))
    }

    // ── Variant fallback (web `def.variant ?? 'default'`) ─────────────────────────

    @Test
    fun variantMapsEveryKnownValue() {
        assertEquals(CommandVariant.Default, CommandVariant.fromRaw("default"))
        assertEquals(CommandVariant.Danger, CommandVariant.fromRaw("danger"))
        assertEquals(CommandVariant.Success, CommandVariant.fromRaw("success"))
    }

    @Test
    fun variantFoldsNullBlankAndUnknownToDefault() {
        // web `def.variant ?? 'default'` plus an unknown union member is the same safe outcome.
        assertEquals(CommandVariant.Default, CommandVariant.fromRaw(null))
        assertEquals(CommandVariant.Default, CommandVariant.fromRaw(""))
        assertEquals(CommandVariant.Default, CommandVariant.fromRaw("warning"))
    }

    @Test
    fun variantIsCaseAndWhitespaceTolerant() {
        assertEquals(CommandVariant.Danger, CommandVariant.fromRaw("  DANGER "))
        assertEquals(CommandVariant.Success, CommandVariant.fromRaw("Success"))
    }

    @Test
    fun everyVariantIsReachableFromItsLowercaseName() {
        // Guards against a variant being added without a matching fromRaw key (drift).
        CommandVariant.entries.forEach { variant ->
            assertEquals(variant, CommandVariant.fromRaw(variant.name.lowercase()))
        }
    }

    // ── Definition defaults ───────────────────────────────────────────────────────

    @Test
    fun definitionAppliesSafeDefaults() {
        val def = CommandTileDef(id = "honk", command = "honk_horn", label = "Honk")
        assertNull(def.sublabel)
        assertEquals(CommandVariant.Default, def.variant)
        assertFalse(def.dangerous)
        assertTrue(def.params.isEmpty())
    }

    // ── Registration identifiers (P1/S11) ─────────────────────────────────────────

    @Test
    fun registrationExposesStableIdAndSlug() {
        assertEquals("command-tile", CommandTileRegistration.ID)
        assertEquals("CommandTile", CommandTileRegistration.SLUG)
    }
}
