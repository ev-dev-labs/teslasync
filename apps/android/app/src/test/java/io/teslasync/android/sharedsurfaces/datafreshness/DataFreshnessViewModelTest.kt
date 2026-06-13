// Tests [DataFreshnessViewModel] against the real cache-then-network feed seam — covering the freshness
// signals the chip renders and the contract the view depends on: a successful fetch folds to a fresh
// snapshot carrying the fetched-at stamp, a hard error with no cache folds to a hard-error snapshot, an
// error that still has cache folds to the offline / last-known snapshot, refresh re-collects the feed and
// logs the PII-safe diagnostic (slug only, never a vehicle id), and the one-shot `view.opened` fires exactly
// once. The framework-free model is covered by DataFreshnessProjectionTest. Runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.datafreshness

import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flow
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
class DataFreshnessViewModelTest {
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

    private fun source(history: () -> kotlinx.coroutines.flow.Flow<Resource<List<ChargingSession>>>): DataFreshnessSource =
        dataFreshnessSource { history() }

    @Test
    fun snapshotReflectsASuccessfulFetchAsFresh() =
        runTest(UnconfinedTestDispatcher()) {
            val src = source { flowOf(Resource.Success(emptyList(), fetchedAt = stamp, stale = false)) }
            val model = DataFreshnessViewModel(src, RecordingLogger(), vehicleId, backgroundScope)
            backgroundScope.launch { model.snapshot.collect {} }
            advanceUntilIdle()

            val snap = model.snapshot.value
            assertEquals(stamp, snap.updatedAtMs)
            assertFalse(snap.fetching)
            assertFalse(snap.hardError)
            assertFalse(snap.offline)
            assertEquals(FreshnessStatus.Fresh, DataFreshnessProjection.statusFor(snap, effectiveStale = false))
        }

    @Test
    fun snapshotReflectsAHardErrorWithNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                source {
                    flowOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = RuntimeException("boom")))
                }
            val model = DataFreshnessViewModel(src, RecordingLogger(), vehicleId, backgroundScope)
            backgroundScope.launch { model.snapshot.collect {} }
            advanceUntilIdle()

            val snap = model.snapshot.value
            assertTrue(snap.hardError)
            assertFalse(snap.hasData)
            assertEquals(FreshnessStatus.Error, DataFreshnessProjection.statusFor(snap, effectiveStale = false))
        }

    @Test
    fun snapshotReflectsOfflineWhenAnErrorStillHasCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                source {
                    flowOf(
                        Resource.Error(
                            cached = emptyList(),
                            fetchedAt = stamp,
                            stale = true,
                            error = RuntimeException("offline"),
                        ),
                    )
                }
            val model = DataFreshnessViewModel(src, RecordingLogger(), vehicleId, backgroundScope)
            backgroundScope.launch { model.snapshot.collect {} }
            advanceUntilIdle()

            val snap = model.snapshot.value
            assertFalse("an error with cache is not a hard error", snap.hardError)
            assertTrue("it is the offline / last-known surface", snap.offline)
            assertEquals(stamp, snap.updatedAtMs)
            assertEquals(FreshnessStatus.Offline, DataFreshnessProjection.statusFor(snap, effectiveStale = true))
        }

    @Test
    fun refreshReCollectsTheFeedAndLogsPiiSafeDiagnostic() =
        runTest(UnconfinedTestDispatcher()) {
            var collections = 0
            val logger = RecordingLogger()
            val src =
                source {
                    flow {
                        collections++
                        emit(Resource.Success(emptyList(), fetchedAt = stamp + collections, stale = false))
                    }
                }
            val model = DataFreshnessViewModel(src, logger, vehicleId, backgroundScope)
            backgroundScope.launch { model.snapshot.collect {} }
            advanceUntilIdle()
            assertEquals(1, collections)

            model.refresh()
            advanceUntilIdle()
            assertEquals("refresh re-collects the cache-then-network feed", 2, collections)

            val record = logger.records.single { it.event == "dataFreshness.refresh" }
            assertEquals(mapOf("surface" to "DataFreshness"), record.fields)
            assertTrue("the vehicle id never reaches a diagnostics field", record.fields.values.none { it.contains("7") })
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model =
                DataFreshnessViewModel(
                    source = source { flowOf(Resource.Success(emptyList(), fetchedAt = stamp, stale = false)) },
                    logger = logger,
                    vehicleId = vehicleId,
                    scope = backgroundScope,
                )

            model.recordViewOpened()
            model.recordViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("DataFreshness", opened.first().fields["surface"])
        }
}
