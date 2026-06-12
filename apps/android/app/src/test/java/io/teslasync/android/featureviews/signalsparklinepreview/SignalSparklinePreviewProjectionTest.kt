package io.teslasync.android.featureviews.signalsparklinepreview

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.signals.SignalEnvelope
import io.teslasync.shared.core.presentation.signals.SignalHistoryResponse
import io.teslasync.shared.core.presentation.signals.SignalKind
import io.teslasync.shared.core.presentation.signals.SignalValue
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the SignalSparklinePreview pure projection — the native port of the web
 * component's `isNumeric` guard, `envelopesToNumbers` extraction, render-branch precedence, the P3 error /
 * stale / offline extension, the `QueryError` classification, and the PII-safe `view.opened` diagnostic.
 * Mirrors the web spec (web/src/features/telemetry/components/SignalSparklinePreview.tsx).
 */
class SignalSparklinePreviewProjectionTest {
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

    // ── isNumericKind (web !NON_NUMERIC.has(valueKind)) ───────────────────────────────────────────────────

    @Test
    fun numericKindsAreBoolIntFloat() {
        assertTrue(isNumericKind(SignalKind.Bool))
        assertTrue(isNumericKind(SignalKind.Int))
        assertTrue(isNumericKind(SignalKind.Float))
    }

    @Test
    fun nonNumericKindsAreStringTimeUnknown() {
        assertFalse(isNumericKind(SignalKind.String))
        assertFalse(isNumericKind(SignalKind.Time))
        assertFalse(isNumericKind(SignalKind.Unknown))
    }

    // ── envelopesToNumbers (web number→push, boolean→1/0, else skip) ───────────────────────────────────────

    @Test
    fun envelopesNumericValuesPassThrough() {
        val data = listOf(numEnvelope(1.0), numEnvelope(2.5), numEnvelope(-3.0))
        assertEquals(listOf(1.0, 2.5, -3.0), envelopesToNumbers(data))
    }

    @Test
    fun envelopesBooleanBecomesOneOrZero() {
        val data = listOf(boolEnvelope(true), boolEnvelope(false))
        assertEquals(listOf(1.0, 0.0), envelopesToNumbers(data))
    }

    @Test
    fun envelopesSkipNonFiniteAndNonNumeric() {
        val data =
            listOf(
                numEnvelope(5.0),
                numEnvelope(Double.NaN),
                numEnvelope(Double.POSITIVE_INFINITY),
                SignalEnvelope(SignalKind.String, SignalValue.Text("hi"), ""),
                SignalEnvelope(SignalKind.Unknown, SignalValue.Null, ""),
                numEnvelope(6.0),
            )
        assertEquals(listOf(5.0, 6.0), envelopesToNumbers(data))
    }

    // ── fromResource render-branch precedence ─────────────────────────────────────────────────────────────

    @Test
    fun disabledWinsOverEverything() {
        val state = SignalSparklineProjection.fromResource(enabled = false, SignalKind.Float, SIGNAL, success(historyResponse(5)))
        assertEquals(SignalSparklineMode.Disabled, state.mode)
        assertTrue(state.series.isEmpty())
    }

    @Test
    fun nonNumericWinsOverData() {
        val state = SignalSparklineProjection.fromResource(enabled = true, SignalKind.String, SIGNAL, success(historyResponse(5)))
        assertEquals(SignalSparklineMode.NonNumeric, state.mode)
        assertEquals(SignalKind.String, state.valueKind)
    }

    @Test
    fun nullResourceWhileEnabledAndNumericIsEmpty() {
        val state = SignalSparklineProjection.fromResource(enabled = true, SignalKind.Float, SIGNAL, resource = null)
        assertEquals(SignalSparklineMode.Empty, state.mode)
    }

    @Test
    fun loadingWithNoCacheIsLoading() {
        val state = SignalSparklineProjection.fromResource(enabled = true, SignalKind.Float, SIGNAL, loading())
        assertEquals(SignalSparklineMode.Loading, state.mode)
        assertTrue(state.isFetching)
    }

    @Test
    fun successWithEnoughPointsIsFreshContent() {
        val state = SignalSparklineProjection.fromResource(enabled = true, SignalKind.Float, SIGNAL, success(historyResponse(4), at = 99L))
        assertEquals(SignalSparklineMode.Content, state.mode)
        assertEquals(SparklineFreshness.Fresh, state.freshness)
        assertEquals(4, state.series.size)
        assertEquals(99L, state.updatedAtMillis)
        assertFalse(state.isFetching)
    }

    @Test
    fun successWithFewerThanTwoPointsIsEmpty() {
        val state = SignalSparklineProjection.fromResource(enabled = true, SignalKind.Float, SIGNAL, success(historyResponse(1)))
        assertEquals(SignalSparklineMode.Empty, state.mode)
    }

    @Test
    fun loadingWithCachedSeriesKeepsLastKnownLine() {
        val state = SignalSparklineProjection.fromResource(enabled = true, SignalKind.Float, SIGNAL, loading(historyResponse(3)))
        assertEquals(SignalSparklineMode.Content, state.mode)
        assertEquals(SparklineFreshness.Fresh, state.freshness)
        assertTrue(state.isFetching)
    }

    @Test
    fun errorWithNoCacheIsErrorWithClassifiedKind() {
        val state =
            SignalSparklineProjection.fromResource(
                enabled = true,
                SignalKind.Float,
                SIGNAL,
                Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network()),
            )
        assertEquals(SignalSparklineMode.Error, state.mode)
        assertEquals(QueryErrorKind.Network, state.errorKind)
        assertTrue(state.series.isEmpty())
    }

    @Test
    fun errorWithCachedSeriesIsOfflineContent() {
        val state =
            SignalSparklineProjection.fromResource(
                enabled = true,
                SignalKind.Float,
                SIGNAL,
                Resource.Error(cached = historyResponse(3), fetchedAt = 12L, stale = true, error = ApiError.Timeout()),
            )
        assertEquals(SignalSparklineMode.Content, state.mode)
        assertEquals(SparklineFreshness.Offline, state.freshness)
        assertEquals(3, state.series.size)
    }

    @Test
    fun staleCachedSeriesIsStaleContent() {
        val state =
            SignalSparklineProjection.fromResource(
                enabled = true,
                SignalKind.Float,
                SIGNAL,
                Resource.Success(data = historyResponse(3), fetchedAt = 12L, stale = true),
            )
        assertEquals(SignalSparklineMode.Content, state.mode)
        assertEquals(SparklineFreshness.Stale, state.freshness)
        assertFalse(state.isFetching)
    }

    @Test
    fun stateCarriesSignalName() {
        val state = SignalSparklineProjection.fromResource(enabled = true, SignalKind.Float, SIGNAL, success(historyResponse(3)))
        assertEquals(SIGNAL, state.signal)
    }

    // ── queryErrorKindOf (web classifyQueryError) ─────────────────────────────────────────────────────────

    @Test
    fun classifiesHttpStatuses() {
        assertEquals(QueryErrorKind.NotFound, SignalSparklineProjection.queryErrorKindOf(ApiError.Http(404)))
        assertEquals(QueryErrorKind.Unauthorized, SignalSparklineProjection.queryErrorKindOf(ApiError.Http(401)))
        assertEquals(QueryErrorKind.Unauthorized, SignalSparklineProjection.queryErrorKindOf(ApiError.Http(403)))
        assertEquals(QueryErrorKind.ServerError, SignalSparklineProjection.queryErrorKindOf(ApiError.Http(503)))
        assertEquals(QueryErrorKind.Network, SignalSparklineProjection.queryErrorKindOf(ApiError.Http(418)))
    }

    @Test
    fun classifiesCircuitOpenAndTransport() {
        assertEquals(QueryErrorKind.Waiting, SignalSparklineProjection.queryErrorKindOf(ApiError.CircuitOpen()))
        assertEquals(QueryErrorKind.Network, SignalSparklineProjection.queryErrorKindOf(ApiError.Network()))
        assertEquals(QueryErrorKind.Network, SignalSparklineProjection.queryErrorKindOf(null))
    }

    // ── view.opened diagnostic (PII-safe, slug only) ──────────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsSlugWithoutPii() {
        val logger = RecordingLogger()
        recordSignalSparklinePreviewOpened(logger)

        val opened = logger.events.single { it.first == "view.opened" }
        assertEquals(mapOf("surface" to "SignalSparklinePreview"), opened.second)
        assertFalse(opened.second.containsKey("value"))
        assertFalse(opened.second.containsKey("signal"))
    }

    private companion object {
        const val SIGNAL = "VehicleSpeed"

        fun numEnvelope(value: Double): SignalEnvelope = SignalEnvelope(SignalKind.Float, SignalValue.Num(value), "")

        fun boolEnvelope(value: Boolean): SignalEnvelope = SignalEnvelope(SignalKind.Bool, SignalValue.Bool(value), "")

        fun historyResponse(points: Int): SignalHistoryResponse =
            SignalHistoryResponse(
                vehicleId = 1L,
                signal = SIGNAL,
                expectedKind = "ValueKindFloat",
                from = "",
                to = "",
                count = points,
                data = (0 until points).map { numEnvelope(it.toDouble()) },
            )

        fun loading(cached: SignalHistoryResponse? = null): Resource<SignalHistoryResponse> =
            Resource.Loading(cached = cached, fetchedAt = if (cached == null) null else 1L, stale = false)

        fun success(
            data: SignalHistoryResponse,
            at: Long = 1L,
        ): Resource<SignalHistoryResponse> = Resource.Success(data = data, fetchedAt = at, stale = false)
    }
}
