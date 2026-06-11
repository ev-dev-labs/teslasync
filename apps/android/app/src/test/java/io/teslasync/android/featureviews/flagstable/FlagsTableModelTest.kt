package io.teslasync.android.featureviews.flagstable

import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.SortState
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the FlagsTable pure model — the native port of the web component's
 * `previewValue` JSON renderer, the sort-by-key ordering (`useSortToggle('key', 'asc')` +
 * `[...rows].sort`), the loading/empty body-message selection, and the PII-safe `view.opened`
 * diagnostic. Mirrors the web spec (web/src/features/admin/components/feature-flags/FlagsTable.tsx).
 */
class FlagsTableModelTest {
    private val labels =
        FlagsTableLabels(
            keyHeader = "Flag key",
            valueHeader = "Value",
            actionsHeader = "Actions",
            editLabel = "Edit",
            deleteLabel = "Delete",
            loadingMessage = "LOADING",
            emptyMessage = "EMPTY",
        )

    private fun entry(
        key: String,
        value: JsonElement? = JsonNull,
    ) = FeatureFlagEntry(key, value)

    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }

    // ── previewValue (web previewValue) ───────────────────────────────────────────────────────────

    @Test
    fun previewAbsentValueIsEmDash() {
        // Web: `value === undefined` → '—'. A Kotlin null models the absent value.
        assertEquals("\u2014", previewValue(null))
    }

    @Test
    fun previewJsonNullIsNullLiteral() {
        assertEquals("null", previewValue(JsonNull))
    }

    @Test
    fun previewStringIsQuoted() {
        // Web: typeof 'string' → JSON.stringify(value) → quoted + escaped.
        assertEquals("\"dark\"", previewValue(JsonPrimitive("dark")))
        assertEquals("\"a\\\"b\"", previewValue(JsonPrimitive("a\"b")))
    }

    @Test
    fun previewBooleanAndNumberAreBare() {
        // Web: typeof 'boolean' | 'number' → String(value) → no quotes.
        assertEquals("true", previewValue(JsonPrimitive(true)))
        assertEquals("false", previewValue(JsonPrimitive(false)))
        assertEquals("50000", previewValue(JsonPrimitive(50_000)))
        assertEquals("3.5", previewValue(JsonPrimitive(3.5)))
    }

    @Test
    fun previewObjectIsCompactJson() {
        val value = buildJsonObject { put("a", 1) }
        assertEquals("{\"a\":1}", previewValue(value))
    }

    @Test
    fun previewArrayIsCompactJson() {
        val value =
            buildJsonArray {
                add(JsonPrimitive(1))
                add(JsonPrimitive(2))
            }
        assertEquals("[1,2]", previewValue(value))
    }

    @Test
    fun previewLongValueIsTruncatedWithEllipsis() {
        val value = buildJsonObject { put("k", "x".repeat(200)) }
        val preview = previewValue(value)
        // Web: json.slice(0, 117) + '…' → 117 chars + the 1-char ellipsis.
        assertEquals(PREVIEW_SLICE + 1, preview.length)
        assertTrue(preview.startsWith("{\"k\":\"x"))
        assertTrue(preview.endsWith("\u2026"))
    }

    @Test
    fun previewExactly120IsNotTruncated() {
        // A compact JSON of length == PREVIEW_MAX_LENGTH is rendered whole (web `> 120`).
        val padLength = PREVIEW_MAX_LENGTH - "{\"k\":\"\"}".length
        val value = buildJsonObject { put("k", "y".repeat(padLength)) }
        val preview = previewValue(value)
        assertEquals(PREVIEW_MAX_LENGTH, preview.length)
        assertTrue(preview.endsWith("\"}"))
    }

    // ── sortFlags (web [...rows].sort) ────────────────────────────────────────────────────────────

    private val unsorted = listOf(entry("charlie"), entry("alpha"), entry("bravo"))

    @Test
    fun sortAscendingByKey() {
        val sorted = sortFlags(unsorted, SortState(SORT_KEY_KEY, SortDirection.Asc))
        assertEquals(listOf("alpha", "bravo", "charlie"), sorted.map { it.key })
    }

    @Test
    fun sortDescendingByKey() {
        val sorted = sortFlags(unsorted, SortState(SORT_KEY_KEY, SortDirection.Desc))
        assertEquals(listOf("charlie", "bravo", "alpha"), sorted.map { it.key })
    }

    @Test
    fun sortNonKeyColumnPreservesOrder() {
        // The web comparator returns 0 for any non-'key' sort column, leaving the order untouched.
        val sorted = sortFlags(unsorted, SortState("value", SortDirection.Asc))
        assertEquals(listOf("charlie", "alpha", "bravo"), sorted.map { it.key })
    }

    @Test
    fun sortNullKeyPreservesOrder() {
        val sorted = sortFlags(unsorted, SortState(null, SortDirection.Asc))
        assertEquals(unsorted, sorted)
    }

    @Test
    fun sortEmptyIsEmpty() {
        assertTrue(sortFlags(emptyList(), SortState(SORT_KEY_KEY, SortDirection.Asc)).isEmpty())
    }

    // ── emptyMessageFor (web emptyMessage ternary) ────────────────────────────────────────────────

    @Test
    fun emptyMessageIsLoadingWhileLoading() {
        assertEquals("LOADING", emptyMessageFor(loading = true, labels = labels))
    }

    @Test
    fun emptyMessageIsEmptyWhenNotLoading() {
        assertEquals("EMPTY", emptyMessageFor(loading = false, labels = labels))
    }

    // ── Diagnostics (P1/S11 view.opened) ──────────────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsSurfaceSlug() {
        val logger = RecordingLogger()
        recordFlagsTableOpened(logger)
        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "FlagsTable"), opened.single().second)
    }
}
