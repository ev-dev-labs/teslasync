// Off-device unit coverage for the TOUSettingsModal surface's pure model (P3 acceptance: adapter + per-branch +
// diagnostics tests). Exercises the per-tab payload assembly + validation (web `getPayload`: the no-preset guard, the
// empty / invalid / not-an-object custom-JSON guards, and the "full envelope vs. wrap the inner object" branch), the
// three preset tariff envelopes (shape + the verbatim `tou_settings` body), the Select option labels (web
// `${name} — ${utility}`), the pretty-printed preview round-trip (web `JSON.stringify(_, null, 2)`), the tab wire
// vocabulary + reverse lookup, the registry identifiers, and the PII-safe `view.opened` diagnostic. No Compose /
// Android / HTTP — runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.tousettingsmodal

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TOUSettingsModalModelTest {
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

    private val parser = Json

    // ---- Preset payload (web `getPayload` preset branch) -------------------------

    @Test
    fun buildPayload_presetTab_returnsTheChosenPlanEnvelopeVerbatim() {
        TOUSettingsModalProjection.presets.forEach { preset ->
            val result = TOUSettingsModalProjection.buildPayload(TOUTab.Preset, preset.id, "")
            assertTrue(result is TOUPayloadResult.Valid)
            assertEquals(preset.settings, (result as TOUPayloadResult.Valid).payload)
        }
    }

    @Test
    fun buildPayload_presetTab_noSelectionIsNoPresetError() {
        val result = TOUSettingsModalProjection.buildPayload(TOUTab.Preset, "", "")
        assertEquals(TOUPayloadResult.Invalid(TOUValidationError.NoPreset), result)
    }

    @Test
    fun buildPayload_presetTab_unknownIdIsNoPresetError() {
        val result = TOUSettingsModalProjection.buildPayload(TOUTab.Preset, "does-not-exist", "")
        assertEquals(TOUPayloadResult.Invalid(TOUValidationError.NoPreset), result)
    }

    // ---- Custom payload (web `getPayload` custom branch) -------------------------

    @Test
    fun buildPayload_customTab_blankIsEmptyJsonError() {
        assertEquals(
            TOUPayloadResult.Invalid(TOUValidationError.EmptyJson),
            TOUSettingsModalProjection.buildPayload(TOUTab.Custom, "", ""),
        )
        assertEquals(
            TOUPayloadResult.Invalid(TOUValidationError.EmptyJson),
            TOUSettingsModalProjection.buildPayload(TOUTab.Custom, "", "   \n\t "),
        )
    }

    @Test
    fun buildPayload_customTab_unparseableIsInvalidJsonError() {
        assertEquals(
            TOUPayloadResult.Invalid(TOUValidationError.InvalidJson),
            TOUSettingsModalProjection.buildPayload(TOUTab.Custom, "", "{ not valid"),
        )
        // A bare unquoted token is not valid JSON (web `JSON.parse` throws).
        assertEquals(
            TOUPayloadResult.Invalid(TOUValidationError.InvalidJson),
            TOUSettingsModalProjection.buildPayload(TOUTab.Custom, "", "economics"),
        )
    }

    @Test
    fun buildPayload_customTab_nonObjectIsNotObjectError() {
        // web `typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)`
        listOf("[1, 2, 3]", "42", "\"a string\"", "true", "null").forEach { raw ->
            assertEquals(
                "raw=$raw",
                TOUPayloadResult.Invalid(TOUValidationError.NotObject),
                TOUSettingsModalProjection.buildPayload(TOUTab.Custom, "", raw),
            )
        }
    }

    @Test
    fun buildPayload_customTab_objectWithEnvelopeIsSubmittedVerbatim() {
        val raw = """{ "tou_settings": { "optimization_strategy": "economics" } }"""
        val result = TOUSettingsModalProjection.buildPayload(TOUTab.Custom, "", raw)
        assertTrue(result is TOUPayloadResult.Valid)
        val payload = (result as TOUPayloadResult.Valid).payload
        assertEquals(parser.parseToJsonElement(raw).jsonObject, payload)
        // Already an envelope → not double-wrapped.
        assertNotNull(payload[TOUSettingsModalProjection.KEY_TOU_SETTINGS])
        assertNull(payload[TOUSettingsModalProjection.KEY_TOU_SETTINGS]?.jsonObject?.get(TOUSettingsModalProjection.KEY_TOU_SETTINGS))
    }

    @Test
    fun buildPayload_customTab_bareObjectIsWrappedInTouSettings() {
        val raw = """{ "optimization_strategy": "economics", "tariff_content_v2": { "name": "Custom" } }"""
        val result = TOUSettingsModalProjection.buildPayload(TOUTab.Custom, "", raw)
        assertTrue(result is TOUPayloadResult.Valid)
        val payload = (result as TOUPayloadResult.Valid).payload
        val inner = payload[TOUSettingsModalProjection.KEY_TOU_SETTINGS]?.jsonObject
        assertNotNull(inner)
        assertEquals(parser.parseToJsonElement(raw).jsonObject, inner)
    }

    // ---- Preset data integrity ---------------------------------------------------

    @Test
    fun presets_areTheThreeWebPlansInOrder() {
        assertEquals(listOf("pge-ev2a", "sce-tou-d", "sdge-tou-dr1"), TOUSettingsModalProjection.presets.map { it.id })
        assertEquals(
            listOf("PG&E EV2-A", "SCE TOU-D", "SDG&E TOU-DR1"),
            TOUSettingsModalProjection.presets.map { it.name },
        )
    }

    @Test
    fun presets_eachCarriesAValidTouSettingsEnvelope() {
        TOUSettingsModalProjection.presets.forEach { preset ->
            val touSettings = preset.settings[TOUSettingsModalProjection.KEY_TOU_SETTINGS]?.jsonObject
            assertNotNull("preset=${preset.id}", touSettings)
            assertEquals("economics", touSettings!!["optimization_strategy"]?.jsonPrimitive?.content)
            val tariff = touSettings["tariff_content_v2"]?.jsonObject
            assertNotNull("preset=${preset.id} tariff", tariff)
            assertEquals(preset.name, tariff!!["name"]?.jsonPrimitive?.content)
            assertEquals(preset.utility, tariff["utility"]?.jsonPrimitive?.content)
            assertNotNull("preset=${preset.id} energy_charges", tariff["energy_charges"])
            assertNotNull("preset=${preset.id} seasons", tariff["seasons"])
        }
    }

    @Test
    fun pgeEv2a_carriesTheExpectedHeadlinePeakRate() {
        val pge = TOUSettingsModalProjection.findPreset("pge-ev2a")
        assertNotNull(pge)
        val onPeak =
            pge!!
                .settings[TOUSettingsModalProjection.KEY_TOU_SETTINGS]!!
                .jsonObject["tariff_content_v2"]!!
                .jsonObject["energy_charges"]!!
                .jsonObject["Summer"]!!
                .jsonObject["ON_PEAK"]!!
        val firstWindow = (onPeak as JsonArray)[0].jsonObject
        assertEquals("0.49", firstWindow["rate"]?.jsonPrimitive?.content)
        assertEquals("16", firstWindow["start"]?.jsonPrimitive?.content)
        assertEquals("21", firstWindow["end"]?.jsonPrimitive?.content)
    }

    // ---- Select options + preview ------------------------------------------------

    @Test
    fun presetOptions_composeTheNameAndUtilityLabel() {
        val options = TOUSettingsModalProjection.presetOptions()
        assertEquals(
            listOf("pge-ev2a", "sce-tou-d", "sdge-tou-dr1"),
            options.map { it.value },
        )
        assertEquals("PG&E EV2-A — Pacific Gas & Electric", options.first().label)
    }

    @Test
    fun previewFor_prettyPrintsTheChosenPlanAndRoundTrips() {
        val preview = TOUSettingsModalProjection.previewFor("sce-tou-d")
        assertNotNull(preview)
        // Two-space indented + parses back to the exact preset envelope.
        assertTrue(preview!!.contains("\n  "))
        val reparsed = parser.parseToJsonElement(preview).jsonObject
        assertEquals(TOUSettingsModalProjection.findPreset("sce-tou-d")!!.settings, reparsed)
    }

    @Test
    fun previewFor_unknownPresetIsNull() {
        assertNull(TOUSettingsModalProjection.previewFor(""))
        assertNull(TOUSettingsModalProjection.previewFor("nope"))
    }

    @Test
    fun prettyPrint_isTwoSpaceIndentedJson() {
        val obj = parser.parseToJsonElement("""{"a":1,"b":{"c":2}}""").jsonObject
        val pretty = TOUSettingsModalProjection.prettyPrint(obj)
        assertTrue(pretty.contains("\n  \"a\""))
        assertEquals(obj, parser.parseToJsonElement(pretty).jsonObject)
    }

    // ---- Tab vocabulary ----------------------------------------------------------

    @Test
    fun tabWireTokensMatchTheWebUnion() {
        assertEquals("preset", TOUTab.Preset.wire)
        assertEquals("custom", TOUTab.Custom.wire)
    }

    @Test
    fun fromWire_resolvesKnownTokensAndFallsBackOnUnknown() {
        assertEquals(TOUTab.Custom, TOUTab.fromWire("custom"))
        assertEquals(TOUTab.Preset, TOUTab.fromWire("preset"))
        assertEquals(TOUTab.Preset, TOUTab.fromWire("nonsense"))
    }

    // ---- Registry + diagnostics --------------------------------------------------

    @Test
    fun registrationIdentifiersAreStable() {
        assertEquals("tou-settings-modal", TOUSettingsModalRegistration.ID)
        assertEquals("TOUSettingsModal", TOUSettingsModalRegistration.SLUG)
    }

    @Test
    fun recordTOUSettingsModalOpened_emitsPiiSafeViewOpened() {
        val logger = RecordingLogger()
        recordTOUSettingsModalOpened(logger)
        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "TOUSettingsModal"), fields)
    }
}
