package io.teslasync.shared.core.presentation.systemdiagnostic

import io.teslasync.shared.core.data.repo.SystemDiagnosticRepository
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Verifies the S8 [SystemDiagnosticStore] routes the run to the right S7 repository call and
 * reproduces the web hook's `setQueryData(diagnosticKeys.last, report)` caching exactly — a
 * successful [SystemDiagnosticStore.runDiagnostic] primes [SystemDiagnosticStore.lastReport]
 * (the web `useLastDiagnostic` cache-peek analogue), a failed one leaves it untouched — using a
 * fake repository so no network (and no cache) is involved.
 */
class SystemDiagnosticStoreTest {
    /**
     * Fake S7 port: counts each run, returns a deterministic report, and can be flipped to fail so
     * the on-success last-report write can be proven NOT to fire on failure.
     */
    private class FakeSystemDiagnosticRepository : SystemDiagnosticRepository {
        var runCalls: Int = 0
        var fail: Boolean = false
        var report: DiagnosticReport =
            DiagnosticReport(
                generatedAt = "2026-06-05T12:00:00Z",
                overallStatus = "ok",
                checks =
                    listOf(
                        DiagnosticCheck(
                            id = "tesla_token",
                            name = "Tesla token",
                            status = "ok",
                            detail = "valid",
                            durationMs = 12,
                        ),
                    ),
            )

        override suspend fun runDiagnostic(): Result<DiagnosticReport> {
            runCalls += 1
            if (fail) return Result.failure(IllegalStateException("boom"))
            return Result.success(report)
        }
    }

    private fun store(repo: SystemDiagnosticRepository = FakeSystemDiagnosticRepository()): SystemDiagnosticStore =
        SystemDiagnosticStore(repo)

    @Test
    fun lastReportStartsNull() {
        assertNull(store().lastReport.value)
    }

    @Test
    fun runDiagnosticDelegatesAndCachesLastReport() =
        runTest {
            val repo = FakeSystemDiagnosticRepository()
            val s = store(repo)

            val result = s.runDiagnostic()

            assertTrue(result.isSuccess)
            assertEquals(1, repo.runCalls)
            // setQueryData(diagnosticKeys.last, report): the report is now observable.
            assertEquals(result.getOrThrow(), s.lastReport.value)
            assertEquals("ok", s.lastReport.value?.overallStatus)
            assertEquals(
                1,
                s.lastReport.value
                    ?.checks
                    ?.size,
            )
        }

    @Test
    fun secondRunOverwritesLastReport() =
        runTest {
            val repo = FakeSystemDiagnosticRepository()
            val s = store(repo)

            s.runDiagnostic()
            assertEquals("ok", s.lastReport.value?.overallStatus)

            repo.report = repo.report.copy(overallStatus = "degraded")
            s.runDiagnostic()

            assertEquals(2, repo.runCalls)
            // The latest run supersedes the previous report (web setQueryData overwrites the key).
            assertEquals("degraded", s.lastReport.value?.overallStatus)
        }

    @Test
    fun failedRunDoesNotPrimeLastReport() =
        runTest {
            val repo = FakeSystemDiagnosticRepository().apply { fail = true }
            val s = store(repo)

            assertTrue(s.runDiagnostic().isFailure)

            // onSuccess never ran: the last-report state stays null (web onError never caches).
            assertNull(s.lastReport.value)
        }

    @Test
    fun failedRunAfterSuccessKeepsThePreviousReport() =
        runTest {
            val repo = FakeSystemDiagnosticRepository()
            val s = store(repo)

            assertTrue(s.runDiagnostic().isSuccess)
            val cached = s.lastReport.value

            repo.fail = true
            assertTrue(s.runDiagnostic().isFailure)

            // A failed re-run leaves the last good report in place — getQueryData still returns it.
            assertEquals(cached, s.lastReport.value)
        }
}
