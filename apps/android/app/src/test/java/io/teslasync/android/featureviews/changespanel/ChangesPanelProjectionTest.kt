package io.teslasync.android.featureviews.changespanel

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.featureflags.FeatureFlagChange
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneOffset
import java.util.Locale

/**
 * Off-device verification of the ChangesPanel's pure logic — the native analogue of the web component's
 * per-column renderers and `compact()` helper (web/src/features/admin/components/feature-flags/ChangesPanel.tsx):
 * the operation → tone classification (`OP_VARIANT[op] ?? 'neutral'`), the actor/reason "—" fallback
 * (`value || '—'`), the `compact()` JSON preview (stringify, 60-char cap, "…" suffix, null → "—"), the
 * rows → projection (order, injected time formatter), the tolerant `changed_at` formatting with its em-dash
 * guard, and the PII-safe `view.opened` diagnostic. Runs in the :android:testReleaseUnitTest gate.
 */
class ChangesPanelProjectionTest {
    @Suppress("LongParameterList") // Mirrors the shared wire row; defaults keep call sites terse.
    private fun change(
        id: Long = 1,
        changedAt: String = "2026-04-04T14:30:00Z",
        actor: String = "admin",
        flagKey: String = "alpha",
        operation: String = "set",
        oldValue: JsonElement = JsonNull,
        newValue: JsonElement = JsonNull,
        reason: String = "because",
    ): FeatureFlagChange =
        FeatureFlagChange(
            id = id,
            changedAt = changedAt,
            actor = actor,
            actorIp = "10.0.0.1",
            flagKey = flagKey,
            operation = operation,
            oldValue = oldValue,
            newValue = newValue,
            reason = reason,
            traceId = "trace",
        )

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

    // ── Operation tone (web OP_VARIANT[op] ?? 'neutral') ──────────────────────────────────────────────

    @Test
    fun toneForMapsSetAndDeleteAndFoldsUnknownToNeutral() {
        assertEquals(OperationTone.Positive, ChangesPanelProjection.toneFor("set"))
        assertEquals(OperationTone.Negative, ChangesPanelProjection.toneFor("delete"))
        assertEquals(OperationTone.Neutral, ChangesPanelProjection.toneFor("rename"))
        assertEquals(OperationTone.Neutral, ChangesPanelProjection.toneFor(""))
    }

    // ── Actor/reason fallback (web value || '—') ──────────────────────────────────────────────────────

    @Test
    fun orDashReturnsValueOrEmDashForEmptyOnly() {
        assertEquals("admin", ChangesPanelProjection.orDash("admin"))
        assertEquals(EM_DASH, ChangesPanelProjection.orDash(""))
        // The web `||` treats only the empty string as falsy; whitespace is truthy and passes through.
        assertEquals("   ", ChangesPanelProjection.orDash("   "))
    }

    // ── compact() value preview (web JSON.stringify + slice) ──────────────────────────────────────────

    @Test
    fun compactRendersEmDashForJsonNull() {
        assertEquals(EM_DASH, ChangesPanelProjection.compact(JsonNull))
    }

    @Test
    fun compactStringifiesPrimitivesLikeJsonStringify() {
        assertEquals("\"hello\"", ChangesPanelProjection.compact(JsonPrimitive("hello")))
        assertEquals("42", ChangesPanelProjection.compact(JsonPrimitive(42)))
        assertEquals("true", ChangesPanelProjection.compact(JsonPrimitive(true)))
    }

    @Test
    fun compactStringifiesObjectsCompactlyWithNoSpacing() {
        val obj = buildJsonObject { put("enabled", true) }
        assertEquals("{\"enabled\":true}", ChangesPanelProjection.compact(obj))
    }

    @Test
    fun compactReturnsShortValuesUntouchedAtTheBoundary() {
        // A 58-char string serializes to exactly 60 chars ("..." + two quotes) — not truncated (web `> 60`).
        val sixty = ChangesPanelProjection.compact(JsonPrimitive("b".repeat(58)))
        assertEquals(COMPACT_MAX_LENGTH, sixty.length)
        assertFalse(sixty.endsWith(ELLIPSIS))
    }

    @Test
    fun compactTruncatesLongValuesToKeepLengthPlusEllipsis() {
        // A 60-char string serializes to 62 chars (> 60) — clipped to 57 chars + the single-char ellipsis.
        val clipped = ChangesPanelProjection.compact(JsonPrimitive("a".repeat(60)))
        assertEquals(COMPACT_KEEP_LENGTH + 1, clipped.length)
        assertTrue(clipped.startsWith("\""))
        assertTrue(clipped.endsWith(ELLIPSIS))
    }

    // ── Projection (web column renderers, order, injected formatter) ──────────────────────────────────

    @Test
    fun projectReturnsNoRowsForEmptyInput() {
        assertTrue(ChangesPanelProjection.project(emptyList()) { it }.isEmpty())
    }

    @Test
    fun projectMapsEveryColumnPreservingOrderAndApplyingFallbacks() {
        val rows =
            listOf(
                change(
                    id = 7,
                    changedAt = "iso-set",
                    actor = "atul",
                    flagKey = "telemetry.fast_path",
                    operation = "set",
                    oldValue = JsonNull,
                    newValue = JsonPrimitive(true),
                    reason = "enable",
                ),
                change(
                    id = 8,
                    changedAt = "iso-del",
                    actor = "",
                    flagKey = "beta.new_ui",
                    operation = "delete",
                    oldValue = JsonPrimitive("v2"),
                    newValue = JsonNull,
                    reason = "",
                ),
            )

        val projected = ChangesPanelProjection.project(rows) { iso -> "T($iso)" }

        assertEquals(2, projected.size)

        val first = projected[0]
        assertEquals(7L, first.id)
        assertEquals("T(iso-set)", first.changedAt)
        assertEquals("atul", first.actor)
        assertEquals("telemetry.fast_path", first.flagKey)
        assertEquals("set", first.operation)
        assertEquals(OperationTone.Positive, first.tone)
        assertEquals(EM_DASH, first.oldValue)
        assertEquals("true", first.newValue)
        assertEquals("enable", first.reason)

        val second = projected[1]
        assertEquals("T(iso-del)", second.changedAt)
        assertEquals(EM_DASH, second.actor)
        assertEquals("delete", second.operation)
        assertEquals(OperationTone.Negative, second.tone)
        assertEquals("\"v2\"", second.oldValue)
        assertEquals(EM_DASH, second.newValue)
        assertEquals(EM_DASH, second.reason)
    }

    // ── Timestamp formatting (web <TimeStamp format="absolute" /> + invalid-date guard) ──────────────

    @Test
    fun formatRendersRfc3339InstantInGivenZoneAndLocale() {
        val text = ChangesPanelTimeFormatting.format("2026-04-04T14:30:00Z", ZoneOffset.UTC, Locale.US)
        assertTrue("expected medium date, was: $text", text.contains("Apr 4, 2026"))
        assertTrue("expected short time, was: $text", text.contains("2:30"))
    }

    @Test
    fun formatAcceptsOffsetAndZonelessLocalDateTime() {
        val expected = "Apr 4, 2026"
        assertTrue(ChangesPanelTimeFormatting.format("2026-04-04T14:30:00+00:00", ZoneOffset.UTC, Locale.US).contains(expected))
        assertTrue(ChangesPanelTimeFormatting.format("2026-04-04T14:30:00", ZoneOffset.UTC, Locale.US).contains(expected))
    }

    @Test
    fun formatReturnsEmDashForBlankOrUnparseableInput() {
        assertEquals(EM_DASH, ChangesPanelTimeFormatting.format("", ZoneOffset.UTC, Locale.US))
        assertEquals(EM_DASH, ChangesPanelTimeFormatting.format("   ", ZoneOffset.UTC, Locale.US))
        assertEquals(EM_DASH, ChangesPanelTimeFormatting.format("not-a-date", ZoneOffset.UTC, Locale.US))
    }

    // ── Diagnostics (P1/S11 view.opened) ──────────────────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsSurfaceSlug() {
        val logger = RecordingLogger()
        recordChangesPanelOpened(logger)
        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "ChangesPanel"), opened.single().second)
    }
}
