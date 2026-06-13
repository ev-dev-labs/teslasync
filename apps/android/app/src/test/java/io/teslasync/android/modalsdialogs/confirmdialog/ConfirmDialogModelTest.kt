// Off-device unit coverage for the ConfirmDialog modal/dialog's pure model (P3 acceptance: adapter +
// per-branch + diagnostics tests). Exercises the projection's tool-name passthrough, the
// `tool.description &&` truthiness guard (blank/absent -> null), the `JSON.stringify(args ?? {}, null, 2)`
// argument formatting (two-space indent, key order preserved, empty/absent -> `{}`, nested objects), the
// registry identifiers, and the PII-safe `view.opened` diagnostic. No Compose / Android / HTTP — runs in
// :android:testReleaseUnitTest.
package io.teslasync.android.modalsdialogs.confirmdialog

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
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

    // ---- Projection: tool fields + description truthiness (web `tool.description &&`) ----------

    @Test
    fun project_passesToolNameAndMutatesThrough() {
        val mutating = ConfirmDialogProjection.project(AiToolPreview("set_alert_threshold", mutates = true), null)
        assertEquals("set_alert_threshold", mutating.toolName)
        assertTrue(mutating.mutates)

        val reading = ConfirmDialogProjection.project(AiToolPreview("query_vehicle_count", mutates = false), null)
        assertFalse(reading.mutates)
    }

    @Test
    fun project_keepsNonBlankDescriptionAndDropsBlankOrAbsent() {
        val withDesc =
            ConfirmDialogProjection.project(
                AiToolPreview("set_alert_threshold", mutates = true, description = "Update an alert rule threshold."),
                null,
            )
        assertEquals("Update an alert rule threshold.", withDesc.toolDescription)

        val blankDesc =
            ConfirmDialogProjection.project(AiToolPreview("t", mutates = false, description = "   "), null)
        assertNull(blankDesc.toolDescription)

        val absentDesc = ConfirmDialogProjection.project(AiToolPreview("t", mutates = false), null)
        assertNull(absentDesc.toolDescription)
    }

    // ---- formatArgs: web `JSON.stringify(args ?? {}, null, 2)` -----------------------------------

    @Test
    fun formatArgs_nullAndEmptyRenderEmptyBraces() {
        assertEquals("{}", ConfirmDialogProjection.formatArgs(null))
        assertEquals("{}", ConfirmDialogProjection.formatArgs(JsonObject(emptyMap())))
    }

    @Test
    fun formatArgs_prettyPrintsWithTwoSpaceIndentAndPreservesOrder() {
        val args =
            buildJsonObject {
                put("rule_id", 42)
                put("threshold", 80)
            }
        // Web `JSON.stringify(args, null, 2)`: two-space indent, `": "` separators, one entry per line.
        val expected = "{\n  \"rule_id\": 42,\n  \"threshold\": 80\n}"
        assertEquals(expected, ConfirmDialogProjection.formatArgs(args))
    }

    @Test
    fun formatArgs_usesTwoSpacesNotFour() {
        val args = buildJsonObject { put("rule_id", 42) }
        val json = ConfirmDialogProjection.formatArgs(args)
        assertTrue("expected a two-space-indented first key", json.contains("\n  \"rule_id\""))
        assertFalse("must not use a four-space indent", json.contains("\n    \"rule_id\""))
    }

    @Test
    fun formatArgs_preservesInsertionOrderNotAlphabetical() {
        val args =
            buildJsonObject {
                put("zebra", 1)
                put("alpha", 2)
            }
        val json = ConfirmDialogProjection.formatArgs(args)
        assertTrue("zebra must precede alpha (insertion order)", json.indexOf("zebra") < json.indexOf("alpha"))
    }

    @Test
    fun formatArgs_indentsNestedObjects() {
        val args =
            buildJsonObject {
                putJsonObject("vehicle") {
                    put("id", 7)
                }
            }
        val expected = "{\n  \"vehicle\": {\n    \"id\": 7\n  }\n}"
        assertEquals(expected, ConfirmDialogProjection.formatArgs(args))
    }

    @Test
    fun project_argsJsonMatchesFormatArgs() {
        val args = buildJsonObject { put("threshold", 80) }
        val display = ConfirmDialogProjection.project(AiToolPreview("t", mutates = true), args)
        assertEquals(ConfirmDialogProjection.formatArgs(args), display.argsJson)
    }

    // ---- Registry + diagnostics -----------------------------------------------------------------

    @Test
    fun registrationIdentifiersAreStable() {
        assertEquals("confirm-dialog", ConfirmDialogRegistration.ID)
        assertEquals("ConfirmDialog", ConfirmDialogRegistration.SLUG)
    }

    @Test
    fun recordConfirmDialogOpened_emitsPiiSafeViewOpened() {
        val logger = RecordingLogger()
        recordConfirmDialogOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "ConfirmDialog"), fields)
        // The diagnostic must carry no tool name or argument payload — only the surface slug, no digits.
        assertTrue(fields.values.none { value -> value.any(Char::isDigit) })
    }
}
