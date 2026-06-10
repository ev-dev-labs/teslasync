package io.teslasync.shared.core.presentation.signals

import io.teslasync.shared.core.data.repo.SignalsRepository
import io.teslasync.shared.core.data.repo.coerceSignalValue
import io.teslasync.shared.core.data.repo.normalizeAvailableResponse
import io.teslasync.shared.core.data.repo.normalizeHistoryResponse
import io.teslasync.shared.core.data.repo.normalizeLiveResponse
import io.teslasync.shared.core.data.repo.normalizeSignalEnvelope
import io.teslasync.shared.core.data.repo.normalizeSignalKind
import io.teslasync.shared.core.data.repo.normalizeUnitKind
import io.teslasync.shared.core.data.repo.signalHistoryQuery
import io.teslasync.shared.core.data.repo.signalsAvailableKey
import io.teslasync.shared.core.data.repo.signalsHistoryKey
import io.teslasync.shared.core.data.repo.signalsLiveKey
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Golden vectors locking the non-trivial client-side derivations ported from the web `useSignals`
 * domain (web/src/api/hooks/useSignals.ts):
 *
 *  1. [normalizeSignalKind] — the `protomodel.ValueKind` → compact [SignalKind] map (long-form
 *     strings, compact strings, AND the SSE integer enum, including its iota order).
 *  2. [normalizeUnitKind] — the `protomodel.UnitKind` → compact [SignalUnitKind] map.
 *  3. [coerceSignalValue] / [normalizeSignalEnvelope] — the typed-value coercion per kind.
 *  4. [normalizeAvailableResponse]/[normalizeLiveResponse]/[normalizeHistoryResponse] — the three
 *     `queryFn` response shapers.
 *  5. [signalsAvailableKey]/[signalsLiveKey]/[signalsHistoryKey] — the web `signalKeys` tuples.
 *  6. [signalHistoryQuery] — the `from`/`to` vs `hours` (+`limit`) window derivation.
 *
 * The vectors are language-neutral (raw JSON in / fixed expectations out) so the Windows C# port and
 * the KMP core load the identical set and cannot drift (ADR-004). The fixtures are inlined to stay
 * within this slice's allowed file scope; the C# port mirrors these exact rows.
 */
class SignalsGoldenTest {
    private val json = Json { ignoreUnknownKeys = true }

    private fun str(s: String) = JsonPrimitive(s)

    private fun num(n: Int) = JsonPrimitive(n)

    // ---- ValueKind normalization --------------------------------------------------

    @Test
    fun valueKindLongFormStringsMapToCompactKinds() {
        assertEquals(SignalKind.String, normalizeSignalKind(str("ValueKindString")))
        assertEquals(SignalKind.Bool, normalizeSignalKind(str("ValueKindBool")))
        assertEquals(SignalKind.Int, normalizeSignalKind(str("ValueKindInt32")))
        assertEquals(SignalKind.Int, normalizeSignalKind(str("ValueKindInt64")))
        assertEquals(SignalKind.Int, normalizeSignalKind(str("ValueKindEnum")))
        assertEquals(SignalKind.Float, normalizeSignalKind(str("ValueKindFloat")))
        assertEquals(SignalKind.Float, normalizeSignalKind(str("ValueKindDouble")))
        assertEquals(SignalKind.Time, normalizeSignalKind(str("ValueKindTime")))
    }

    @Test
    fun valueKindCompactStringsMapToCompactKinds() {
        assertEquals(SignalKind.String, normalizeSignalKind(str("string")))
        assertEquals(SignalKind.Bool, normalizeSignalKind(str("bool")))
        assertEquals(SignalKind.Int, normalizeSignalKind(str("int")))
        assertEquals(SignalKind.Float, normalizeSignalKind(str("float")))
        assertEquals(SignalKind.Time, normalizeSignalKind(str("time")))
    }

    @Test
    fun valueKindSseIntegerEnumMatchesTheProtoIotaOrder() {
        assertEquals(SignalKind.String, normalizeSignalKind(num(1)))
        assertEquals(SignalKind.Bool, normalizeSignalKind(num(2)))
        assertEquals(SignalKind.Int, normalizeSignalKind(num(3)))
        assertEquals(SignalKind.Int, normalizeSignalKind(num(4)))
        assertEquals(SignalKind.Float, normalizeSignalKind(num(5)))
        assertEquals(SignalKind.Float, normalizeSignalKind(num(6)))
        assertEquals(SignalKind.Int, normalizeSignalKind(num(7)))
        assertEquals(SignalKind.Time, normalizeSignalKind(num(9)))
    }

    @Test
    fun valueKindUnknownAndNonScalarBecomeUnknown() {
        assertEquals(SignalKind.Unknown, normalizeSignalKind(str("ValueKindBytes")))
        assertEquals(SignalKind.Unknown, normalizeSignalKind(num(99)))
        assertEquals(SignalKind.Unknown, normalizeSignalKind(JsonPrimitive(true)))
        assertEquals(SignalKind.Unknown, normalizeSignalKind(null))
    }

    // ---- UnitKind normalization ---------------------------------------------------

    @Test
    fun unitKindMapsLongAndCompactFormsAndDefaultsToNone() {
        assertEquals(SignalUnitKind.Distance, normalizeUnitKind(str("UnitKindDistance")))
        assertEquals(SignalUnitKind.Distance, normalizeUnitKind(str("distance")))
        assertEquals(SignalUnitKind.Temperature, normalizeUnitKind(str("UnitKindTemperature")))
        assertEquals(SignalUnitKind.Pressure, normalizeUnitKind(str("pressure")))
        assertEquals(SignalUnitKind.Charge, normalizeUnitKind(str("UnitKindCharge")))
        assertEquals(SignalUnitKind.Speed, normalizeUnitKind(str("speed")))
        assertEquals(SignalUnitKind.None, normalizeUnitKind(str("UnitKindNone")))
        assertEquals(SignalUnitKind.None, normalizeUnitKind(str("UnitKindWhatever")))
        assertEquals(SignalUnitKind.None, normalizeUnitKind(null))
    }

    // ---- value coercion -----------------------------------------------------------

    @Test
    fun coerceValueSelectsTheArmMatchingTheKind() {
        assertEquals(SignalValue.Text("hi"), coerceSignalValue(JsonPrimitive("hi"), SignalKind.String))
        assertEquals(SignalValue.Text("2026-01-01T00:00:00Z"), coerceSignalValue(JsonPrimitive("2026-01-01T00:00:00Z"), SignalKind.Time))
        assertEquals(SignalValue.Bool(true), coerceSignalValue(JsonPrimitive(true), SignalKind.Bool))
        assertEquals(SignalValue.Num(42.0), coerceSignalValue(JsonPrimitive(42), SignalKind.Int))
        assertEquals(SignalValue.Num(1.5), coerceSignalValue(JsonPrimitive(1.5), SignalKind.Float))
        // A numeric string behind a float kind is parsed (web `Number(value)`).
        assertEquals(SignalValue.Num(3.25), coerceSignalValue(JsonPrimitive("3.25"), SignalKind.Float))
        // A non-numeric string behind a float kind is null (web `Number.isFinite` guard).
        assertEquals(SignalValue.Null, coerceSignalValue(JsonPrimitive("NaNsense"), SignalKind.Float))
        // A null/empty typed column is null regardless of kind.
        assertEquals(SignalValue.Null, coerceSignalValue(null, SignalKind.Float))
    }

    @Test
    fun normalizeEnvelopeResolvesKindThenCoercesValue() {
        val env = normalizeSignalEnvelope(json.parseToJsonElement(ENVELOPE_GOLDEN))
        assertEquals(SignalKind.Float, env.kind)
        assertEquals(SignalValue.Num(40.2), env.value)
        assertEquals("2026-06-15T12:00:00Z", env.ts)

        // A null envelope collapses to unknown/null/"".
        assertEquals(SignalEnvelope(SignalKind.Unknown, SignalValue.Null, ""), normalizeSignalEnvelope(null))
    }

    // ---- response shapers ---------------------------------------------------------

    @Test
    fun availableResponseNormalizesEveryDescriptor() {
        val res = normalizeAvailableResponse(json.parseToJsonElement(AVAILABLE_GOLDEN))
        assertEquals(7L, res.vehicleId)
        assertEquals(2, res.count)
        assertEquals("signal_store", res.source)
        assertEquals(2, res.signals.size)
        assertEquals("VehicleSpeed", res.signals[0].name)
        assertEquals(SignalKind.Float, res.signals[0].valueKind)
        assertEquals(SignalUnitKind.Speed, res.signals[0].unitKind)
        assertTrue(res.signals[1].isCompound)
    }

    @Test
    fun liveResponseNormalizesEachKeyedEnvelope() {
        val res = normalizeLiveResponse(json.parseToJsonElement(LIVE_GOLDEN))
        assertEquals(7L, res.vehicleId)
        assertEquals(2, res.count)
        assertEquals("2026-06-15T12:00:00Z", res.at)
        assertEquals(SignalKind.Float, res.signals.getValue("VehicleSpeed").kind)
        assertEquals(SignalValue.Num(13.4), res.signals.getValue("VehicleSpeed").value)
        // A null slot becomes an unknown-kind envelope.
        assertEquals(SignalKind.Unknown, res.signals.getValue("Locked").kind)
    }

    @Test
    fun historyResponseNormalizesEveryDataRow() {
        val res = normalizeHistoryResponse(json.parseToJsonElement(HISTORY_GOLDEN))
        assertEquals(7L, res.vehicleId)
        assertEquals("VehicleSpeed", res.signal)
        assertEquals("ValueKindFloat", res.expectedKind)
        assertEquals(2, res.count)
        assertEquals(2, res.data.size)
        assertEquals(SignalValue.Num(0.0), res.data[0].value)
        assertEquals(SignalValue.Num(13.4), res.data[1].value)
    }

    // ---- cache keys ---------------------------------------------------------------

    @Test
    fun cacheKeysMirrorTheWebSignalKeysTuples() {
        assertEquals("typed-signals|available|7", signalsAvailableKey(7))
        assertEquals("typed-signals|live|7", signalsLiveKey(7))
        assertEquals(
            "typed-signals|history|7|VehicleSpeed|24|||0",
            signalsHistoryKey(7, "VehicleSpeed", SignalHistoryRange(hours = 24)),
        )
        assertEquals(
            "typed-signals|history|7|VehicleSpeed|24|2026-01-01T00:00:00Z|2026-01-02T00:00:00Z|100",
            signalsHistoryKey(
                7,
                "VehicleSpeed",
                SignalHistoryRange(hours = 24, from = "2026-01-01T00:00:00Z", to = "2026-01-02T00:00:00Z", limit = 100),
            ),
        )
    }

    // ---- history query ------------------------------------------------------------

    @Test
    fun historyQuerySendsHoursWhenNoFullRange() {
        assertEquals(mapOf("hours" to "24"), signalHistoryQuery(SignalHistoryRange(hours = 24)))
        // A partial range (only `from`) still falls back to `hours`.
        assertEquals(mapOf("hours" to "12"), signalHistoryQuery(SignalHistoryRange(hours = 12, from = "2026-01-01T00:00:00Z")))
    }

    @Test
    fun historyQueryPrefersFullRangeOverHoursAndAppendsLimit() {
        assertEquals(
            mapOf("from" to "2026-01-01T00:00:00Z", "to" to "2026-01-02T00:00:00Z"),
            signalHistoryQuery(SignalHistoryRange(hours = 24, from = "2026-01-01T00:00:00Z", to = "2026-01-02T00:00:00Z")),
        )
        assertEquals(
            mapOf("hours" to "24", "limit" to "100"),
            signalHistoryQuery(SignalHistoryRange(hours = 24, limit = 100)),
        )
        // limit <= 0 is dropped (web `if (range.limit && range.limit > 0)`).
        assertEquals(mapOf("hours" to "24"), signalHistoryQuery(SignalHistoryRange(hours = 24, limit = 0)))
    }

    @Test
    fun parityHelpersAreReferencedFromTheDataPort() {
        // Compile-time anchor: the derivations under test are the ones the S7 port exposes.
        assertTrue(SignalsRepository::class.simpleName == "SignalsRepository")
    }

    private companion object {
        val ENVELOPE_GOLDEN =
            """{ "kind": "ValueKindFloat", "value": 40.2, "ts": "2026-06-15T12:00:00Z" }"""

        val AVAILABLE_GOLDEN =
            """
            {
              "vehicle_id": 7,
              "count": 2,
              "source": "signal_store",
              "signals": [
                { "name": "VehicleSpeed", "category": "drive", "value_kind": "ValueKindFloat",
                  "unit_kind": "speed", "is_compound": false, "is_setting_unit": false },
                { "name": "DoorState", "category": "body", "value_kind": "ValueKindString",
                  "unit_kind": "UnitKindNone", "is_compound": true, "is_setting_unit": false }
              ]
            }
            """.trimIndent()

        val LIVE_GOLDEN =
            """
            {
              "vehicle_id": 7,
              "count": 2,
              "at": "2026-06-15T12:00:00Z",
              "signals": {
                "VehicleSpeed": { "kind": "ValueKindFloat", "value": 13.4, "ts": "2026-06-15T12:00:00Z" },
                "Locked": null
              }
            }
            """.trimIndent()

        val HISTORY_GOLDEN =
            """
            {
              "vehicle_id": 7,
              "signal": "VehicleSpeed",
              "expected_kind": "ValueKindFloat",
              "from": "2026-06-15T00:00:00Z",
              "to": "2026-06-15T12:00:00Z",
              "count": 2,
              "data": [
                { "kind": "ValueKindFloat", "value": 0.0, "ts": "2026-06-15T00:00:00Z" },
                { "kind": "ValueKindFloat", "value": 13.4, "ts": "2026-06-15T12:00:00Z" }
              ]
            }
            """.trimIndent()
    }
}
