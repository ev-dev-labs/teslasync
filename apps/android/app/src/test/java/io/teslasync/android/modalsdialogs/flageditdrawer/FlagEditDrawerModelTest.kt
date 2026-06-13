// Off-device unit coverage for the FlagEditDrawer modal/dialog's pure model (P3 acceptance: adapter +
// per-branch + diagnostics tests). Exercises the create-vs-edit discriminator, the `defaultValueJson`
// seed (`JSON.stringify(value, null, 2)` — pretty two-space, scalar/object/null/absent), the `parseValue`
// memo (blank -> Empty, clean decode -> Valid, malformed -> Invalid with a non-blank parser message),
// the key/reason non-blank guards, the composite `canSubmit` rule (web `canSave`), the trimmed
// submission assembly (web `onSave({ key.trim(), value, reason.trim() })`), the registry identifiers,
// and the PII-safe `view.opened` diagnostic. No Compose / Android / HTTP — runs in
// :android:testReleaseUnitTest.
package io.teslasync.android.modalsdialogs.flageditdrawer

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FlagEditDrawerModelTest {
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

    // ---- isEditing: web `editing = initial !== null` -------------------------------------------

    @Test
    fun isEditing_trueOnlyForANonNullTarget() {
        assertFalse(FlagEditDrawerProjection.isEditing(null))
        assertTrue(FlagEditDrawerProjection.isEditing(FlagEditTarget("feature.x", JsonPrimitive(true))))
    }

    // ---- defaultValueJson: web `defaultValueJson(initial)` -------------------------------------

    @Test
    fun defaultValueJson_absentTargetOrAbsentValueSeedsEmpty() {
        assertEquals("", FlagEditDrawerProjection.defaultValueJson(null))
        assertEquals("", FlagEditDrawerProjection.defaultValueJson(FlagEditTarget("feature.x", null)))
    }

    @Test
    fun defaultValueJson_scalarsRenderBareOrQuotedLikeJsonStringify() {
        assertEquals("true", FlagEditDrawerProjection.defaultValueJson(FlagEditTarget("k", JsonPrimitive(true))))
        assertEquals("42", FlagEditDrawerProjection.defaultValueJson(FlagEditTarget("k", JsonPrimitive(42))))
        assertEquals("\"dark\"", FlagEditDrawerProjection.defaultValueJson(FlagEditTarget("k", JsonPrimitive("dark"))))
        assertEquals("null", FlagEditDrawerProjection.defaultValueJson(FlagEditTarget("k", JsonNull)))
    }

    @Test
    fun defaultValueJson_objectsArePrettyPrintedWithATwoSpaceIndent() {
        val target =
            FlagEditTarget(
                "feature.ratelimit.tiers",
                buildJsonObject {
                    put("free", 10)
                    put("pro", 100)
                },
            )
        // Web `JSON.stringify(value, null, 2)`: two-space indent, `": "` separators, one entry per line.
        val expected = "{\n  \"free\": 10,\n  \"pro\": 100\n}"
        assertEquals(expected, FlagEditDrawerProjection.defaultValueJson(target))
    }

    @Test
    fun defaultValueJson_roundTripsBackThroughParseValue() {
        val value =
            buildJsonObject {
                put("enabled", true)
                put("max", 5)
            }
        val seed = FlagEditDrawerProjection.defaultValueJson(FlagEditTarget("k", value))
        val parsed = FlagEditDrawerProjection.parseValue(seed)
        assertTrue(parsed is FlagValueParse.Valid)
        assertEquals(value, (parsed as FlagValueParse.Valid).value)
    }

    // ---- parseValue: web `parsed` memo ---------------------------------------------------------

    @Test
    fun parseValue_blankOrWhitespaceIsEmpty() {
        assertEquals(FlagValueParse.Empty, FlagEditDrawerProjection.parseValue(""))
        assertEquals(FlagValueParse.Empty, FlagEditDrawerProjection.parseValue("   \n\t "))
    }

    @Test
    fun parseValue_cleanDecodesAreValid() {
        assertTrue(FlagEditDrawerProjection.parseValue("true") is FlagValueParse.Valid)
        assertTrue(FlagEditDrawerProjection.parseValue("42") is FlagValueParse.Valid)
        assertTrue(FlagEditDrawerProjection.parseValue("\"text\"") is FlagValueParse.Valid)
        assertTrue(FlagEditDrawerProjection.parseValue("[1, 2, 3]") is FlagValueParse.Valid)
        assertTrue(FlagEditDrawerProjection.parseValue("{\"a\": 1}") is FlagValueParse.Valid)
    }

    @Test
    fun parseValue_objectDecodesToTheExpectedElement() {
        val parsed = FlagEditDrawerProjection.parseValue("{\"enabled\": true}")
        assertTrue(parsed is FlagValueParse.Valid)
        assertEquals(buildJsonObject { put("enabled", true) }, (parsed as FlagValueParse.Valid).value)
    }

    @Test
    fun parseValue_malformedIsInvalidWithANonBlankMessage() {
        val unquotedKey = FlagEditDrawerProjection.parseValue("{enabled: true}")
        assertTrue(unquotedKey is FlagValueParse.Invalid)
        assertTrue((unquotedKey as FlagValueParse.Invalid).message.isNotBlank())

        assertTrue(FlagEditDrawerProjection.parseValue("not-json") is FlagValueParse.Invalid)
        assertTrue(FlagEditDrawerProjection.parseValue("{\"a\": }") is FlagValueParse.Invalid)
    }

    // ---- key / reason guards: web `keyInput.trim().length > 0`, `reason.trim().length > 0` ------

    @Test
    fun isKeyValid_requiresANonBlankTrimmedKey() {
        assertFalse(FlagEditDrawerProjection.isKeyValid(""))
        assertFalse(FlagEditDrawerProjection.isKeyValid("   "))
        assertTrue(FlagEditDrawerProjection.isKeyValid("  feature.x  "))
    }

    @Test
    fun isReasonValid_requiresANonBlankTrimmedReason() {
        assertFalse(FlagEditDrawerProjection.isReasonValid(""))
        assertFalse(FlagEditDrawerProjection.isReasonValid("  \t "))
        assertTrue(FlagEditDrawerProjection.isReasonValid("  rollout  "))
    }

    // ---- canSubmit: web `canSave = parsed.ok && keyValid && reasonValid && !saving` ------------

    @Test
    fun canSubmit_trueOnlyWhenValueParsesKeyAndReasonAreSetAndNotSaving() {
        val valid = FlagValueParse.Valid(JsonPrimitive(true))
        assertTrue(FlagEditDrawerProjection.canSubmit(valid, "feature.x", "why", saving = false))
    }

    @Test
    fun canSubmit_falseWhenTheValueDoesNotParse() {
        assertFalse(FlagEditDrawerProjection.canSubmit(FlagValueParse.Empty, "feature.x", "why", saving = false))
        assertFalse(
            FlagEditDrawerProjection.canSubmit(FlagValueParse.Invalid("boom"), "feature.x", "why", saving = false),
        )
    }

    @Test
    fun canSubmit_falseWhenKeyOrReasonIsBlankOrASaveIsInFlight() {
        val valid = FlagValueParse.Valid(JsonPrimitive(true))
        assertFalse(FlagEditDrawerProjection.canSubmit(valid, "   ", "why", saving = false))
        assertFalse(FlagEditDrawerProjection.canSubmit(valid, "feature.x", "  ", saving = false))
        assertFalse(FlagEditDrawerProjection.canSubmit(valid, "feature.x", "why", saving = true))
    }

    // ---- buildSubmission: web `onSave({ key: keyInput.trim(), value, reason: reason.trim() })` --

    @Test
    fun buildSubmission_trimsTheKeyAndReasonAndCarriesTheValue() {
        val value = buildJsonObject { put("enabled", true) }
        val submission = FlagEditDrawerProjection.buildSubmission("  feature.x  ", value, "  rollout  ")
        assertEquals("feature.x", submission.key)
        assertEquals("rollout", submission.reason)
        assertEquals(value, submission.value)
    }

    // ---- Registry + diagnostics ----------------------------------------------------------------

    @Test
    fun registrationIdentifiersAreStable() {
        assertEquals("flag-edit-drawer", FlagEditDrawerRegistration.ID)
        assertEquals("FlagEditDrawer", FlagEditDrawerRegistration.SLUG)
    }

    @Test
    fun recordFlagEditDrawerOpened_emitsPiiSafeViewOpened() {
        val logger = RecordingLogger()
        recordFlagEditDrawerOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "FlagEditDrawer"), fields)
        // The diagnostic must carry no flag key, value, or reason — only the surface slug, no digits.
        assertTrue(fields.values.none { value -> value.any(Char::isDigit) })
    }
}
