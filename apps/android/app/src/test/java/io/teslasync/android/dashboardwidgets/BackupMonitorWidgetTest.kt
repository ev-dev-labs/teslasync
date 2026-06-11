package io.teslasync.android.dashboardwidgets

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/**
 * No-device JVM unit tests for the Backup Monitor data adapter + projection + state machine — the
 * Android analogue of the Windows `BackupMonitorWidgetTests`. They lock the parity contract with
 * web/src/features/dashboard/widgets/BackupMonitorWidget.tsx (byte/relative-time formatting, status
 * mapping, newest-first capped feed) and the cache-then-network state surfaces the Compose layer
 * renders. Run in the `:android:testReleaseUnitTest` gate.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class BackupMonitorWidgetTest {
    // ── fmtBytes parity (web `fmtBytes`) ─────────────────────────────────────────────────────────

    @Test
    fun formatBytes_matchesWebHelper() {
        assertEquals("0 B", formatBytes(0.0))
        assertEquals("0 B", formatBytes(-10.0))
        assertEquals("512 B", formatBytes(512.0))
        assertEquals("1.0 KB", formatBytes(1024.0))
        assertEquals("1.5 KB", formatBytes(1536.0))
        assertEquals("150 MB", formatBytes(150.0 * 1024 * 1024))
        assertEquals("1.5 GB", formatBytes(1.5 * 1024 * 1024 * 1024))
    }

    // ── fmtRelativeTime parity (web `fmtRelativeTime`) ───────────────────────────────────────────

    @Test
    fun formatRelativeTime_matchesWebTiers() {
        assertEquals(EMPTY_VALUE, formatRelativeTime(null, NOW))
        assertEquals("just now", formatRelativeTime(NOW, NOW))
        assertEquals("just now", formatRelativeTime(NOW + 5_000L, NOW))
        assertEquals("just now", formatRelativeTime(NOW - 30_000L, NOW))
        assertEquals("5m ago", formatRelativeTime(NOW - 5 * MINUTE, NOW))
        assertEquals("1h ago", formatRelativeTime(NOW - 90 * MINUTE, NOW))
        assertEquals("1d ago", formatRelativeTime(NOW - 25 * HOUR, NOW))
    }

    // ── status mapping parity (web `statusVariant` / `statusLabel`) ──────────────────────────────

    @Test
    fun statusMapping_matchesWebBuckets() {
        assertEquals(BackupStatusTone.Success, BackupMonitorProjection.toneFor("completed"))
        assertEquals(BackupStatusText.Success, BackupMonitorProjection.textFor("completed"))
        assertEquals(BackupStatusTone.Warning, BackupMonitorProjection.toneFor("running"))
        assertEquals(BackupStatusText.Running, BackupMonitorProjection.textFor("running"))
        assertEquals(BackupStatusTone.Warning, BackupMonitorProjection.toneFor("queued"))
        assertEquals(BackupStatusText.Queued, BackupMonitorProjection.textFor("queued"))
        assertEquals(BackupStatusTone.Danger, BackupMonitorProjection.toneFor("failed"))
        assertEquals(BackupStatusText.Failed, BackupMonitorProjection.textFor("failed"))
        // Null / unknown status → danger-toned, "Failed" label (web `?? 'failed'`).
        assertEquals(BackupStatusTone.Danger, BackupMonitorProjection.toneFor(null))
        assertEquals(BackupStatusText.Failed, BackupMonitorProjection.textFor("weird"))
    }

    // ── sortedRuns + project (web `sortedRuns` / `latestRun` / `slice(0, 5)`) ────────────────────

    @Test
    fun sortedRuns_ordersNewestFirstByCompletionOrCreation() {
        val older = backupRun(id = 1, completedOffset = 5 * HOUR)
        val newest = backupRun(id = 2, completedOffset = 1 * HOUR)
        val middle = backupRun(id = 3, completedOffset = 3 * HOUR)
        val sorted = BackupMonitorProjection.sortedRuns(listOf(older, newest, middle))
        assertEquals(listOf(2L, 3L, 1L), sorted.map { it.id })
    }

    @Test
    fun project_buildsLatestSummaryFromNewestRun() {
        val snapshot =
            BackupMonitorSnapshot(
                listOf(
                    backupRun(id = 1, status = "completed", bytes = 1.5 * 1024 * 1024 * 1024, completedOffset = 5 * HOUR),
                    backupRun(id = 2, status = "running", bytes = 1024.0, completedOffset = HOUR).copy(backupType = "incremental"),
                ),
            )
        val display = BackupMonitorProjection.project(snapshot, NOW) { "ts" }
        assertTrue(display.hasRuns)
        assertEquals("1h ago", display.latest.lastBackupValue)
        assertEquals("1.0 KB", display.latest.sizeValue)
        assertEquals("incremental", display.latest.typeValue)
        assertEquals(BackupStatusTone.Warning, display.latest.statusTone)
        assertEquals(BackupStatusText.Running, display.latest.statusText)
        assertFalse(display.latest.isFailed)
    }

    @Test
    fun project_emptySnapshotYieldsFailedDefaults() {
        val display = BackupMonitorProjection.project(BackupMonitorSnapshot(emptyList()), NOW)
        assertFalse(display.hasRuns)
        assertEquals(EMPTY_VALUE, display.latest.lastBackupValue)
        assertEquals("0 B", display.latest.sizeValue)
        assertEquals(EMPTY_VALUE, display.latest.typeValue)
        assertEquals(BackupStatusText.Failed, display.latest.statusText)
        assertTrue(display.latest.isFailed)
        assertTrue(display.recentRuns.isEmpty())
    }

    @Test
    fun project_capsRecentRunsAtFiveAndFormatsSubtext() {
        val runs = (1..7).map { backupRun(id = it.toLong(), bytes = 1024.0, completedOffset = it * HOUR, durationMs = 250L) }
        val display = BackupMonitorProjection.project(BackupMonitorSnapshot(runs), NOW) { "ABS" }
        assertEquals(BackupMonitorProjection.RECENT_RUNS_CAP, display.recentRuns.size)
        assertEquals(1L, display.recentRuns.first().id) // newest (1h offset) first
        assertEquals("ABS", display.recentRuns.first().timeText)
        assertEquals("1.0 KB \u00B7 250ms", display.recentRuns.first().subText)
    }

    @Test
    fun project_subtextOmitsDurationWhenAbsent() {
        val display =
            BackupMonitorProjection.project(
                BackupMonitorSnapshot(listOf(backupRun(id = 1, bytes = 2048.0, completedOffset = HOUR, durationMs = null))),
                NOW,
            ) { "ABS" }
        assertEquals("2.0 KB", display.recentRuns.first().subText)
    }

    @Test
    fun project_failedTintKeysOffLiteralStatusNotTone() {
        // Unknown status is danger-toned but must NOT paint the failed tint (web `latestStatus === 'failed'`).
        val unknown =
            BackupMonitorProjection.project(
                BackupMonitorSnapshot(listOf(backupRun(id = 1, status = "weird", completedOffset = HOUR))),
                NOW,
            )
        assertEquals(BackupStatusTone.Danger, unknown.latest.statusTone)
        assertFalse(unknown.latest.isFailed)
        val failed =
            BackupMonitorProjection.project(
                BackupMonitorSnapshot(listOf(backupRun(id = 1, status = "failed", completedOffset = HOUR))),
                NOW,
            )
        assertTrue(failed.latest.isFailed)
    }

    // ── JSON parsing (tolerant, web defensive reads) ─────────────────────────────────────────────

    @Test
    fun snapshotFromJson_parsesArrayAndTolueratesPartialRows() {
        val json =
            Json.parseToJsonElement(
                """
                [
                  {
                    "id": 42,
                    "status": "completed",
                    "backup_type": "full",
                    "file_size": 2048,
                    "completed_at": "2024-01-02T03:04:05Z",
                    "duration_ms": 1200
                  },
                  {"id": "7", "status": "failed"},
                  "not-an-object",
                  {"created_at": "2024-01-01T00:00:00Z"}
                ]
                """.trimIndent(),
            )
        val snapshot = BackupMonitorSnapshot.fromJson(json)
        assertTrue(snapshot.hasData)
        assertEquals(3, snapshot.runs.size) // the string element is skipped
        val first = snapshot.runs[0]
        assertEquals(42L, first.id)
        assertEquals("completed", first.status)
        assertEquals("full", first.backupType)
        assertEquals(2048.0, first.fileSizeBytes, 0.0)
        assertEquals(1200L, first.durationMs)
        assertEquals(7L, snapshot.runs[1].id) // numeric string id
        assertEquals(0.0, snapshot.runs[1].fileSizeBytes, 0.0) // missing → 0
        assertNull(snapshot.runs[2].status) // missing → null
    }

    @Test
    fun snapshotFromJson_nonArrayOrNullYieldsEmpty() {
        assertTrue(BackupMonitorSnapshot.fromJson(Json.parseToJsonElement("""{"x":1}""")).runs.isEmpty())
        assertTrue(BackupMonitorSnapshot.fromJson(null).runs.isEmpty())
        assertFalse(BackupMonitorSnapshot.EMPTY.hasData)
    }

    // ── size + registration parity (web registry/system.ts) ──────────────────────────────────────

    @Test
    fun size_compactAndWideThresholdsMatchWeb() {
        assertTrue(BackupMonitorSize(cols = 1, rows = 2).isCompact)
        assertFalse(BackupMonitorSize(cols = 2, rows = 2).isCompact)
        assertFalse(BackupMonitorSize(cols = 2, rows = 2).isWide)
        assertTrue(BackupMonitorSize(cols = 4, rows = 40).isWide)
    }

    @Test
    fun registration_matchesCanonicalMetadata() {
        assertEquals("backup-monitor", BackupMonitorRegistration.ID)
        assertEquals("system", BackupMonitorRegistration.CATEGORY)
        assertEquals("BackupMonitorWidget", BackupMonitorRegistration.SLUG)
        assertEquals(BackupMonitorSize(2, 2), BackupMonitorRegistration.defaultSize)
        assertEquals(BackupMonitorSize(1, 2), BackupMonitorRegistration.minSize)
        assertEquals(BackupMonitorSize(4, 40), BackupMonitorRegistration.maxSize)
        assertTrue(BackupMonitorRegistration.isWithinBounds(BackupMonitorSize(2, 2)))
        assertFalse(BackupMonitorRegistration.isWithinBounds(BackupMonitorSize(5, 2)))
        assertFalse(BackupMonitorRegistration.isWithinBounds(BackupMonitorSize(2, 1)))
        assertEquals(BackupMonitorSize(4, 40), BackupMonitorRegistration.clamp(BackupMonitorSize(9, 99)))
        assertEquals(BackupMonitorSize(1, 2), BackupMonitorRegistration.clamp(BackupMonitorSize(0, 1)))
    }

    // ── diagnostics (P1/S11 view.opened) ─────────────────────────────────────────────────────────

    @Test
    fun diagnostics_recordsViewOpenedSlugOnly() {
        val emitted = mutableListOf<String>()
        val diagnostics = BackupMonitorDiagnostics { emitted += it }
        diagnostics.recordViewOpened()
        diagnostics.recordViewOpened()
        assertEquals(2, diagnostics.viewsOpened)
        assertEquals(listOf("view.opened slug=BackupMonitorWidget", "view.opened slug=BackupMonitorWidget"), emitted)
    }

    // ── state holder: every cache-then-network surface ───────────────────────────────────────────

    @Test
    fun holder_loadingWithNoCacheRendersLoading() =
        runTest(UnconfinedTestDispatcher()) {
            val state = collectState(Resource.Loading(cached = null, fetchedAt = null, stale = false))
            assertEquals(UiPhase.Loading, state.phase)
            assertEquals(BackupMonitorDisplay.EMPTY, state.display)
        }

    @Test
    fun holder_successWithRunsRendersContent() =
        runTest(UnconfinedTestDispatcher()) {
            val snapshot = BackupMonitorSnapshot(listOf(backupRun(id = 1, status = "completed", completedOffset = HOUR)))
            val state = collectState(Resource.Success(data = snapshot, fetchedAt = NOW, stale = false))
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.display.hasRuns)
            assertEquals("1h ago", state.display.latest.lastBackupValue)
            assertEquals(NOW, state.updatedAtMillis)
            assertFalse(state.hasError)
        }

    @Test
    fun holder_successWithNoRunsRendersEmpty() =
        runTest(UnconfinedTestDispatcher()) {
            val state = collectState(Resource.Success(data = BackupMonitorSnapshot(emptyList()), fetchedAt = NOW, stale = false))
            assertEquals(UiPhase.Empty, state.phase)
            assertFalse(state.display.hasRuns)
        }

    @Test
    fun holder_errorWithNoCacheRendersError() =
        runTest(UnconfinedTestDispatcher()) {
            val state =
                collectState(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Http(status = 500)))
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(500, state.errorStatus)
            assertTrue(state.online)
            assertFalse(state.transientWaiting)
        }

    @Test
    fun holder_errorWithCacheRendersOfflineContent() =
        runTest(UnconfinedTestDispatcher()) {
            val snapshot = BackupMonitorSnapshot(listOf(backupRun(id = 1, status = "completed", completedOffset = HOUR)))
            val state =
                collectState(Resource.Error(cached = snapshot, fetchedAt = NOW, stale = true, error = ApiError.Network()))
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertTrue(state.hasError)
            assertFalse(state.online) // network failure ⇒ offline
        }

    @Test
    fun holder_loadingWithStaleCacheRendersRefreshingContent() =
        runTest(UnconfinedTestDispatcher()) {
            val snapshot = BackupMonitorSnapshot(listOf(backupRun(id = 1, status = "completed", completedOffset = HOUR)))
            val state =
                collectState(Resource.Loading(cached = snapshot, fetchedAt = NOW - HOUR, stale = true))
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.refreshing)
            assertTrue(state.stale)
        }

    @Test
    fun holder_retryReSubscribesAndRecoversFromError() =
        runTest(UnconfinedTestDispatcher()) {
            val snapshot = BackupMonitorSnapshot(listOf(backupRun(id = 1, status = "completed", completedOffset = HOUR)))
            val source =
                RetryBackupRunsSource(
                    listOf(
                        Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network()),
                        Resource.Success(data = snapshot, fetchedAt = NOW, stale = false),
                    ),
                )
            val holder = BackupMonitorStateHolder(source, backgroundScope, { NOW }) { "ts" }
            backgroundScope.launch { holder.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Error, holder.state.value.phase)

            holder.retry()
            advanceUntilIdle()
            assertEquals(UiPhase.Content, holder.state.value.phase)
        }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────

    private fun TestScope.collectState(resource: Resource<BackupMonitorSnapshot>): BackupMonitorUiState {
        val source = FlowBackupRunsSource(MutableStateFlow(resource))
        val holder = BackupMonitorStateHolder(source, backgroundScope, { NOW }) { "ts" }
        backgroundScope.launch { holder.state.collect {} }
        advanceUntilIdle()
        return holder.state.value
    }

    private fun backupRun(
        id: Long,
        status: String? = "completed",
        bytes: Double = 0.0,
        completedOffset: Long = 0L,
        durationMs: Long? = null,
    ): BackupRun =
        BackupRun(
            id = id,
            status = status,
            backupType = "full",
            fileSizeBytes = bytes,
            createdAt = null,
            completedAt = Instant.ofEpochMilli(NOW - completedOffset).toString(),
            durationMs = durationMs,
        )

    private class FlowBackupRunsSource(
        private val flow: Flow<Resource<BackupMonitorSnapshot>>,
    ) : BackupRunsSource {
        override fun stream(): Flow<Resource<BackupMonitorSnapshot>> = flow
    }

    private class RetryBackupRunsSource(
        private val results: List<Resource<BackupMonitorSnapshot>>,
    ) : BackupRunsSource {
        private var calls = 0

        override fun stream(): Flow<Resource<BackupMonitorSnapshot>> =
            flow {
                val index = calls.coerceAtMost(results.lastIndex)
                calls++
                emit(results[index])
            }
    }

    private companion object {
        const val NOW = 1_700_000_000_000L
        const val MINUTE = 60_000L
        const val HOUR = 3_600_000L
    }
}
