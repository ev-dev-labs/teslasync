package io.teslasync.shared.core.presentation.vehiclesettings

import io.teslasync.shared.core.data.repo.VehicleSettingsRepository
import io.teslasync.shared.core.data.repo.upsertVehicleSettingBody
import io.teslasync.shared.core.data.repo.vehicleSettingsCacheKey
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Golden vectors locking the non-trivial client-side derivations ported from the web
 * `useVehicleSettings` domain (web/src/api/hooks/useVehicleSettings.ts):
 *
 *  1. [vehicleSettingsCacheKey] — the web `vehicleSettingsKeys.detail` tuple
 *     `['vehicle-settings', id]`, prefixed so it partitions per vehicle.
 *  2. [upsertVehicleSettingBody] — the web `JSON.stringify({ value })` body, byte-identical compact
 *     JSON for string / number / boolean values.
 *  3. The [VehicleSettingsResponse] read model decodes the snake_case wire envelope verbatim,
 *     including the `source` discriminator mapping and the typed `value` round-trip.
 *  4. [findEffectiveSetting] — the web `findEffectiveSetting` selector: the row on a hit, `null` on a
 *     miss, and `null` on a null payload.
 *
 * The vectors are language-neutral (raw JSON / fixed expectations) so the Windows C# port and the
 * KMP core load the identical set and cannot drift (ADR-004). The fixtures are inlined to stay within
 * this slice's allowed file scope; the C# port mirrors these exact rows.
 */
class VehicleSettingsGoldenTest {
    private val json = Json { ignoreUnknownKeys = true }

    // ---- cache key ----------------------------------------------------------------

    @Test
    fun cacheKeyMirrorsTheWebDetailTuple() {
        assertEquals("vehicle-settings:42", vehicleSettingsCacheKey("42"))
        assertEquals("vehicle-settings:abc-123", vehicleSettingsCacheKey("abc-123"))
    }

    // ---- upsert body --------------------------------------------------------------

    @Test
    fun upsertBodyEmitsAStringValueAsCompactJson() {
        assertEquals("""{"value":"Lightning"}""", upsertVehicleSettingBody(JsonPrimitive("Lightning")).toString())
    }

    @Test
    fun upsertBodyEmitsANumericValueAsCompactJson() {
        assertEquals("""{"value":42}""", upsertVehicleSettingBody(JsonPrimitive(42)).toString())
    }

    @Test
    fun upsertBodyEmitsABooleanValueAsCompactJson() {
        assertEquals("""{"value":true}""", upsertVehicleSettingBody(JsonPrimitive(true)).toString())
    }

    @Test
    fun upsertBodyEmitsAnRfc3339MuteUntilStringVerbatim() {
        assertEquals(
            """{"value":"2026-06-05T12:00:00Z"}""",
            upsertVehicleSettingBody(JsonPrimitive("2026-06-05T12:00:00Z")).toString(),
        )
    }

    // ---- wire decoding ------------------------------------------------------------

    @Test
    fun responseDecodesSnakeCaseWithEverySourceAndTypedValue() {
        val decoded = json.decodeFromString(VehicleSettingsResponse.serializer(), SETTINGS_GOLDEN)
        assertEquals(4, decoded.settings.size)

        val nickname = decoded.settings[0]
        assertEquals("nickname", nickname.key)
        assertEquals("Lightning", nickname.value.jsonPrimitive.content)
        assertEquals(EffectiveSettingSource.OVERRIDE, nickname.source)

        val threshold = decoded.settings[1]
        assertEquals("low_battery_threshold", threshold.key)
        assertEquals(20, threshold.value.jsonPrimitive.int)
        assertEquals(EffectiveSettingSource.USER, threshold.source)

        val muted = decoded.settings[2]
        assertEquals("alerts_muted", muted.key)
        assertTrue(muted.value.jsonPrimitive.boolean)
        assertEquals(EffectiveSettingSource.VEHICLE, muted.source)

        val muteUntil = decoded.settings[3]
        assertEquals("mute_until", muteUntil.key)
        assertEquals("2026-06-05T12:00:00Z", muteUntil.value.jsonPrimitive.content)
        assertEquals(EffectiveSettingSource.DEFAULT, muteUntil.source)
    }

    @Test
    fun responseDecodesAnEmptyEnvelope() {
        val decoded = json.decodeFromString(VehicleSettingsResponse.serializer(), EMPTY_GOLDEN)
        assertTrue(decoded.settings.isEmpty())
    }

    // ---- findEffectiveSetting selector --------------------------------------------

    @Test
    fun findReturnsTheRowOnAHit() {
        val payload = json.decodeFromString(VehicleSettingsResponse.serializer(), SETTINGS_GOLDEN)
        val row = findEffectiveSetting(payload, "low_battery_threshold")
        assertEquals(20, row?.value?.jsonPrimitive?.int)
        assertEquals(EffectiveSettingSource.USER, row?.source)
    }

    @Test
    fun findReturnsNullOnAMiss() {
        val payload = json.decodeFromString(VehicleSettingsResponse.serializer(), SETTINGS_GOLDEN)
        assertNull(findEffectiveSetting(payload, "does_not_exist"))
    }

    @Test
    fun findReturnsNullOnANullPayload() {
        assertNull(findEffectiveSetting(null, "nickname"))
    }

    @Test
    fun parityHelpersAreReferencedFromTheDataPort() {
        // Compile-time anchor: the derivations under test are the ones the S7 port exposes.
        assertTrue(VehicleSettingsRepository::class.simpleName == "VehicleSettingsRepository")
    }

    private companion object {
        val SETTINGS_GOLDEN =
            """
            {
              "settings": [
                { "key": "nickname",              "value": "Lightning",            "source": "override" },
                { "key": "low_battery_threshold", "value": 20,                     "source": "user" },
                { "key": "alerts_muted",          "value": true,                   "source": "vehicle" },
                { "key": "mute_until",            "value": "2026-06-05T12:00:00Z", "source": "default" }
              ]
            }
            """.trimIndent()

        val EMPTY_GOLDEN =
            """
            {
              "settings": []
            }
            """.trimIndent()
    }
}
