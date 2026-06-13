// Off-device unit tests for the pure AINLSqlPlayground model: the `draft_readonly_sql` tool_result parser (web
// `parseReadonlySQLDraft`, every reject + accept branch), the stream reducer, the surface classifier (every
// loading / empty / content / error / stale / offline branch the web component resolves), the freshness rule, the
// resolved-label facade, and the accessibility-label builders (TalkBack-label presence). Run by the offline
// :android:testReleaseUnitTest gate — no Compose, no Android framework, no coroutines.

package io.teslasync.android.sharedsurfaces.ainlsqlplayground

import io.teslasync.android.data.ErrorKind
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AINLSqlPlaygroundModelTest {
    private val window = DRAFT_FRESHNESS_WINDOW_MS

    private fun json(raw: String): JsonElement = Json.parseToJsonElement(raw)

    // ── parseReadonlySqlDraft: accept ──────────────────────────────────────────────
    @Test
    fun parsesAWellFormedOkDraft() {
        val data =
            json(
                """{"status":"ok","draft":{"prompt":"q","sql":"SELECT 1","rationale":"r",""" +
                    """"referenced_tables":["drives","charging_sessions"]}}""",
            )
        assertEquals(
            SqlDraft("q", "SELECT 1", "r", listOf("drives", "charging_sessions")),
            parseReadonlySqlDraft(data),
        )
    }

    @Test
    fun referencedTablesAreFilteredToStrings() {
        val data =
            json(
                """{"status":"ok","draft":{"prompt":"q","sql":"s","rationale":"r",""" +
                    """"referenced_tables":["a",1,true,"b",null]}}""",
            )
        assertEquals(listOf("a", "b"), parseReadonlySqlDraft(data)?.referencedTables)
    }

    @Test
    fun absentReferencedTablesYieldsEmptyList() {
        val data = json("""{"status":"ok","draft":{"prompt":"q","sql":"s","rationale":"r"}}""")
        assertEquals(emptyList<String>(), parseReadonlySqlDraft(data)?.referencedTables)
    }

    @Test
    fun nonArrayReferencedTablesYieldsEmptyList() {
        val data =
            json("""{"status":"ok","draft":{"prompt":"q","sql":"s","rationale":"r","referenced_tables":"drives"}}""")
        assertEquals(emptyList<String>(), parseReadonlySqlDraft(data)?.referencedTables)
    }

    // ── parseReadonlySqlDraft: reject ──────────────────────────────────────────────
    @Test
    fun nullPayloadIsRejected() {
        assertNull(parseReadonlySqlDraft(null))
    }

    @Test
    fun nonObjectPayloadIsRejected() {
        assertNull(parseReadonlySqlDraft(json("123")))
    }

    @Test
    fun nonOkStatusIsRejected() {
        assertNull(parseReadonlySqlDraft(json("""{"status":"error","draft":{"prompt":"q","sql":"s","rationale":"r"}}""")))
    }

    @Test
    fun missingDraftObjectIsRejected() {
        assertNull(parseReadonlySqlDraft(json("""{"status":"ok"}""")))
    }

    @Test
    fun nonObjectDraftIsRejected() {
        assertNull(parseReadonlySqlDraft(json("""{"status":"ok","draft":"nope"}""")))
    }

    @Test
    fun missingRequiredStringFieldsAreRejected() {
        assertNull(parseReadonlySqlDraft(json("""{"status":"ok","draft":{"sql":"s","rationale":"r"}}""")))
        assertNull(parseReadonlySqlDraft(json("""{"status":"ok","draft":{"prompt":"q","rationale":"r"}}""")))
        assertNull(parseReadonlySqlDraft(json("""{"status":"ok","draft":{"prompt":"q","sql":"s"}}""")))
    }

    @Test
    fun nonStringRequiredFieldIsRejected() {
        assertNull(parseReadonlySqlDraft(json("""{"status":"ok","draft":{"prompt":5,"sql":"s","rationale":"r"}}""")))
    }

    // ── reducer ─────────────────────────────────────────────────────────────────────
    @Test
    fun withPromptUpdatesPrompt() {
        assertEquals("hi", AiSqlDraftState().withPrompt("hi").prompt)
    }

    @Test
    fun startDraftingEntersStreamingAndClearsTransientsAndDraft() {
        val next =
            AiSqlDraftState(
                streamingText = "old",
                errorKind = ErrorKind.Http,
                draft = SqlDraft("p", "s", "r", emptyList()),
                committedText = "kept",
            ).startDrafting()
        assertEquals(DraftPhase.Streaming, next.phase)
        assertEquals("", next.streamingText)
        assertNull(next.errorKind)
        assertNull(next.draft)
        assertEquals("kept", next.committedText)
    }

    @Test
    fun deltaChunksAccumulate() {
        val next =
            AiSqlDraftState(phase = DraftPhase.Streaming)
                .onChunk(AiStreamChunk.Delta("SEL"), nowMs = 1L)
                .onChunk(AiStreamChunk.Delta("ECT"), nowMs = 2L)
        assertEquals("SELECT", next.streamingText)
        assertEquals(DraftPhase.Streaming, next.phase)
    }

    @Test
    fun draftCapturedStoresDraftWithoutEndingStream() {
        val draft = SqlDraft("q", "SELECT 1", "r", listOf("drives"))
        val next =
            AiSqlDraftState(phase = DraftPhase.Streaming)
                .onChunk(AiStreamChunk.DraftCaptured(draft), nowMs = 1L)
        assertEquals(draft, next.draft)
        assertEquals(DraftPhase.Streaming, next.phase)
    }

    @Test
    fun doneCommitsAccumulatedTextAndStamps() {
        val next =
            AiSqlDraftState(phase = DraftPhase.Streaming, streamingText = "done sql")
                .onChunk(AiStreamChunk.Done, nowMs = 42L)
        assertEquals(DraftPhase.Done, next.phase)
        assertEquals("done sql", next.committedText)
        assertEquals(42L, next.fetchedAt)
    }

    @Test
    fun doneWithBlankAccumulatorStaysBlank() {
        val next =
            AiSqlDraftState(phase = DraftPhase.Streaming, streamingText = "   ")
                .onChunk(AiStreamChunk.Done, nowMs = 7L)
        assertEquals(DraftPhase.Done, next.phase)
        assertTrue(next.committedText.isBlank())
    }

    @Test
    fun failedChunkSetsErrorKindAndKeepsCommittedAndDraft() {
        val draft = SqlDraft("p", "s", "r", emptyList())
        val next =
            AiSqlDraftState(phase = DraftPhase.Streaming, committedText = "prev", draft = draft)
                .onChunk(AiStreamChunk.Failed(ErrorKind.Network), nowMs = 1L)
        assertEquals(DraftPhase.Failed, next.phase)
        assertEquals(ErrorKind.Network, next.errorKind)
        assertEquals("prev", next.committedText)
        assertEquals(draft, next.draft)
    }

    @Test
    fun finishIfStreamingPromotesOnlyWhileStreaming() {
        val promoted = AiSqlDraftState(phase = DraftPhase.Streaming, streamingText = "x").finishIfStreaming(9L)
        assertEquals(DraftPhase.Done, promoted.phase)
        val untouched = AiSqlDraftState(phase = DraftPhase.Failed).finishIfStreaming(9L)
        assertEquals(DraftPhase.Failed, untouched.phase)
    }

    // ── derived state ────────────────────────────────────────────────────────────────
    @Test
    fun hasPromptAndCanStartTrimWhitespace() {
        assertFalse(AiSqlDraftState(prompt = "   ").hasPrompt)
        assertFalse(AiSqlDraftState(prompt = "   ").canStart)
        assertTrue(AiSqlDraftState(prompt = "  q  ").hasPrompt)
        assertEquals("q", AiSqlDraftState(prompt = "  q  ").trimmedPrompt)
    }

    @Test
    fun canApplyRequiresDraftAndNotStreaming() {
        val draft = SqlDraft("p", "s", "r", emptyList())
        assertTrue(AiSqlDraftState(phase = DraftPhase.Done, draft = draft).canApply)
        assertFalse(AiSqlDraftState(phase = DraftPhase.Streaming, draft = draft).canApply)
        assertFalse(AiSqlDraftState(phase = DraftPhase.Done, draft = null).canApply)
    }

    // ── classifier: gate + every state ─────────────────────────────────────────────
    @Test
    fun gateOffHidesSurface() {
        assertEquals(
            SqlDraftSurface.Hidden,
            classifyDraft(AiSqlDraftState(gateEnabled = false, prompt = "q"), nowMs = 0L),
        )
    }

    @Test
    fun restingReflectsCanStart() {
        assertEquals(SqlDraftSurface.Resting(canStart = true), classifyDraft(AiSqlDraftState(prompt = "q"), nowMs = 0L))
        assertEquals(SqlDraftSurface.Resting(canStart = false), classifyDraft(AiSqlDraftState(prompt = ""), nowMs = 0L))
    }

    @Test
    fun streamingWithoutTextIsWorking() {
        assertEquals(
            SqlDraftSurface.Working,
            classifyDraft(AiSqlDraftState(prompt = "q", phase = DraftPhase.Streaming), nowMs = 0L),
        )
    }

    @Test
    fun streamingWithTextIsLive() {
        assertEquals(
            SqlDraftSurface.Live("partial"),
            classifyDraft(
                AiSqlDraftState(prompt = "q", phase = DraftPhase.Streaming, streamingText = "partial"),
                nowMs = 0L,
            ),
        )
    }

    @Test
    fun doneWithTextIsReadyAndFreshWithinWindow() {
        assertEquals(
            SqlDraftSurface.Ready("sql", stale = false),
            classifyDraft(
                AiSqlDraftState(prompt = "q", phase = DraftPhase.Done, committedText = "sql", fetchedAt = 1_000L),
                nowMs = 1_000L + window - 1L,
            ),
        )
    }

    @Test
    fun doneWithTextIsReadyAndStaleBeyondWindow() {
        assertEquals(
            SqlDraftSurface.Ready("sql", stale = true),
            classifyDraft(
                AiSqlDraftState(prompt = "q", phase = DraftPhase.Done, committedText = "sql", fetchedAt = 1_000L),
                nowMs = 1_000L + window + 1L,
            ),
        )
    }

    @Test
    fun doneBlankIsEmpty() {
        assertEquals(
            SqlDraftSurface.Empty,
            classifyDraft(AiSqlDraftState(prompt = "q", phase = DraftPhase.Done, committedText = ""), nowMs = 0L),
        )
    }

    @Test
    fun failedNetworkWithLastKnownIsOfflineCached() {
        assertEquals(
            SqlDraftSurface.Cached("last", offline = true),
            classifyDraft(
                AiSqlDraftState(
                    prompt = "q",
                    phase = DraftPhase.Failed,
                    committedText = "last",
                    errorKind = ErrorKind.Network,
                ),
                nowMs = 0L,
            ),
        )
    }

    @Test
    fun failedHttpWithLastKnownIsNonOfflineCached() {
        assertEquals(
            SqlDraftSurface.Cached("last", offline = false),
            classifyDraft(
                AiSqlDraftState(
                    prompt = "q",
                    phase = DraftPhase.Failed,
                    committedText = "last",
                    errorKind = ErrorKind.Http,
                ),
                nowMs = 0L,
            ),
        )
    }

    @Test
    fun failedNetworkWithoutLastKnownIsOfflineFailure() {
        assertEquals(
            SqlDraftSurface.Failed(offline = true),
            classifyDraft(
                AiSqlDraftState(prompt = "q", phase = DraftPhase.Failed, errorKind = ErrorKind.Network),
                nowMs = 0L,
            ),
        )
    }

    @Test
    fun failedHttpWithoutLastKnownIsHardFailure() {
        assertEquals(
            SqlDraftSurface.Failed(offline = false),
            classifyDraft(
                AiSqlDraftState(prompt = "q", phase = DraftPhase.Failed, errorKind = ErrorKind.Http),
                nowMs = 0L,
            ),
        )
    }

    // ── freshness ───────────────────────────────────────────────────────────────────
    @Test
    fun isStaleHonorsWindowAndNullStamp() {
        assertFalse(isStale(fetchedAt = null, nowMs = 10_000L, windowMs = window))
        assertFalse(isStale(fetchedAt = 1_000L, nowMs = 1_000L + window, windowMs = window))
        assertTrue(isStale(fetchedAt = 1_000L, nowMs = 1_000L + window + 1L, windowMs = window))
    }

    // ── i18n facade ──────────────────────────────────────────────────────────────────
    @Test
    fun foldCatalogKeyMatchesGeneratorNaming() {
        assertEquals("translation_powerSql_aiDrafter_title", foldCatalogKey("powerSql.aiDrafter.title"))
        assertEquals("translation_nl_sql_playground", foldCatalogKey("nl-sql-playground"))
    }

    @Test
    fun fallbackResolverPaintsWebEnglish() {
        val labels = aiNlSqlLabels(FallbackResolver)
        assertEquals("Helix natural-language SQL drafter", labels.title)
        assertEquals("Draft SQL", labels.button)
        assertEquals("Helix", labels.badge)
        assertEquals("SQL request", labels.promptLabel)
        assertEquals("e.g. how many drives did I take last week", labels.promptHint)
        assertEquals("Apply to editor", labels.applyButton)
    }

    @Test
    fun resolverIsConsultedByFoldedKey() {
        val resolve: StringResolver = { key, fallback -> if (key == AiNlSqlKeys.BUTTON) "Bosquejar SQL" else fallback }
        assertEquals("Bosquejar SQL", aiNlSqlLabels(resolve).button)
        assertEquals("Helix natural-language SQL drafter", aiNlSqlLabels(resolve).title)
    }

    // ── accessibility labels ─────────────────────────────────────────────────────────
    @Test
    fun headerLabelMergesTitleBadgeAndDescription() {
        assertEquals(
            "Helix SQL (Helix). Draft a read-only query.",
            headerAccessibilityLabel("Helix SQL", "Helix", "Draft a read-only query."),
        )
    }

    @Test
    fun draftButtonContentDescriptionCarriesContextualVerb() {
        assertEquals("Ask Helix \u00b7 Draft SQL", draftButtonContentDescription("Ask Helix", "Draft SQL"))
    }

    @Test
    fun outputLabelCoversEveryAnnouncedSurface() {
        val labels =
            SqlDraftOutputLabels(
                working = "Helix is thinking",
                empty = "No data available",
                stale = "Stale",
                offline = "Offline",
                error = "Helix couldn't draft the query. Please try again.",
            )
        assertEquals("Helix is thinking", outputAccessibilityLabel(SqlDraftSurface.Working, labels))
        assertEquals("Helix is thinking", outputAccessibilityLabel(SqlDraftSurface.Live("p"), labels))
        assertEquals("sql", outputAccessibilityLabel(SqlDraftSurface.Ready("sql", stale = false), labels))
        assertEquals("Stale. sql", outputAccessibilityLabel(SqlDraftSurface.Ready("sql", stale = true), labels))
        assertEquals("No data available", outputAccessibilityLabel(SqlDraftSurface.Empty, labels))
        assertEquals("Offline. sql", outputAccessibilityLabel(SqlDraftSurface.Cached("sql", offline = true), labels))
        assertEquals(
            "Helix couldn't draft the query. Please try again. sql",
            outputAccessibilityLabel(SqlDraftSurface.Cached("sql", offline = false), labels),
        )
        assertEquals(
            "Helix couldn't draft the query. Please try again.",
            outputAccessibilityLabel(SqlDraftSurface.Failed(offline = true), labels),
        )
    }

    @Test
    fun outputLabelIsAbsentForRestingAndHidden() {
        val labels = SqlDraftOutputLabels("w", "e", "s", "o", "x")
        assertNull(outputAccessibilityLabel(SqlDraftSurface.Resting(canStart = true), labels))
        assertNull(outputAccessibilityLabel(SqlDraftSurface.Hidden, labels))
    }

    // ── registration constants ───────────────────────────────────────────────────────
    @Test
    fun registrationConstantsMatchWebContract() {
        assertEquals("AINLSqlPlayground", AI_NL_SQL_PLAYGROUND_SLUG)
        assertEquals("nl-sql-playground", NL_SQL_PLAYGROUND_FEATURE_ID)
        assertEquals("draft_readonly_sql", DRAFT_TOOL_NAME)
    }
}
