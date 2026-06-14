// Pure off-device coverage of the BackgroundWorkSegment model + projection (the data adapter the prompt
// requires: cached → projection) — the native analogue of the web `useBackgroundJobs` aggregation
// (web/src/hooks/useBackgroundJobs.ts). Exercises the export-summary projection, the cache-then-network
// Resource passthrough, the fold across every phase (loading / content / empty / error / stale / offline) and
// the oldest-first merge, and the module-scoped registry. Runs in the :android:testReleaseUnitTest gate; no
// Compose host, no coroutines.
package io.teslasync.android.sharedsurfaces.backgroundworksegment

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.exports.ExportJobSummary
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BackgroundWorkSegmentModelTest {
    private fun summary(
        id: String,
        status: String,
        type: String = "drives",
        fileName: String? = null,
        createdAt: String = "2026-06-13T10:00:00Z",
    ) = ExportJobSummary(id = id, type = type, status = status, fileName = fileName, createdAt = createdAt)

    @Test
    fun activeProjectionKeepsOnlyQueuedAndProcessing() {
        val rows =
            listOf(
                summary("1", "queued"),
                summary("2", "processing"),
                summary("3", "ready"),
                summary("4", "failed"),
                summary("5", "expired"),
            )

        val jobs = rows.toActiveBackgroundJobs()

        assertEquals(listOf("export:1", "export:2"), jobs.map { it.id })
        assertTrue("every projected row is an export", jobs.all { it.kind == BackgroundJobKind.Export })
        assertEquals(ExportProgress.Queued, jobs[0].detail)
        assertEquals(ExportProgress.Processing, jobs[1].detail)
    }

    @Test
    fun projectionLabelsPreferFileNameThenFallBackToType() {
        val named = listOf(summary("1", "processing", fileName = "drives-2026.csv")).toActiveBackgroundJobs().single()
        val blank = listOf(summary("2", "processing", type = "charging", fileName = "   ")).toActiveBackgroundJobs().single()

        assertEquals("drives-2026.csv", named.label)
        assertEquals("charging", blank.label)
    }

    @Test
    fun resourcePassthroughPreservesFreshnessFlagsAcrossEveryVariant() {
        val rows = listOf(summary("1", "queued"))

        val loading = Resource.Loading(cached = rows, fetchedAt = 10L, stale = true).toActiveBackgroundResource()
        val success = Resource.Success(data = rows, fetchedAt = 20L, stale = false).toActiveBackgroundResource()
        val error = Resource.Error(cached = rows, fetchedAt = 30L, stale = true, error = RuntimeException("x")).toActiveBackgroundResource()

        assertEquals(listOf("export:1"), (loading as Resource.Loading).cached?.map { it.id })
        assertTrue(loading.stale)
        assertEquals(listOf("export:1"), (success as Resource.Success).data.map { it.id })
        assertEquals(30L, (error as Resource.Error).fetchedAt)
        assertTrue(error.stale)
    }

    @Test
    fun foldReportsLoadingWhenAFirstFetchHasNothingYet() {
        val state = foldBackgroundWork(UiState.loading(), emptyList())

        assertEquals(WorkPhase.Loading, state.phase)
        assertFalse(state.hasJobs)
        assertEquals(0, state.count)
    }

    @Test
    fun foldReportsEmptyWhenResolvedWithNoWorkAndNothingRegistered() {
        val resolved =
            Resource
                .Success(emptyList<ExportJobSummary>(), fetchedAt = 1L, stale = false)
                .toActiveBackgroundResource()
                .toUiState()

        val state = foldBackgroundWork(resolved, emptyList())

        assertEquals(UiPhase.Empty, resolved.phase)
        assertEquals(WorkPhase.Empty, state.phase)
    }

    @Test
    fun foldReportsErrorOnAHardFailureWithNoCacheAndNothingRegistered() {
        val hardError =
            Resource
                .Error(cached = null, fetchedAt = null, stale = false, error = RuntimeException("boom"))
                .toActiveBackgroundResource()
                .toUiState()

        val state = foldBackgroundWork(hardError, emptyList())

        assertEquals(WorkPhase.Error, state.phase)
        assertNull(state.jobs.firstOrNull())
    }

    @Test
    fun foldMergesExportAndRegisteredWorkOldestFirst() {
        val exports =
            Resource
                .Success(listOf(summary("1", "processing", createdAt = "2026-06-13T10:02:00Z")), 1L, false)
                .toActiveBackgroundResource()
                .toUiState()
        val registered =
            listOf(
                BackgroundJob("save", BackgroundJobKind.Mutation, "2026-06-13T10:00:00Z", label = "Saving…"),
                BackgroundJob("backup", BackgroundJobKind.Custom, "2026-06-13T10:01:00Z", label = "Backup"),
            )

        val state = foldBackgroundWork(exports, registered)

        assertEquals(WorkPhase.Content, state.phase)
        assertEquals(3, state.count)
        assertEquals(listOf("save", "backup", "export:1"), state.jobs.map { it.id })
    }

    @Test
    fun foldSurfacesOfflineWhenAnErrorStillHasCachedRows() {
        val offline =
            Resource
                .Error(
                    cached = listOf(summary("1", "processing")),
                    fetchedAt = 5L,
                    stale = true,
                    error = RuntimeException("offline"),
                ).toActiveBackgroundResource()
                .toUiState()

        val state = foldBackgroundWork(offline, emptyList())

        assertEquals(WorkPhase.Content, state.phase)
        assertTrue("the cached row keeps showing", state.hasJobs)
        assertTrue("flagged stale, never live", state.stale)
        assertTrue("the last-known surface is offline", state.offline)
    }

    @Test
    fun foldShowsRegisteredWorkEvenWhileTheExportFeedIsStillLoading() {
        val registered = listOf(BackgroundJob("save", BackgroundJobKind.Mutation, "2026-06-13T10:00:00Z", label = "Saving…"))

        val state = foldBackgroundWork(UiState.loading(), registered)

        assertEquals(WorkPhase.Content, state.phase)
        assertEquals(1, state.count)
    }

    @Test
    fun registryRegistersClearsAndIsIdempotentById() {
        val registry = BackgroundJobRegistry(now = { "2026-06-13T10:00:00Z" })

        val done = registry.register("backup", label = "First")
        assertEquals(listOf("backup"), registry.jobs.value.map { it.id })
        assertEquals(
            "First",
            registry.jobs.value
                .single()
                .label,
        )

        registry.register("backup", label = "Replaced")
        assertEquals(
            "re-registration replaces by id",
            "Replaced",
            registry.jobs.value
                .single()
                .label,
        )
        assertEquals(1, registry.jobs.value.size)

        done()
        assertTrue("the returned function clears the registration", registry.jobs.value.isEmpty())
    }

    @Test
    fun registryDefaultsTheKindToCustomAndStampsTheStart() {
        val registry = BackgroundJobRegistry(now = { "2026-06-13T12:00:00Z" })

        registry.register("job")

        val job = registry.jobs.value.single()
        assertEquals(BackgroundJobKind.Custom, job.kind)
        assertEquals("2026-06-13T12:00:00Z", job.startedAtIso)
    }
}
