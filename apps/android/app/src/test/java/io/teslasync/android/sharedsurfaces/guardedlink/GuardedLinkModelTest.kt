// Off-device coverage of the framework-free GuardedLink model — the navigation-plan decision
// (web `onClick` branch order), the dirty-guard scan (web `findDirty`), the prompt-message fallback
// (web `pending?.message ?? t('forms.unsavedWarning')`), and the PII-safe diagnostics. Runs in the
// :android:testReleaseUnitTest gate.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.guardedlink

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class GuardedLinkModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }

    private fun entry(
        id: String,
        dirty: Boolean,
        message: String? = null,
    ) = NavigationGuardEntry(id = id, isDirty = { dirty }, getMessage = { message })

    // ── planNavigation: the web onClick branch order ──────────────────────────────────────────────────

    @Test
    fun cleanTreeNavigatesNow() {
        assertEquals(
            NavigationPlan.NavigateNow,
            planNavigation(bypassGuard = false, alreadyConfirming = false, hasDirtyGuard = false),
        )
    }

    @Test
    fun dirtyTreeAwaitsConfirmation() {
        assertEquals(
            NavigationPlan.AwaitConfirmation,
            planNavigation(bypassGuard = false, alreadyConfirming = false, hasDirtyGuard = true),
        )
    }

    @Test
    fun confirmationInFlightIgnoresDuplicateTap() {
        assertEquals(
            NavigationPlan.Ignore,
            planNavigation(bypassGuard = false, alreadyConfirming = true, hasDirtyGuard = true),
        )
    }

    @Test
    fun bypassNavigatesNowEvenWhenDirtyAndConfirming() {
        // The bypass branch (web modifier / middle-click / target="_blank") wins over every guard state.
        assertEquals(
            NavigationPlan.NavigateNow,
            planNavigation(bypassGuard = true, alreadyConfirming = true, hasDirtyGuard = true),
        )
    }

    // ── firstDirtyEntry: web findDirty() ──────────────────────────────────────────────────────────────

    @Test
    fun firstDirtyEntryIsNullWhenNoneRegistered() {
        assertNull(firstDirtyEntry(emptyList()))
    }

    @Test
    fun firstDirtyEntryIsNullWhenNoneDirty() {
        assertNull(firstDirtyEntry(listOf(entry("a", dirty = false), entry("b", dirty = false))))
    }

    @Test
    fun firstDirtyEntryReturnsEarliestDirtyInRegistrationOrder() {
        val first = entry("a", dirty = true, message = "first")
        val second = entry("b", dirty = true, message = "second")
        assertSame(first, firstDirtyEntry(listOf(entry("z", dirty = false), first, second)))
    }

    // ── resolvePromptMessage: web pending?.message ?? fallback ───────────────────────────────────────

    private val chrome =
        NavGuardChrome(
            title = "Unsaved changes",
            fallbackMessage = "You have unsaved changes. Discard them?",
            discardLabel = "Discard changes",
            keepEditingLabel = "Keep editing",
        )

    @Test
    fun promptMessagePrefersTheBlockingGuardMessage() {
        assertEquals(
            "You have an unsaved alert rule.",
            resolvePromptMessage(NavGuardPrompt("You have an unsaved alert rule."), chrome),
        )
    }

    @Test
    fun promptMessageFallsBackWhenMessageIsNull() {
        assertEquals(chrome.fallbackMessage, resolvePromptMessage(NavGuardPrompt(null), chrome))
    }

    @Test
    fun promptMessageFallsBackWhenMessageIsBlank() {
        assertEquals(chrome.fallbackMessage, resolvePromptMessage(NavGuardPrompt("   "), chrome))
    }

    // ── instance ids ──────────────────────────────────────────────────────────────────────────────────

    @Test
    fun instanceIdsAreFreshPerPlacement() {
        val a = randomLinkInstanceId()
        val b = randomLinkInstanceId()
        assertTrue(a.isNotBlank())
        assertFalse(a == b)
    }

    // ── diagnostics: PII-safe slug + outcome only ────────────────────────────────────────────────────

    @Test
    fun viewOpenedRecordsSlugOnly() {
        val logger = RecordingLogger()
        recordGuardedLinkOpened(logger)
        val record = logger.records.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals(EVENT_VIEW_OPENED, record.event)
        assertEquals(mapOf(FIELD_SURFACE to GuardedLinkRegistration.SLUG), record.fields)
    }

    @Test
    fun navigationRecordsSlugAndLowercasedOutcome() {
        val logger = RecordingLogger()
        recordGuardedLinkNavigation(logger, NavigationOutcome.Blocked)
        val record = logger.records.single()
        assertEquals(EVENT_NAVIGATE, record.event)
        assertEquals(
            mapOf(FIELD_SURFACE to GuardedLinkRegistration.SLUG, FIELD_OUTCOME to "blocked"),
            record.fields,
        )
    }

    @Test
    fun everyOutcomeMapsToItsLowercaseName() {
        val logger = RecordingLogger()
        NavigationOutcome.entries.forEach { recordGuardedLinkNavigation(logger, it) }
        val outcomes = logger.records.map { it.fields.getValue(FIELD_OUTCOME) }
        assertEquals(listOf("bypassed", "allowed", "blocked", "deferred"), outcomes)
    }

    @Test
    fun diagnosticsNeverLeakADestinationField() {
        val logger = RecordingLogger()
        recordGuardedLinkNavigation(logger, NavigationOutcome.Allowed)
        // Only the surface slug + the outcome enum are ever recorded — no route, query, or user content.
        val record = logger.records.single()
        assertEquals(setOf(FIELD_SURFACE, FIELD_OUTCOME), record.fields.keys)
    }
}
