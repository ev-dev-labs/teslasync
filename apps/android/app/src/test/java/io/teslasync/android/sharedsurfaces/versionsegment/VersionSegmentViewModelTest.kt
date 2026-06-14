// Tests [VersionSegmentViewModel] against the three-feed seam — covering the contract the view depends on: the
// provenance feed re-shares onto a lifecycle-aware [io.teslasync.android.data.UiState] seeded as loading and
// surfaces content/error; the update feed folds to its latest-known value (never fabricating an update); the
// changelog summary is seeded at construction and re-readable; refresh logs a slug-only PII-safe event; and the
// one-shot view.opened fires exactly once with the surface slug. The framework-free projection is covered by its
// own tests. Runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.versionsegment

import io.teslasync.shared.core.data.repo.Resource
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
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class VersionSegmentViewModelTest {
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

    private val stamp = 1_700_000_000_000L

    private fun versionJson(): JsonElement = buildJsonObject { put("chart_version", "0.9.0") }

    private fun success(json: JsonElement): Resource<JsonElement> = Resource.Success(json, stamp, false)

    private fun source(
        version: Flow<Resource<JsonElement>> = flowOf(success(versionJson())),
        update: Flow<Resource<UpdateCheckInfo>> = flowOf(Resource.Success(UpdateCheckInfo.None, stamp, false)),
        changelog: () -> ChangelogStatus = { ChangelogStatus.None },
    ): VersionSegmentSource = versionSegmentSource(versionInfo = { version }, updateCheck = { update }, changelog = changelog)

    // ── provenance feed → UiState ────────────────────────────────────────────────────────────────────────────

    @Test
    fun stateSeedsAsLoadingBeforeAnyEmission() =
        runTest(UnconfinedTestDispatcher()) {
            val model = VersionSegmentViewModel(source(version = flowOf()), RecordingLogger(), backgroundScope)
            assertTrue(model.state.value.isLoading)
        }

    @Test
    fun stateReflectsAResolvedProvenance() =
        runTest(UnconfinedTestDispatcher()) {
            val model = VersionSegmentViewModel(source(), RecordingLogger(), backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            assertTrue(model.state.value.isContent)
        }

    @Test
    fun stateReflectsAHardError() =
        runTest(UnconfinedTestDispatcher()) {
            val errored =
                source(version = flowOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = RuntimeException("x"))))
            val model = VersionSegmentViewModel(errored, RecordingLogger(), backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            assertTrue(model.state.value.isError)
        }

    // ── update feed: folds to the latest known (web useUpdateCheck) ──────────────────────────────────────────

    @Test
    fun updateCheckFoldsToTheLatestKnownView() =
        runTest(UnconfinedTestDispatcher()) {
            val update = flowOf(Resource.Success(UpdateCheckInfo(updateAvailable = true, latest = "0.2.0"), stamp, false))
            val model = VersionSegmentViewModel(source(update = update), RecordingLogger(), backgroundScope)
            backgroundScope.launch { model.updateCheck.collect {} }
            advanceUntilIdle()

            assertTrue(model.updateCheck.value.updateAvailable)
            assertEquals("0.2.0", model.updateCheck.value.latest)
        }

    // ── changelog summary: seeded + re-readable (web useChangelog) ───────────────────────────────────────────

    @Test
    fun changelogIsSeededFromTheSourceAtConstruction() =
        runTest(UnconfinedTestDispatcher()) {
            val seeded = source(changelog = { ChangelogStatus(hasUnseen = true, newCount = 2) })
            val model = VersionSegmentViewModel(seeded, RecordingLogger(), backgroundScope)

            assertTrue(model.changelog.value.hasUnseen)
            assertEquals(2, model.changelog.value.newCount)
        }

    @Test
    fun refreshChangelogReReadsTheSummaryAsTheAcknowledgementAdvances() =
        runTest(UnconfinedTestDispatcher()) {
            var status = ChangelogStatus(hasUnseen = true, newCount = 3)
            val model = VersionSegmentViewModel(source(changelog = { status }), RecordingLogger(), backgroundScope)
            assertEquals(3, model.changelog.value.newCount)

            status = ChangelogStatus.None
            model.refreshChangelog()

            assertFalse("once the changelog is viewed, the dot clears", model.changelog.value.hasUnseen)
        }

    // ── diagnostics + refresh ────────────────────────────────────────────────────────────────────────────────

    @Test
    fun refreshLogsASlugOnlyEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = VersionSegmentViewModel(source(), logger, backgroundScope)

            model.refresh()

            val refresh = logger.records.filter { it.event == "versionSegment.refresh" }
            assertEquals(1, refresh.size)
            assertEquals(mapOf("surface" to "VersionSegment"), refresh.single().fields)
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = VersionSegmentViewModel(source(), logger, backgroundScope)

            model.recordViewOpened()
            model.recordViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("VersionSegment", opened.first().fields["surface"])
            assertTrue("diagnostics carry only the surface slug", opened.first().fields.keys == setOf("surface"))
        }
}
