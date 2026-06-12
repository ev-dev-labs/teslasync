package io.teslasync.android.featureviews.featuretoggles

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.user.TeslaConfigEnvelope
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.util.Locale

/**
 * Off-device verification of the FeatureToggles' pure logic — the native analogue of the web component's
 * `useMemo` flattening (web/src/features/settings/components/FeatureToggles.tsx): the object-vs-primitive
 * enabled coercion (web `Boolean(enabled)` / `Boolean(value)`), the joined `k: JSON.stringify(v)` details
 * string, the non-object guard, insertion order, the localized "Synced" stamp, the empty / fetched guards,
 * and the PII-safe `view.opened` diagnostic. Runs in the :android:testReleaseUnitTest gate.
 */
class FeatureTogglesProjectionTest {
    private val zoneUtc: ZoneId = ZoneId.of("UTC")

    private fun envelope(
        data: JsonElement,
        fetchedAt: String? = "2026-06-12T14:30:00Z",
    ): TeslaConfigEnvelope<JsonElement> = TeslaConfigEnvelope(data = data, fetchedAt = fetchedAt)

    // ── Non-object data → no rows (web `!data || typeof data !== 'object'`) ──────────

    @Test
    fun entriesIsEmptyForNonObjectData() {
        assertTrue(FeatureTogglesProjection.entries(null).isEmpty())
        assertTrue(FeatureTogglesProjection.entries(JsonNull).isEmpty())
        assertTrue(FeatureTogglesProjection.entries(JsonPrimitive(true)).isEmpty())
        assertTrue(FeatureTogglesProjection.entries(JsonPrimitive("x")).isEmpty())
        assertTrue(FeatureTogglesProjection.entries(JsonArray(listOf(JsonPrimitive(1)))).isEmpty())
    }

    // ── Primitive values → enabled = JS truthiness, details = null ──────────────────

    @Test
    fun primitiveBooleanValuesUseTheirOwnTruthiness() {
        val rows =
            FeatureTogglesProjection.entries(
                buildJsonObject {
                    put("on", true)
                    put("off", false)
                },
            )
        assertEquals(2, rows.size)
        assertTrue(rows[0].enabled)
        assertNull(rows[0].details)
        assertFalse(rows[1].enabled)
        assertNull(rows[1].details)
    }

    @Test
    fun primitiveNumberValuesAreTruthyWhenNonZero() {
        val rows =
            FeatureTogglesProjection.entries(
                buildJsonObject {
                    put("zero", 0)
                    put("five", 5)
                },
            )
        assertFalse(rows.single { it.key == "zero" }.enabled)
        assertTrue(rows.single { it.key == "five" }.enabled)
    }

    @Test
    fun primitiveStringValuesAreTruthyWhenNonEmpty() {
        val rows =
            FeatureTogglesProjection.entries(
                buildJsonObject {
                    put("blank", "")
                    put("set", "dark")
                    // JS `Boolean("false")` is true — a non-empty string, not the boolean false.
                    put("stringFalse", "false")
                },
            )
        assertFalse(rows.single { it.key == "blank" }.enabled)
        assertTrue(rows.single { it.key == "set" }.enabled)
        assertTrue(rows.single { it.key == "stringFalse" }.enabled)
    }

    @Test
    fun jsonNullValueIsDisabledWithNoDetails() {
        val rows = FeatureTogglesProjection.entries(buildJsonObject { put("missing", JsonNull) })
        assertFalse(rows.single().enabled)
        assertNull(rows.single().details)
    }

    // ── Object values → enabled from `enabled` member, details from the rest ─────────

    @Test
    fun objectValueTakesEnabledFromMemberAndJoinsTheRestAsDetails() {
        val rows =
            FeatureTogglesProjection.entries(
                buildJsonObject {
                    putJsonObject("ludicrous") {
                        put("enabled", true)
                        put("tier", "performance")
                        put("limit", 5)
                    }
                },
            )
        val row = rows.single()
        assertTrue(row.enabled)
        // Compact JSON.stringify: a string stays quoted, a number bare; insertion order preserved.
        assertEquals("tier: \"performance\", limit: 5", row.details)
    }

    @Test
    fun objectValueWithOnlyEnabledYieldsEmptyDetailsNotNull() {
        val rows = FeatureTogglesProjection.entries(buildJsonObject { putJsonObject("flag") { put("enabled", true) } })
        // Web `[].join(', ')` is the empty string — distinct from a primitive's null (em-dash) at render time.
        assertEquals("", rows.single().details)
        assertTrue(rows.single().enabled)
    }

    @Test
    fun objectValueMissingEnabledIsDisabled() {
        val rows = FeatureTogglesProjection.entries(buildJsonObject { putJsonObject("flag") { put("tier", "x") } })
        assertFalse(rows.single().enabled)
        assertEquals("tier: \"x\"", rows.single().details)
    }

    @Test
    fun objectEnabledMemberFollowsJsTruthiness() {
        val rows =
            FeatureTogglesProjection.entries(
                buildJsonObject {
                    putJsonObject("numTrue") { put("enabled", 1) }
                    putJsonObject("numFalse") { put("enabled", 0) }
                    putJsonObject("strFalse") { put("enabled", "false") }
                    putJsonObject("nullEnabled") { put("enabled", JsonNull) }
                },
            )
        assertTrue(rows.single { it.key == "numTrue" }.enabled)
        assertFalse(rows.single { it.key == "numFalse" }.enabled)
        assertTrue(rows.single { it.key == "strFalse" }.enabled)
        assertFalse(rows.single { it.key == "nullEnabled" }.enabled)
    }

    @Test
    fun nestedObjectMemberIsCompactStringified() {
        val rows =
            FeatureTogglesProjection.entries(
                buildJsonObject {
                    putJsonObject("flag") {
                        put("enabled", false)
                        putJsonObject("config") { put("a", 1) }
                    }
                },
            )
        assertEquals("config: {\"a\":1}", rows.single().details)
    }

    @Test
    fun entriesPreserveInsertionOrder() {
        val rows =
            FeatureTogglesProjection.entries(
                buildJsonObject {
                    put("charlie", true)
                    put("alpha", false)
                    put("bravo", true)
                },
            )
        assertEquals(listOf("charlie", "alpha", "bravo"), rows.map { it.key })
    }

    // ── Empty / fetched guards ──────────────────────────────────────────────────────

    @Test
    fun isEmptyReflectsTheProjectedRows() {
        assertTrue(FeatureTogglesProjection.isEmpty(null))
        assertTrue(FeatureTogglesProjection.isEmpty(envelope(buildJsonObject {})))
        assertFalse(FeatureTogglesProjection.isEmpty(envelope(buildJsonObject { put("flag", true) })))
    }

    @Test
    fun hasFetchedReflectsTheEnvelope() {
        assertFalse(FeatureTogglesProjection.hasFetched(null))
        assertFalse(FeatureTogglesProjection.hasFetched(envelope(buildJsonObject {}, fetchedAt = null)))
        assertTrue(FeatureTogglesProjection.hasFetched(envelope(buildJsonObject {}, fetchedAt = "2026-06-12T14:30:00Z")))
    }

    // ── Synced stamp (web formatDateTime) ───────────────────────────────────────────

    @Test
    fun formatSyncedRendersLocalizedDateTimeForValidIso() {
        val formatted = FeatureTogglesProjection.formatSynced("2026-06-12T14:30:00Z", zoneUtc, Locale.US)
        assertTrue("expected a real date, got '$formatted'", formatted != EM_DASH)
        assertTrue("expected the year, got '$formatted'", formatted.contains("2026"))
        assertTrue("expected the short month, got '$formatted'", formatted.contains("Jun"))
    }

    @Test
    fun formatSyncedReturnsEmDashForNullBlankOrUnparseable() {
        assertEquals(EM_DASH, FeatureTogglesProjection.formatSynced(null, zoneUtc, Locale.US))
        assertEquals(EM_DASH, FeatureTogglesProjection.formatSynced("", zoneUtc, Locale.US))
        assertEquals(EM_DASH, FeatureTogglesProjection.formatSynced("nonsense", zoneUtc, Locale.US))
    }

    // ── Diagnostics (P1/S11 view.opened contract) ──────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordFeatureTogglesOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "FeatureToggles"), fields)
    }

    @Test
    fun registrationExposesStableIdAndSlug() {
        assertEquals("feature-toggles", FeatureTogglesRegistration.ID)
        assertEquals("FeatureToggles", FeatureTogglesRegistration.SLUG)
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
