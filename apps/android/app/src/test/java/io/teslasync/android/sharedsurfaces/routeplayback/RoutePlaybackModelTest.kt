package io.teslasync.android.sharedsurfaces.routeplayback

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.maps.GeoPoint
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device coverage for the pure [RoutePlaybackTrack]/[RoutePlaybackState]/[RoutePlaybackProjection]/
 * [RoutePlaybackDiagnostics] declarations — the adapter (raw `/drives/{id}/positions` JSON → sorted,
 * valid-coordinate [RouteSample] projection), the folded-state derived flags, the QueryError classification,
 * and the PII-safe `view.opened` slug. Runs in the `:android:testReleaseUnitTest` gate with no Android,
 * Compose, coroutines, or network.
 */
class RoutePlaybackModelTest {
    // ── Adapter: positions JSON → track projection ───────────────────────────────

    @Test
    fun nullJsonYieldsEmptyTrack() {
        assertTrue(RoutePlaybackTrack.fromPositions(null).isEmpty)
    }

    @Test
    fun nonArrayJsonYieldsEmptyTrack() {
        // A JSON object without a `positions` array is not a positions payload (web `safeArray` → []).
        val track = RoutePlaybackTrack.fromPositions(buildJsonObject { put("error", "nope") })
        assertTrue(track.isEmpty)
        assertEquals(0, track.validSampleCount)
    }

    @Test
    fun bareArrayBuildsSortedValidSamples() {
        // Supplied out of order (t2, t0, t1) — the projection sorts ascending by time so playback runs forward.
        val json =
            buildJsonArray {
                add(position(lat = 37.7768, lng = -122.4154, ts = T2))
                add(
                    buildJsonObject {
                        put("latitude", 37.7749)
                        put("longitude", -122.4194)
                        put("timestamp", T0)
                        put("speed", 0.0)
                        put("battery_level", 0.80)
                        put("power", -2.0)
                    },
                )
                add(position(lat = 37.7758, lng = -122.4174, ts = T1))
            }

        val samples = RoutePlaybackTrack.fromPositions(json).samples

        assertEquals(3, samples.size)
        assertEquals(listOf(EPOCH_T0, EPOCH_T1, EPOCH_T2), samples.map { it.timestampMs })
        assertEquals(GeoPoint(37.7749, -122.4194), samples.first().point)
        assertEquals(0.0, samples.first().speed!!, EPSILON)
        assertEquals(0.80, samples.first().soc!!, EPSILON)
        assertEquals(-2.0, samples.first().power!!, EPSILON)
    }

    @Test
    fun positionsEnvelopeIsAccepted() {
        val json =
            buildJsonObject {
                put(
                    "positions",
                    buildJsonArray {
                        add(position(lat = 37.7749, lng = -122.4194, ts = T0))
                        add(position(lat = 37.7758, lng = -122.4174, ts = T1))
                    },
                )
            }

        assertEquals(2, RoutePlaybackTrack.fromPositions(json).validSampleCount)
    }

    @Test
    fun invalidCoordinatesZeroIslandAndBadTimestampsAreDropped() {
        val json =
            buildJsonArray {
                add(position(lat = 37.7749, lng = -122.4194, ts = T0)) // keep
                add(position(lat = 0.0, lng = 0.0, ts = T1)) // Null Island — dropped
                add(position(lat = 999.0, lng = -122.0, ts = T2)) // out-of-range latitude — dropped
                add(position(lat = 37.7758, lng = -122.4174, ts = "not-a-timestamp")) // unparseable — dropped
            }

        val samples = RoutePlaybackTrack.fromPositions(json).samples
        assertEquals(1, samples.size)
        assertEquals(EPOCH_T0, samples.single().timestampMs)
    }

    @Test
    fun snakeAndCamelCaseKeysBothResolve() {
        val snake =
            buildJsonObject {
                put("latitude", 37.7749)
                put("longitude", -122.4194)
                put("created_at", T0)
                put("battery_level", 0.81)
            }
        val camel =
            buildJsonObject {
                put("latitude", 37.7758)
                put("longitude", -122.4174)
                put("createdAt", T1)
                put("batteryLevel", 0.79)
            }
        val json =
            buildJsonArray {
                add(snake)
                add(camel)
            }

        val samples = RoutePlaybackTrack.fromPositions(json).samples

        assertEquals(2, samples.size)
        assertEquals(EPOCH_T0, samples[0].timestampMs)
        assertEquals(0.81, samples[0].soc!!, EPSILON)
        assertEquals(EPOCH_T1, samples[1].timestampMs)
        assertEquals(0.79, samples[1].soc!!, EPSILON)
    }

    @Test
    fun nullMetricsBecomeNull() {
        val json =
            buildJsonArray {
                add(
                    buildJsonObject {
                        put("latitude", 37.7749)
                        put("longitude", -122.4194)
                        put("timestamp", T0)
                        put("speed", JsonNull)
                        put("power", JsonNull)
                    },
                )
            }

        val sample = RoutePlaybackTrack.fromPositions(json).samples.single()
        assertNull(sample.speed)
        assertNull(sample.power)
        assertNull(sample.soc)
    }

    // ── Folded state derived flags ───────────────────────────────────────────────

    @Test
    fun stateDerivedFlagsMatchPhase() {
        assertTrue(RoutePlaybackState.loading().isLoading)
        assertTrue(RoutePlaybackState(phase = UiPhase.Content).isContent)
        assertTrue(RoutePlaybackState(phase = UiPhase.Empty).isEmpty)

        val error = RoutePlaybackState(phase = UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = 500)
        assertTrue(error.isError)
        assertTrue(error.canRetry)
        assertFalse(error.isOffline)

        val offline =
            RoutePlaybackState(phase = UiPhase.Content, stale = true, errorKind = ErrorKind.Network)
        assertTrue(offline.isOffline)
        assertTrue(offline.canRetry)
        assertFalse(offline.isError)
    }

    // ── QueryError classification ────────────────────────────────────────────────

    @Test
    fun queryErrorKindForFoldsTheTaxonomy() {
        assertEquals(QueryErrorKind.Offline, RoutePlaybackProjection.queryErrorKindFor(ErrorKind.Network, null))
        assertEquals(QueryErrorKind.Offline, RoutePlaybackProjection.queryErrorKindFor(ErrorKind.Timeout, null))
        assertEquals(QueryErrorKind.Waiting, RoutePlaybackProjection.queryErrorKindFor(ErrorKind.CircuitOpen, null))
        assertEquals(QueryErrorKind.NotFound, RoutePlaybackProjection.queryErrorKindFor(ErrorKind.Http, 404))
        assertEquals(QueryErrorKind.ServerError, RoutePlaybackProjection.queryErrorKindFor(ErrorKind.Http, 500))
        assertEquals(QueryErrorKind.Network, RoutePlaybackProjection.queryErrorKindFor(ErrorKind.Unknown, null))
    }

    // ── Diagnostics ──────────────────────────────────────────────────────────────

    @Test
    fun diagnosticsEmitsPiiSafeViewOpenedSlug() {
        val logger = RecordingLogger()

        RoutePlaybackDiagnostics.recordViewOpened(logger)

        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "RoutePlayback"), fields)
    }

    // ── Fixtures ─────────────────────────────────────────────────────────────────

    private fun position(
        lat: Double,
        lng: Double,
        ts: String,
    ) = buildJsonObject {
        put("latitude", lat)
        put("longitude", lng)
        put("timestamp", ts)
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

    private companion object {
        const val T0 = "2024-01-01T00:00:00Z"
        const val T1 = "2024-01-01T00:00:10Z"
        const val T2 = "2024-01-01T00:00:20Z"
        const val EPOCH_T0 = 1_704_067_200_000L
        const val EPOCH_T1 = 1_704_067_210_000L
        const val EPOCH_T2 = 1_704_067_220_000L
        const val EPSILON = 1e-9
    }
}
