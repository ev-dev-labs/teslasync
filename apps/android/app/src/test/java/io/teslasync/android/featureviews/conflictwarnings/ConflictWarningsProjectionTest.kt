package io.teslasync.android.featureviews.conflictwarnings

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the ConflictWarnings data adapter + pure logic — the native mirror of every
 * derivation the web component performs (web/src/features/automations/pages/ConflictWarnings.tsx): the empty
 * guard (`conflicts.length === 0` -> render nothing), the per-row stable key (`${automation_id}-${i}`), the
 * `"${automation_name}": ${reason}` body, and the `severity === 'warning' ? 'warning' : 'info'` variant
 * branch. Also exercises decoding straight off the cached API JSON (snake_case wire names, unknown columns
 * ignored). Because the surface is purely presentational each [ConflictWarningsDisplay] is exactly what the
 * thin composable renders, so these assertions double as the per-state "snapshot". Runs in the
 * :android:testReleaseUnitTest gate.
 */
class ConflictWarningsProjectionTest {
    private val lenientJson = Json { ignoreUnknownKeys = true }

    private fun conflict(
        id: Long,
        name: String,
        reason: String,
        severity: String,
    ) = AutomationConflict(
        automationId = id,
        automationName = name,
        reason = reason,
        severity = severity,
    )

    // ── Severity classification (web `c.severity === 'warning' ? 'warning' : 'info'`) ──────────────

    @Test
    fun fromClassifiesTheExactWarningKeyAsWarning() {
        assertEquals(ConflictSeverity.Warning, ConflictSeverity.from("warning"))
    }

    @Test
    fun fromFoldsInfoAndEveryOtherValueToInfo() {
        // Web strict equality: only the exact lowercase "warning" is a warning; everything else is info.
        assertEquals(ConflictSeverity.Info, ConflictSeverity.from("info"))
        assertEquals(ConflictSeverity.Info, ConflictSeverity.from(""))
        assertEquals(ConflictSeverity.Info, ConflictSeverity.from("critical"))
    }

    @Test
    fun fromIsCaseSensitiveLikeTheWebStrictEquality() {
        // `=== 'warning'` is case-sensitive, so a differently-cased value misses and folds to info.
        assertEquals(ConflictSeverity.Info, ConflictSeverity.from("Warning"))
        assertEquals(ConflictSeverity.Info, ConflictSeverity.from("WARNING"))
    }

    // ── Banner body (web `"${automation_name}": ${reason}`) ────────────────────────────────────────

    @Test
    fun formatMessageWrapsTheNameInQuotesThenAppendsTheReason() {
        assertEquals(
            "\"Morning precondition\": Overlaps with the evening charge window.",
            ConflictWarningsProjection.formatMessage("Morning precondition", "Overlaps with the evening charge window."),
        )
    }

    @Test
    fun formatMessageKeepsEmptyValuesInTheFixedPunctuationFrame() {
        // The frame is punctuation only — even empty data keeps the quotes, colon, and space.
        assertEquals("\"\": ", ConflictWarningsProjection.formatMessage("", ""))
    }

    // ── Projection: empty guard, order preservation, keys ──────────────────────────────────────────

    @Test
    fun projectMarksAnEmptyListHiddenWithNoRows() {
        val display = ConflictWarningsProjection.project(emptyList())

        assertTrue(display.isHidden)
        assertTrue(display.rows.isEmpty())
    }

    @Test
    fun projectIsVisibleAndPreservesOrderForANonEmptyList() {
        val display =
            ConflictWarningsProjection.project(
                listOf(
                    conflict(1, "First", "Reason one.", "warning"),
                    conflict(2, "Second", "Reason two.", "info"),
                ),
            )

        assertFalse(display.isHidden)
        assertEquals(2, display.rows.size)
        assertEquals("\"First\": Reason one.", display.rows[0].message)
        assertEquals("\"Second\": Reason two.", display.rows[1].message)
        assertEquals(ConflictSeverity.Warning, display.rows[0].severity)
        assertEquals(ConflictSeverity.Info, display.rows[1].severity)
    }

    @Test
    fun projectBuildsTheStablePerRowKeyFromIdAndIndex() {
        // Web `key={`${c.automation_id}-${i}`}` — the index disambiguates duplicate ids.
        val display =
            ConflictWarningsProjection.project(
                listOf(
                    conflict(7, "A", "ra", "warning"),
                    conflict(7, "B", "rb", "info"),
                ),
            )

        assertEquals("7-0", display.rows[0].key)
        assertEquals("7-1", display.rows[1].key)
    }

    @Test
    fun projectBuildsEachRowBodyLikeTheWebTemplateLiteral() {
        val display =
            ConflictWarningsProjection.project(
                listOf(conflict(3, "Garage lights", "Shares a geofence trigger.", "info")),
            )

        assertEquals("\"Garage lights\": Shares a geofence trigger.", display.rows.single().message)
    }

    // ── Data adapter: decode the cached API JSON, then project ─────────────────────────────────────

    @Test
    fun projectsStraightOffTheCachedApiJsonIgnoringUnknownColumns() {
        // The owning builder caches the raw API response, whose conflict rows carry snake_case keys and may
        // include columns this surface never reads. Decoding + projecting must yield the rendered rows.
        val json =
            """
            [
              {
                "automation_id": 42,
                "automation_name": "Precondition at 7am",
                "reason": "Overlaps with another schedule.",
                "severity": "warning",
                "rule_id": "abc-123",
                "created_at": "2026-01-01T00:00:00Z"
              },
              {
                "automation_id": 43,
                "automation_name": "Arrive-home lights",
                "reason": "Shares a geofence trigger.",
                "severity": "info"
              }
            ]
            """.trimIndent()
        val decoded = lenientJson.decodeFromString<List<AutomationConflict>>(json)

        assertEquals(42L, decoded[0].automationId)
        assertEquals("Precondition at 7am", decoded[0].automationName)

        val display = ConflictWarningsProjection.project(decoded)
        assertFalse(display.isHidden)
        assertEquals("42-0", display.rows[0].key)
        assertEquals(ConflictSeverity.Warning, display.rows[0].severity)
        assertEquals("\"Precondition at 7am\": Overlaps with another schedule.", display.rows[0].message)
        assertEquals(ConflictSeverity.Info, display.rows[1].severity)
    }

    @Test
    fun decodesDefaultsForAPartialConflictRow() {
        // A still-loading / partial row must decode without error and fold to a visible info banner.
        val decoded = lenientJson.decodeFromString<AutomationConflict>("""{ "automation_name": "X" }""")

        assertEquals(0L, decoded.automationId)
        assertEquals("X", decoded.automationName)
        assertEquals("", decoded.reason)
        assertEquals(ConflictSeverity.Info, ConflictSeverity.from(decoded.severity))
    }
}
