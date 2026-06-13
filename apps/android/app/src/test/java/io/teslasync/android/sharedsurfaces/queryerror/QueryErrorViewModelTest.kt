// Tests [QueryErrorViewModel] against the connectivity seam — covering the contract the view depends on: the
// live online stream is reflected and projected into the right branch, the offline→online recovery emits a
// single [QueryErrorViewModel.reconnect] signal ONLY for a status-less failure (the web auto-retry effect),
// never when going offline nor for a failure that carries an HTTP status, and the one-shot `view.opened`
// fires exactly once. The framework-free model is covered by QueryErrorProjectionTest. Runs in
// :app:testReleaseUnitTest.

package io.teslasync.android.sharedsurfaces.queryerror

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class QueryErrorViewModelTest {
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

    private fun source(online: Flow<Boolean>): QueryErrorSource = queryErrorSource { online }

    @Test
    fun onlineStreamIsReflectedAndProjectedIntoTheOfflineBranch() =
        runTest(UnconfinedTestDispatcher()) {
            val model = QueryErrorViewModel(source(flowOf(false)), QueryErrorFailure(httpStatus = null), RecordingLogger(), backgroundScope)
            backgroundScope.launch { model.render.collect {} }
            advanceUntilIdle()

            assertFalse("the offline emission is reflected", model.online.value)
            assertEquals(QueryErrorKind.Offline, model.render.value!!.branch)
        }

    @Test
    fun aFailureWithAStatusIsProjectedIndependentlyOfConnectivity() =
        runTest(UnconfinedTestDispatcher()) {
            val model = QueryErrorViewModel(source(flowOf(true)), QueryErrorFailure(httpStatus = 404), RecordingLogger(), backgroundScope)
            backgroundScope.launch { model.render.collect {} }
            advanceUntilIdle()

            assertEquals(QueryErrorKind.NotFound, model.render.value!!.branch)
        }

    @Test
    fun reconnectFiresOnceWhenConnectivityReturnsForAStatuslessFailure() =
        runTest(UnconfinedTestDispatcher()) {
            val model =
                QueryErrorViewModel(source(flowOf(false, true)), QueryErrorFailure(httpStatus = null), RecordingLogger(), backgroundScope)
            val signals = mutableListOf<Unit>()
            backgroundScope.launch { model.reconnect.collect { signals += Unit } }
            advanceUntilIdle()

            assertEquals("offline→online auto-retries exactly once", 1, signals.size)
        }

    @Test
    fun reconnectDoesNotFireForAFailureThatCarriesAStatus() =
        runTest(UnconfinedTestDispatcher()) {
            val model =
                QueryErrorViewModel(source(flowOf(false, true)), QueryErrorFailure(httpStatus = 500), RecordingLogger(), backgroundScope)
            val signals = mutableListOf<Unit>()
            backgroundScope.launch { model.reconnect.collect { signals += Unit } }
            advanceUntilIdle()

            assertTrue("a 5xx never auto-retries on a mere online event", signals.isEmpty())
        }

    @Test
    fun reconnectDoesNotFireWhenGoingOffline() =
        runTest(UnconfinedTestDispatcher()) {
            val model =
                QueryErrorViewModel(source(flowOf(true, false)), QueryErrorFailure(httpStatus = null), RecordingLogger(), backgroundScope)
            val signals = mutableListOf<Unit>()
            backgroundScope.launch { model.reconnect.collect { signals += Unit } }
            advanceUntilIdle()

            assertTrue("only an offline→online transition auto-retries", signals.isEmpty())
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = QueryErrorViewModel(source(flowOf(true)), QueryErrorFailure(httpStatus = 503), logger, backgroundScope)

            model.recordViewOpened()
            model.recordViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("QueryError", opened.first().fields["surface"])
        }
}
