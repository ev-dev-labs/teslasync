// Off-device verification of the VersionSegment data adapter — the changelog summary derivation (reusing the
// shared useChangelog reducer), the VersionInfo → JSON re-encode that preserves every cache-then-network
// freshness flag (ADR-013) while dropping the contract-absent app_version / uptime_seconds, the latest-known
// update extraction (so a loading/failed feed never fabricates an update), and the "no update" default. Runs in
// the :android:testReleaseUnitTest gate.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.versionsegment

import io.teslasync.android.modalsdialogs.changelogmodal.ChangelogAck
import io.teslasync.android.modalsdialogs.changelogmodal.ChangelogBadge
import io.teslasync.android.modalsdialogs.changelogmodal.ChangelogRelease
import io.teslasync.android.modalsdialogs.changelogmodal.ChangelogSource
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.settings.VersionInfo
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class VersionSegmentSourceTest {
    private val stamp = 1_700_000_000_000L

    private fun release(version: String): ChangelogRelease =
        ChangelogRelease(version = version, date = "2026-01-01", badge = ChangelogBadge.Stable, changes = emptyList())

    private class FakeChangelogSource(
        override val releases: List<ChangelogRelease>,
        private val acknowledged: ChangelogAck,
    ) : ChangelogSource {
        override val latestVersion: String get() = releases.firstOrNull()?.version ?: ""
        override val hasCompletedOnboarding: Boolean get() = true

        override fun ack(): ChangelogAck = acknowledged

        override fun markSeen() = Unit

        override fun stampShown() = Unit

        override fun now(): Long = 0L
    }

    private fun version(): VersionInfo = VersionInfo(chartVersion = "0.9.0", goVersion = "go1.25.0", os = "linux", arch = "amd64")

    // ── changelog summary (reuses the shared useChangelog reducer) ───────────────────────────────────────────

    @Test
    fun changelogStatusReportsAllUnseenOnAFirstVisit() {
        val source = FakeChangelogSource(listOf(release("0.3.0"), release("0.2.0"), release("0.1.0")), ChangelogAck(seenVersion = null))
        val status = source.toVersionSegmentStatus()
        assertTrue(status.hasUnseen)
        assertEquals(3, status.newCount)
    }

    @Test
    fun changelogStatusReportsNoneWhenTheLatestIsSeen() {
        val source = FakeChangelogSource(listOf(release("0.3.0"), release("0.2.0")), ChangelogAck(seenVersion = "0.3.0"))
        val status = source.toVersionSegmentStatus()
        assertFalse(status.hasUnseen)
        assertEquals(0, status.newCount)
    }

    @Test
    fun changelogStatusCountsOnlyReleasesNewerThanTheSeenVersion() {
        val source = FakeChangelogSource(listOf(release("0.3.0"), release("0.2.0"), release("0.1.0")), ChangelogAck(seenVersion = "0.1.0"))
        val status = source.toVersionSegmentStatus()
        assertTrue(status.hasUnseen)
        assertEquals(2, status.newCount)
    }

    // ── VersionInfo → JSON re-encode (web useVersionInfo, preserving freshness) ──────────────────────────────

    @Test
    fun reencodePreservesSuccessFreshnessAndCarriesTheContractFields() {
        val mapped = Resource.Success(version(), fetchedAt = stamp, stale = false).toVersionJson()
        assertTrue(mapped is Resource.Success)
        val success = mapped as Resource.Success
        assertEquals(stamp, success.fetchedAt)
        val fields = VersionSegmentProjection.parseVersion(success.data)
        assertEquals("0.9.0", fields?.chartVersion)
        assertEquals("go1.25.0", fields?.goVersion)
        assertEquals("linux", fields?.os)
        assertNull("app_version is outside the typed contract, so it is absent and falls back", fields?.appVersion)
        assertNull("uptime_seconds is outside the typed contract, so it is absent", fields?.uptimeSeconds)
    }

    @Test
    fun reencodePreservesCachedLoadingFreshness() {
        val mapped = Resource.Loading(cached = version(), fetchedAt = stamp, stale = true).toVersionJson()
        assertTrue(mapped is Resource.Loading)
        assertTrue(mapped.stale)
        assertEquals("0.9.0", VersionSegmentProjection.parseVersion(mapped.cached)?.chartVersion)
    }

    @Test
    fun reencodePreservesErrorAndCache() {
        val boom = RuntimeException("boom")
        val mapped = Resource.Error(cached = version(), fetchedAt = stamp, stale = true, error = boom).toVersionJson()
        assertTrue(mapped is Resource.Error)
        val error = mapped as Resource.Error
        assertTrue(error.stale)
        assertEquals(boom, error.error)
        assertEquals("0.9.0", VersionSegmentProjection.parseVersion(error.cached)?.chartVersion)
    }

    @Test
    fun reencodeOnErrorWithNoCacheStaysNull() {
        val mapped =
            Resource.Error<VersionInfo>(cached = null, fetchedAt = null, stale = false, error = RuntimeException("x")).toVersionJson()
        assertTrue(mapped is Resource.Error)
        assertNull(mapped.cached)
    }

    // ── update extraction (web useUpdateCheck — never fabricates an update) ───────────────────────────────────

    @Test
    fun latestKnownUpdateReadsTheFreshSuccessValue() {
        val update = UpdateCheckInfo(updateAvailable = true, latest = "0.2.0")
        assertEquals(update, Resource.Success(update, stamp, false).latestKnownUpdate())
    }

    @Test
    fun latestKnownUpdateReplaysCacheDuringLoadingAndError() {
        val update = UpdateCheckInfo(updateAvailable = true, latest = "0.2.0")
        assertEquals(update, Resource.Loading(cached = update, fetchedAt = stamp, stale = true).latestKnownUpdate())
        assertEquals(
            update,
            Resource.Error(cached = update, fetchedAt = stamp, stale = true, error = RuntimeException("x")).latestKnownUpdate(),
        )
    }

    @Test
    fun latestKnownUpdateResolvesToNoneWhenNothingIsKnown() {
        val loading = Resource.Loading<UpdateCheckInfo>(cached = null, fetchedAt = null, stale = false)
        val errored = Resource.Error<UpdateCheckInfo>(cached = null, fetchedAt = null, stale = false, error = RuntimeException("x"))
        assertEquals(UpdateCheckInfo.None, loading.latestKnownUpdate())
        assertEquals(UpdateCheckInfo.None, errored.latestKnownUpdate())
    }

    @Test
    fun noUpdateAvailableEmitsAResolvedNoUpdate() =
        runTest {
            val resolved = noUpdateAvailable().first()
            assertTrue(resolved is Resource.Success)
            assertEquals(UpdateCheckInfo.None, (resolved as Resource.Success).data)
            assertFalse(resolved.data.updateAvailable)
        }
}
