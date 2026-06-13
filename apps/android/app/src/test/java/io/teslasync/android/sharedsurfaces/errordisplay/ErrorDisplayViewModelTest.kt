// Tests [ErrorDisplayViewModel] against the real failure-feed + connectivity seam — covering the signals the
// banner branches on and the contract the view depends on: an HTTP failure folds to a snapshot carrying its
// status, a transport failure folds to the offline (transport) signal, lost connectivity over a non-transport
// failure folds to the offline (!online) signal, a successful feed carries no failure to display, retry
// re-collects the feed and logs the PII-safe diagnostic (slug only, never a vehicle id), and the one-shot
// `view.opened` fires exactly once. The framework-free projection is covered by ErrorDisplayProjectionTest.
// Runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.errordisplay

import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ErrorDisplayViewModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }

    private val vehicleId = 7L
    private val stamp = 1_700_000_000_000L

    private fun source(
        online: Flow<Boolean> = flowOf(true),
        failures: () -> Flow<Resource<List<ChargingSession>>>,
    ): ErrorDisplaySource = errorDisplaySource(online = online) { failures() }

    @Test
    fun snapshotReflectsAnHttpStatus() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                source {
                    flowOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Http(status = 404)))
                }
            val model = ErrorDisplayViewModel(src, RecordingLogger(), vehicleId, backgroundScope)
            backgroundScope.launch { model.snapshot.collect {} }
            advanceUntilIdle()

            val snap = model.snapshot.value
            assertTrue(snap.present)
            assertEquals(404, snap.httpStatus)
            assertFalse(snap.transportFailure)
            assertEquals(ErrorBranch.NotFound, ErrorDisplayProjection.branchFor(snap))
        }

    @Test
    fun snapshotReflectsATransportFailureAsOffline() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                source {
                    flowOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network()))
                }
            val model = ErrorDisplayViewModel(src, RecordingLogger(), vehicleId, backgroundScope)
            backgroundScope.launch { model.snapshot.collect {} }
            advanceUntilIdle()

            val snap = model.snapshot.value
            assertTrue(snap.present)
            assertNull(snap.httpStatus)
            assertTrue("a network failure is a transport failure", snap.transportFailure)
            assertEquals(ErrorBranch.Offline, ErrorDisplayProjection.branchFor(snap))
        }

    @Test
    fun snapshotReflectsLostConnectivityAsOffline() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                source(online = flowOf(false)) {
                    flowOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Decode()))
                }
            val model = ErrorDisplayViewModel(src, RecordingLogger(), vehicleId, backgroundScope)
            backgroundScope.launch { model.snapshot.collect {} }
            advanceUntilIdle()

            val snap = model.snapshot.value
            assertTrue(snap.present)
            assertFalse("a decode failure is not a transport failure", snap.transportFailure)
            assertFalse("connectivity was reported lost", snap.online)
            assertEquals(ErrorBranch.Offline, ErrorDisplayProjection.branchFor(snap))
        }

    @Test
    fun snapshotHasNoFailureForASuccessfulFeed() =
        runTest(UnconfinedTestDispatcher()) {
            val src = source { flowOf(Resource.Success(emptyList<ChargingSession>(), fetchedAt = stamp, stale = false)) }
            val model = ErrorDisplayViewModel(src, RecordingLogger(), vehicleId, backgroundScope)
            backgroundScope.launch { model.snapshot.collect {} }
            advanceUntilIdle()

            val snap = model.snapshot.value
            assertFalse("a successful feed renders no banner (web `if (!error) return null`)", snap.present)
            assertNull(ErrorDisplayProjection.render(snap, hasListHref = false, retryable = true))
        }

    @Test
    fun retryReCollectsTheFeedAndLogsPiiSafeDiagnostic() =
        runTest(UnconfinedTestDispatcher()) {
            var collections = 0
            val logger = RecordingLogger()
            val src =
                source {
                    flow {
                        collections++
                        emit(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Http(status = 503)))
                    }
                }
            val model = ErrorDisplayViewModel(src, logger, vehicleId, backgroundScope)
            backgroundScope.launch { model.snapshot.collect {} }
            advanceUntilIdle()
            assertEquals(1, collections)

            model.retry()
            advanceUntilIdle()
            assertEquals("retry re-collects the cache-then-network feed", 2, collections)

            val record = logger.records.single { it.event == "errorDisplay.retry" }
            assertEquals(mapOf("surface" to "ErrorDisplay"), record.fields)
            assertTrue("the vehicle id never reaches a diagnostics field", record.fields.values.none { it.contains("7") })
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model =
                ErrorDisplayViewModel(
                    source = source { flowOf(Resource.Success(emptyList<ChargingSession>(), fetchedAt = stamp, stale = false)) },
                    logger = logger,
                    vehicleId = vehicleId,
                    scope = backgroundScope,
                )

            model.recordViewOpened()
            model.recordViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("ErrorDisplay", opened.first().fields["surface"])
        }
}
