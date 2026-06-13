// Off-device unit coverage for the ConfirmDialog modal/dialog's pure model (P3 acceptance: adapter +
// per-branch + diagnostics tests). Exercises the variant -> severity mapping (web `variantToSeverity`), the
// "Don't ask again" honoured guard (web `silenceKey && variant !== 'danger' && !requireTypedConfirmation`), the
// typed-confirmation gate (web `typedMatches` / `confirmDisabled`), the typed-confirmation input-label fallback
// (web `typedConfirmationLabel ?? requireTypedConfirmation`), the silence-persist guard (web `silenceHonored &&
// silenceKey && dontAskAgain`), the silenced auto-resolve short-circuit (web `open && silenceHonored &&
// isSilenced`), the [ConfirmSilenceStore] contract via an in-memory fake, the registry identifiers, and the
// PII-safe `view.opened` diagnostic. No Compose / Android / HTTP — runs in :android:testReleaseUnitTest.
package io.teslasync.android.modalsdialogs.confirmdialog

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ConfirmDialogModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<Triple<LogLevel, String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Triple(level, event, fields)
        }
    }

    /** In-memory [ConfirmSilenceStore] mirroring web `lib/confirmSilence.ts` (a deduped set of action ids). */
    private class FakeSilenceStore : ConfirmSilenceStore {
        val silenced = mutableSetOf<String>()

        override fun isSilenced(key: String): Boolean = key.isNotEmpty() && key in silenced

        override fun silence(key: String) {
            if (key.isNotEmpty()) silenced += key
        }
    }

    // ---- Variant -> severity (web `variantToSeverity`) ---------------------------

    @Test
    fun severityFor_mapsDangerToCriticalAndWarningToWarn() {
        assertEquals(ConfirmSeverity.Critical, ConfirmDialogProjection.severityFor(ConfirmVariant.Danger))
        assertEquals(ConfirmSeverity.Warn, ConfirmDialogProjection.severityFor(ConfirmVariant.Warning))
    }

    // ---- Silence honoured guard (web `silenceKey && variant !== 'danger' && !requireTypedConfirmation`) ----

    @Test
    fun isSilenceHonored_onlyForNonDangerNonTypedWithKey() {
        assertTrue(
            ConfirmDialogProjection.isSilenceHonored(ConfirmVariant.Warning, requireTypedConfirmation = null, silenceKey = "reset-layout"),
        )
        // Danger always re-prompts, even with a key.
        assertFalse(
            ConfirmDialogProjection.isSilenceHonored(ConfirmVariant.Danger, requireTypedConfirmation = null, silenceKey = "reset-layout"),
        )
        // Typed-confirmation prompts always re-prompt.
        assertFalse(
            ConfirmDialogProjection.isSilenceHonored(
                ConfirmVariant.Warning,
                requireTypedConfirmation = "DELETE",
                silenceKey = "reset-layout",
            ),
        )
        // Absent / blank key is never honoured (web truthiness of `silenceKey`).
        assertFalse(ConfirmDialogProjection.isSilenceHonored(ConfirmVariant.Warning, requireTypedConfirmation = null, silenceKey = null))
        assertFalse(ConfirmDialogProjection.isSilenceHonored(ConfirmVariant.Warning, requireTypedConfirmation = null, silenceKey = ""))
    }

    // ---- Typed-confirmation gate (web `typedMatches` / `confirmDisabled`) ---------

    @Test
    fun typedMatches_isTrueWithoutAGateAndOnlyOnExactMatch() {
        assertTrue(ConfirmDialogProjection.typedMatches(requireTypedConfirmation = null, typed = ""))
        assertTrue(ConfirmDialogProjection.typedMatches(requireTypedConfirmation = null, typed = "anything"))
        assertFalse(ConfirmDialogProjection.typedMatches(requireTypedConfirmation = "DELETE", typed = ""))
        assertFalse(ConfirmDialogProjection.typedMatches(requireTypedConfirmation = "DELETE", typed = "delete"))
        assertTrue(ConfirmDialogProjection.typedMatches(requireTypedConfirmation = "DELETE", typed = "DELETE"))
    }

    @Test
    fun confirmEnabled_blockedByLoadingOrUnmetTypedGate() {
        // Loading always disables (web `confirmDisabled = loading || …`).
        assertFalse(ConfirmDialogProjection.confirmEnabled(loading = true, requireTypedConfirmation = null, typed = ""))
        // No gate, not loading -> enabled.
        assertTrue(ConfirmDialogProjection.confirmEnabled(loading = false, requireTypedConfirmation = null, typed = ""))
        // Gate present, unmet -> disabled; met -> enabled.
        assertFalse(ConfirmDialogProjection.confirmEnabled(loading = false, requireTypedConfirmation = "DELETE", typed = "DEL"))
        assertTrue(ConfirmDialogProjection.confirmEnabled(loading = false, requireTypedConfirmation = "DELETE", typed = "DELETE"))
    }

    // ---- Typed-confirmation input label (web `typedConfirmationLabel ?? requireTypedConfirmation`) ----

    @Test
    fun typedConfirmationInputLabel_prefersCustomThenFallsBackToRequiredToken() {
        assertEquals(
            "Type DELETE to confirm",
            ConfirmDialogProjection.typedConfirmationInputLabel(custom = "Type DELETE to confirm", requireTypedConfirmation = "DELETE"),
        )
        assertEquals("DELETE", ConfirmDialogProjection.typedConfirmationInputLabel(custom = null, requireTypedConfirmation = "DELETE"))
        assertNull(ConfirmDialogProjection.typedConfirmationInputLabel(custom = null, requireTypedConfirmation = null))
    }

    // ---- Silence-persist guard (web `silenceHonored && silenceKey && dontAskAgain`) ----

    @Test
    fun shouldPersistSilence_requiresHonoredKeyAndCheckbox() {
        assertTrue(ConfirmDialogProjection.shouldPersistSilence(silenceHonored = true, silenceKey = "reset-layout", dontAskAgain = true))
        assertFalse(ConfirmDialogProjection.shouldPersistSilence(silenceHonored = false, silenceKey = "reset-layout", dontAskAgain = true))
        assertFalse(ConfirmDialogProjection.shouldPersistSilence(silenceHonored = true, silenceKey = "reset-layout", dontAskAgain = false))
        assertFalse(ConfirmDialogProjection.shouldPersistSilence(silenceHonored = true, silenceKey = null, dontAskAgain = true))
    }

    // ---- Silenced auto-resolve (web `if (open && silenceHonored && isSilenced(silenceKey)) return null`) ----

    @Test
    fun suppressRender_isTrueOnlyWhenHonoredAndSilenced() {
        // Honoured + silenced -> auto-resolve (suppress render).
        val warnHonored =
            ConfirmDialogProjection.isSilenceHonored(ConfirmVariant.Warning, requireTypedConfirmation = null, silenceKey = "reset-layout")
        assertTrue(warnHonored)
        assertTrue(ConfirmDialogProjection.suppressRender(silenceHonored = warnHonored, silenced = true))
        // Honoured but not yet silenced -> render normally.
        assertFalse(ConfirmDialogProjection.suppressRender(silenceHonored = warnHonored, silenced = false))

        // Danger ignores a stored silence (never honoured) -> render normally.
        val dangerHonored =
            ConfirmDialogProjection.isSilenceHonored(ConfirmVariant.Danger, requireTypedConfirmation = null, silenceKey = "reset-layout")
        assertFalse(dangerHonored)
        assertFalse(ConfirmDialogProjection.suppressRender(silenceHonored = dangerHonored, silenced = true))
    }

    // ---- Silence store contract (web `lib/confirmSilence` isSilenced/silence) ----

    @Test
    fun silenceStore_persistsAcrossReadsAndIgnoresBlankKeys() {
        val store = FakeSilenceStore()
        assertFalse(store.isSilenced("reset-layout"))
        store.silence("reset-layout")
        assertTrue(store.isSilenced("reset-layout"))
        // A different id stays un-silenced; a blank key is a no-op.
        assertFalse(store.isSilenced("remove-widget"))
        store.silence("")
        assertFalse(store.isSilenced(""))
    }

    @Test
    fun noopSilenceStore_neverSilences() {
        NoopConfirmSilenceStore.silence("reset-layout")
        assertFalse(NoopConfirmSilenceStore.isSilenced("reset-layout"))
    }

    // ---- Registry + diagnostics --------------------------------------------------

    @Test
    fun registrationIdentifiersAreStable() {
        assertEquals("confirm-dialog", ConfirmDialogRegistration.ID)
        assertEquals("ConfirmDialog", ConfirmDialogRegistration.SLUG)
    }

    @Test
    fun recordViewOpened_emitsPiiSafeViewOpened() {
        val logger = RecordingLogger()
        ConfirmDialogDiagnostics.recordViewOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "ConfirmDialog"), fields)
    }
}
