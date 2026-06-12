package io.teslasync.android.featureviews.suggestedprompts

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the SuggestedPrompts surface's pure logic — the native analogue of the static
 * composition the web component owns (web/src/features/system/components/chatbot/SuggestedPrompts.tsx): the
 * fixed `getChatSuggestions()` catalogue (four items in fleetYesterday → chargingCost30d → socDropping →
 * efficientDrive order), each item's i18n key (the web entry's `i18nKey`), the empty guard, and the PII-safe
 * `view.opened` diagnostic. Runs in the offline `:app:testReleaseUnitTest` gate; the Compose render +
 * accessibility are covered by the on-device SuggestedPromptsUiTest.
 */
class SuggestedPromptsProjectionTest {
    // ── Catalogue: membership + order ───────────────────────────────────────────────

    @Test
    fun projectionHasTheFourWebSuggestionsInOrder() {
        assertEquals(
            listOf(
                ChatSuggestion.FleetYesterday,
                ChatSuggestion.ChargingCost30d,
                ChatSuggestion.SocDropping,
                ChatSuggestion.EfficientDrive,
            ),
            SuggestedPromptsProjection.suggestions,
        )
    }

    @Test
    fun projectionListsEverySuggestionExactlyOnce() {
        val suggestions = SuggestedPromptsProjection.suggestions

        assertEquals(ChatSuggestion.entries.size, suggestions.size)
        assertEquals(ChatSuggestion.entries.toSet(), suggestions.toSet())
    }

    // ── i18n keys: match the web `i18nKey` (canonical P1/S10 catalog keys) ───────────

    @Test
    fun eachSuggestionCarriesItsWebI18nKey() {
        assertEquals("chatbot.suggestion.fleetYesterday", ChatSuggestion.FleetYesterday.i18nKey)
        assertEquals("chatbot.suggestion.chargingCost30d", ChatSuggestion.ChargingCost30d.i18nKey)
        assertEquals("chatbot.suggestion.socDropping", ChatSuggestion.SocDropping.i18nKey)
        assertEquals("chatbot.suggestion.efficientDrive", ChatSuggestion.EfficientDrive.i18nKey)
    }

    @Test
    fun i18nKeysAreUniqueNonBlankAndChatbotScoped() {
        val keys = ChatSuggestion.entries.map { it.i18nKey }

        assertEquals("keys must be unique (stable list keys)", keys.size, keys.toSet().size)
        keys.forEach { key ->
            assertTrue("key must be non-blank", key.isNotBlank())
            assertTrue("key must be scoped to chatbot.suggestion.*", key.startsWith("chatbot.suggestion."))
        }
    }

    // ── Empty guard ─────────────────────────────────────────────────────────────────

    @Test
    fun catalogueIsNeverEmpty() {
        assertFalse(SuggestedPromptsProjection.isEmpty)
        assertTrue(SuggestedPromptsProjection.suggestions.isNotEmpty())
    }

    // ── Diagnostics: PII-safe view.opened ────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        SuggestedPromptsDiagnostics.recordViewOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "SuggestedPrompts"), fields)
    }

    @Test
    fun diagnosticCarriesNoPayloadFields() {
        val logger = RecordingLogger()

        SuggestedPromptsDiagnostics.recordViewOpened(logger)

        val fields = logger.records.single().fields
        assertEquals(setOf("surface"), fields.keys)
        assertTrue("diagnostic must leak no user data", fields.values.none { it.any(Char::isDigit) })
    }

    @Test
    fun diagnosticsSlugAndIdAreStable() {
        assertEquals("SuggestedPrompts", SuggestedPromptsDiagnostics.SLUG)
        assertEquals("suggested-prompts", SuggestedPromptsDiagnostics.ID)
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
}
