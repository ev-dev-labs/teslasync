package io.teslasync.shared.core.presentation.telemetry

import io.teslasync.shared.core.data.repo.SignalObservationsParams
import io.teslasync.shared.core.data.repo.telemetryDiffServerQuery
import io.teslasync.shared.core.data.repo.telemetryErrorsKey
import io.teslasync.shared.core.data.repo.telemetryErrorsQuery
import io.teslasync.shared.core.data.repo.telemetryObservationsQuery
import io.teslasync.shared.core.data.repo.telemetrySignalDiffQuery
import io.teslasync.shared.core.data.repo.telemetrySignalHistoryQuery
import io.teslasync.shared.core.data.repo.telemetrySignalLogQuery
import io.teslasync.shared.core.data.repo.telemetrySignalObservationsKey
import io.teslasync.shared.core.data.repo.telemetrySignalsKey
import io.teslasync.shared.core.data.repo.telemetrySnapshotQuery
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Golden vectors locking the non-trivial client-side derivations + query/key builders ported from the
 * web `useTelemetry` domain (web/src/api/hooks/useTelemetry.ts). Inputs are raw JSON (exactly what the
 * cache stores) and outputs are fixed expectations, so the Windows C# port and the KMP core load the
 * identical set and cannot drift (ADR-004):
 *
 *  1. [TelemetryDerivations.signalNames]      — `useSignals` `queryFn` + `select: safeArray`.
 *  2. [TelemetryDerivations.signalGaps]       — `useSignalGaps` `res.signals ?? {}`.
 *  3. [TelemetryDerivations.adaptObservations]— `adaptObservations` value-kind steering.
 *  4. [TelemetryDerivations.normalizeMqttStatus] — `useMQTTStatus` record→array + field coalescing.
 *  5. the query builders (snapshot/diff-server/observations/history/log/diff/errors) and cache keys.
 */
class TelemetryGoldenTest {
    private val json = Json { ignoreUnknownKeys = true }

    private fun el(raw: String): JsonElement = json.parseToJsonElement(raw)

    // ---- signalNames --------------------------------------------------------------

    @Test
    fun signalNamesNormalizesEveryShape() {
        // bare string array
        assertEquals(listOf("A", "B"), TelemetryDerivations.signalNames(el("""["A","B"]""")))
        // { signals: [ "A", { name: "B" }, 3, { name: "" }, { nope: 1 } ] } — drops non-strings/empties
        assertEquals(
            listOf("A", "B"),
            TelemetryDerivations.signalNames(el("""{"signals":["A",{"name":"B"},3,{"name":""},{"nope":1}]}""")),
        )
        // rich catalog shape
        assertEquals(
            listOf("VehicleSpeed", "Soc"),
            TelemetryDerivations.signalNames(
                el("""{"signals":[{"name":"VehicleSpeed","category":"drive"},{"name":"Soc","category":"charge"}]}"""),
            ),
        )
        // null / non-array → empty
        assertEquals(emptyList(), TelemetryDerivations.signalNames(el("""{"signals":null}""")))
        assertEquals(emptyList(), TelemetryDerivations.signalNames(el("""42""")))
    }

    // ---- signalGaps ---------------------------------------------------------------

    @Test
    fun signalGapsExtractsSignalsMapOrEmpty() {
        val gaps =
            TelemetryDerivations.signalGaps(
                el("""{"signals":{"VehicleSpeed":{"value":12,"timestamp":"t"},"Soc":{"value":80,"timestamp":"t2"}}}"""),
            )
        assertEquals(setOf("VehicleSpeed", "Soc"), gaps.keys)
        assertEquals(emptyMap(), TelemetryDerivations.signalGaps(el("""{}""")))
        assertEquals(emptyMap(), TelemetryDerivations.signalGaps(el("""{"signals":null}""")))
    }

    // ---- adaptObservations --------------------------------------------------------

    @Test
    fun adaptObservationsSteersValueByKind() {
        val raw =
            el(
                """
                {"count":6,"total":6,"observations":[
                  {"vehicle_id":7,"ts":"t1","field":"VehicleSpeed","value_kind":"ValueKindFloat","value":12.5},
                  {"vehicle_id":7,"ts":"t2","field":"Odometer","value_kind":"ValueKindInt64","value":1000},
                  {"vehicle_id":7,"ts":"t3","field":"ShiftState","value_kind":"ValueKindEnum","value":"ShiftStateD"},
                  {"vehicle_id":7,"ts":"t4","field":"Charging","value_kind":"ValueKindBool","value":true},
                  {"vehicle_id":7,"ts":"t5","field":"Empty","value_kind":"ValueKindFloat","value":null},
                  {"vehicleId":9,"ts":"t6","field":"Loc","value_kind":"CompoundLocation","value":{"lat":1}}
                ]}
                """.trimIndent(),
            )
        val rows = TelemetryDerivations.adaptObservations(raw)
        assertEquals(6, rows.size)

        assertEquals(12.5, rows[0].valueNumeric)
        assertNull(rows[0].valueText)
        assertEquals("fleet_telemetry", rows[0].source)

        assertEquals(1000.0, rows[1].valueNumeric)

        assertEquals("ShiftStateD", rows[2].valueText)
        assertNull(rows[2].valueNumeric)

        assertEquals(true, rows[3].valueBool)

        // numeric kind but null value → null (never coerced to 0)
        assertNull(rows[4].valueNumeric)

        // camelCase vehicleId honoured; compound kind falls through to all-null
        assertEquals(9L, rows[5].vehicleId)
        assertNull(rows[5].valueNumeric)
        assertNull(rows[5].valueText)
        assertNull(rows[5].valueBool)
    }

    @Test
    fun adaptObservationsEmptyEnvelopeIsEmptyList() {
        assertEquals(emptyList(), TelemetryDerivations.adaptObservations(el("""{"count":0}""")))
        assertEquals(emptyList(), TelemetryDerivations.adaptObservations(el("""null""")))
    }

    // ---- normalizeMqttStatus ------------------------------------------------------

    @Test
    fun normalizeMqttStatusFlattensRecordWithSnakeCaseFallbacks() {
        val raw =
            el(
                """
                {"connected":true,"broker":"tcp://m","uptime_seconds":3600,"topics":["t/+/v/+"],
                 "vehicles":{
                   "5YJ3":{"vehicle_id":7,"state":"online","signal_count":42,"batch_count":3,
                           "signals_per_second":1.5,"last_received":"ts","is_streaming":true,
                           "data_source":"fleet_telemetry","latency_ms":12}
                 }}
                """.trimIndent(),
            )
        val status = TelemetryDerivations.normalizeMqttStatus(raw)
        assertTrue(status.connected)
        assertEquals("tcp://m", status.broker)
        assertEquals(3600.0, status.uptimeSeconds)
        assertEquals(listOf("t/+/v/+"), status.topics)

        val v = status.vehicles.single()
        assertEquals("5YJ3", v.vin) // injected from the record key
        assertEquals(7L, v.vehicleId)
        assertEquals("online", v.state)
        assertEquals(42L, v.signalCount)
        assertEquals(3L, v.batchCount)
        assertEquals(1.5, v.signalsPerSecond)
        assertEquals("ts", v.lastReceived)
        assertEquals(true, v.isStreaming)
        assertEquals("fleet_telemetry", v.dataSource)
        assertEquals(12.0, v.latencyMs)
    }

    @Test
    fun normalizeMqttStatusHandlesArrayAndStreamingVehiclesAndMissingCounts() {
        // array form + streaming_vehicles fallback is NOT used because `vehicles` present as array
        val arr =
            el("""{"vehicles":[{"vin":"V1","signal_count":5},{"vin":"V2"}]}""")
        val s1 = TelemetryDerivations.normalizeMqttStatus(arr)
        assertEquals(listOf("V1", "V2"), s1.vehicles.map { it.vin })
        assertEquals(5L, s1.vehicles[0].signalCount)
        assertEquals(0L, s1.vehicles[1].signalCount) // missing count defaults to 0
        assertEquals(false, s1.connected) // missing connected defaults to false

        // streaming_vehicles used when `vehicles` absent
        val streaming = el("""{"streaming_vehicles":{"VX":{"signal_count":1}}}""")
        val s2 = TelemetryDerivations.normalizeMqttStatus(streaming)
        assertEquals(listOf("VX"), s2.vehicles.map { it.vin })

        // uptimeSeconds camelCase variant wins when present
        val camel = el("""{"uptimeSeconds":99}""")
        assertEquals(99.0, TelemetryDerivations.normalizeMqttStatus(camel).uptimeSeconds)
    }

    // ---- query builders -----------------------------------------------------------

    @Test
    fun snapshotQueryOmitsEmpty() {
        assertEquals(emptyMap(), telemetrySnapshotQuery("", ""))
        assertEquals(mapOf("at" to "T"), telemetrySnapshotQuery("T", ""))
        assertEquals(mapOf("at" to "T", "signals" to "a,b"), telemetrySnapshotQuery("T", "a,b"))
        assertEquals(mapOf("signals" to "a,b"), telemetrySnapshotQuery("", "a,b"))
    }

    @Test
    fun diffServerQueryOmitsEmpty() {
        assertEquals(mapOf("at_a" to "A", "at_b" to "B"), telemetryDiffServerQuery("A", "B", ""))
        assertEquals(mapOf("at_a" to "A", "at_b" to "B", "signals" to "x"), telemetryDiffServerQuery("A", "B", "x"))
    }

    @Test
    fun observationsQueryTranslatesSignalNameToFieldAndGuardsLimit() {
        assertEquals(mapOf("vehicle_id" to "7"), telemetryObservationsQuery(SignalObservationsParams(vehicleId = 7)))
        assertEquals(
            mapOf("vehicle_id" to "7", "field" to "VehicleSpeed", "since" to "s", "until" to "u", "limit" to "10"),
            telemetryObservationsQuery(
                SignalObservationsParams(vehicleId = 7, signalName = "VehicleSpeed", since = "s", until = "u", limit = 10),
            ),
        )
        // empty signal_name dropped; limit <= 0 dropped
        assertEquals(
            mapOf("vehicle_id" to "7"),
            telemetryObservationsQuery(SignalObservationsParams(vehicleId = 7, signalName = "", limit = 0)),
        )
    }

    @Test
    fun historyLogDiffAndErrorsQueries() {
        assertEquals(mapOf("hours" to "24"), telemetrySignalHistoryQuery(24))
        assertEquals(mapOf("hours" to "24", "page" to "2", "page_size" to "50"), telemetrySignalLogQuery(24, 2, 50))
        assertEquals(mapOf("from" to "F", "to" to "T"), telemetrySignalDiffQuery("F", "T"))
        assertEquals(emptyMap(), telemetryErrorsQuery(null))
        assertEquals(emptyMap(), telemetryErrorsQuery(""))
        assertEquals(mapOf("vin" to "5YJ3"), telemetryErrorsQuery("5YJ3"))
    }

    // ---- cache keys ---------------------------------------------------------------

    @Test
    fun cacheKeysMirrorWebTuples() {
        assertEquals("signals|7", telemetrySignalsKey(7))
        assertEquals(
            "signal-observations|7|VehicleSpeed||u|10",
            telemetrySignalObservationsKey(
                SignalObservationsParams(vehicleId = 7, signalName = "VehicleSpeed", until = "u", limit = 10),
            ),
        )
        // errors family: null vin collapses to the family head, a present vin appends
        assertEquals("fleet-telemetry-errors", telemetryErrorsKey(null))
        assertEquals("fleet-telemetry-errors|5YJ3", telemetryErrorsKey("5YJ3"))
    }
}
