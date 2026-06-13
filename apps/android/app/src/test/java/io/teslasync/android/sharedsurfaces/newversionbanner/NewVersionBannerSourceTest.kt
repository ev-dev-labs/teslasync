// Off-device verification of the NewVersionBanner data adapter — the deploy-fingerprint derivation (the web
// `app_version` parity bridge, since the shared VersionInfo contract does not carry app_version) and the
// VersionInfo → String mapping that preserves every cache-then-network freshness flag (ADR-013), plus the
// latest-known-identity extraction the watcher folds on. Runs in the :app:testReleaseUnitTest gate.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.newversionbanner

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.settings.VersionInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NewVersionBannerSourceTest {
    private val stamp = 1_700_000_000_000L

    private fun version(
        chart: String = "1.2.3",
        go: String = "go1.25.0",
        os: String = "linux",
        arch: String = "amd64",
    ): VersionInfo = VersionInfo(chartVersion = chart, goVersion = go, os = os, arch = arch)

    // ── deploy fingerprint: the web app_version analogue derived from the identity fields ────────────────────

    @Test
    fun fingerprintJoinsTheIdentityFields() {
        assertEquals("1.2.3|go1.25.0|linux|amd64", version().deployFingerprint())
    }

    @Test
    fun fingerprintChangesWhenTheDeploymentChanges() {
        val before = version(chart = "1.2.3").deployFingerprint()
        val afterRedeploy = version(chart = "1.3.0").deployFingerprint()
        assertNotEquals("a redeploy bumps the fingerprint — the web app_version divergence", before, afterRedeploy)
    }

    @Test
    fun fingerprintIsStableForTheSameDeployment() {
        assertEquals(version().deployFingerprint(), version().deployFingerprint())
    }

    @Test
    fun anAllBlankPayloadHasAnEmptyFingerprint() {
        assertEquals("the up-to-date/unknown identity is the empty string, never a bogus version", "", VersionInfo().deployFingerprint())
    }

    // ── requirement adapter: VersionInfo → String preserving freshness (web useVersionInfo) ──────────────────

    @Test
    fun mapPreservesSuccessFreshness() {
        val mapped = Resource.Success(version(), fetchedAt = stamp, stale = false).mapDeployFingerprint()
        assertTrue(mapped is Resource.Success)
        val success = mapped as Resource.Success
        assertEquals("1.2.3|go1.25.0|linux|amd64", success.data)
        assertEquals(stamp, success.fetchedAt)
        assertFalse(success.stale)
    }

    @Test
    fun mapPreservesCachedLoading() {
        val mapped = Resource.Loading(cached = version(), fetchedAt = stamp, stale = true).mapDeployFingerprint()
        assertTrue(mapped is Resource.Loading)
        assertEquals("1.2.3|go1.25.0|linux|amd64", mapped.cached)
        assertTrue(mapped.stale)
    }

    @Test
    fun mapPreservesErrorAndCache() {
        val boom = RuntimeException("boom")
        val mapped = Resource.Error(cached = version(), fetchedAt = stamp, stale = true, error = boom).mapDeployFingerprint()
        assertTrue(mapped is Resource.Error)
        val error = mapped as Resource.Error
        assertEquals("1.2.3|go1.25.0|linux|amd64", error.cached)
        assertTrue(error.stale)
        assertEquals(boom, error.error)
    }

    @Test
    fun mapOnErrorWithNoCacheStaysNull() {
        val mapped =
            Resource
                .Error<VersionInfo>(
                    cached = null,
                    fetchedAt = null,
                    stale = false,
                    error = RuntimeException("x"),
                ).mapDeployFingerprint()
        assertTrue(mapped is Resource.Error)
        assertNull(mapped.cached)
    }

    // ── latest-known extraction: the identity the watcher folds on (web app_version after a poll) ────────────

    @Test
    fun latestKnownReadsTheFreshSuccessValue() {
        assertEquals("v1", Resource.Success("v1", stamp, false).latestKnownVersion())
    }

    @Test
    fun latestKnownReplaysTheCachedValueDuringLoadingAndError() {
        assertEquals("v1", Resource.Loading(cached = "v1", fetchedAt = stamp, stale = true).latestKnownVersion())
        assertEquals(
            "v1",
            Resource.Error(cached = "v1", fetchedAt = stamp, stale = true, error = RuntimeException("x")).latestKnownVersion(),
        )
    }

    @Test
    fun latestKnownIsNullWhenNothingIsKnownOrBlank() {
        assertNull(Resource.Loading(cached = null, fetchedAt = null, stale = false).latestKnownVersion())
        assertNull("a blank identity is unknown, never a captured boot", Resource.Success("", stamp, false).latestKnownVersion())
    }
}
