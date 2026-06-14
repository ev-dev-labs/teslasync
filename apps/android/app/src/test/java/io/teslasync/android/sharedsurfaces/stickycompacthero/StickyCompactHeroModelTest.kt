// Off-device verification of the pure [StickyCompactHeroProjection] + model — the cached → projection adapter
// test the prompt mandates. Covers the web bar's status → tone map (`TEXT_FOR_STATUS`), the short headline
// selector (`SHORT_HEADLINE`), the raw-string status parse (the host's cached value → enum), the cache-then-
// network freshness fold (live/stale/offline), the shared QueryError recovery bucket, and the presence of every
// accessibility label. No Android, no coroutines. Runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.stickycompacthero

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.ui.StatusTone
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StickyCompactHeroModelTest {
    // ── status parse: the host's cached raw value → enum (web string union) ─────────────────────────────────────

    @Test
    fun fromRawParsesEveryKnownStatusCaseInsensitively() {
        assertEquals(HeroStatus.Healthy, HeroStatus.fromRaw("healthy"))
        assertEquals(HeroStatus.Degraded, HeroStatus.fromRaw("Degraded"))
        assertEquals(HeroStatus.Unhealthy, HeroStatus.fromRaw("  UNHEALTHY  "))
        assertEquals(HeroStatus.Maintenance, HeroStatus.fromRaw("maintenance"))
        assertEquals(HeroStatus.Unknown, HeroStatus.fromRaw("unknown"))
    }

    @Test
    fun fromRawCollapsesAbsentBlankOrUnrecognizedToUnknown() {
        assertEquals(HeroStatus.Unknown, HeroStatus.fromRaw(null))
        assertEquals(HeroStatus.Unknown, HeroStatus.fromRaw(""))
        assertEquals(HeroStatus.Unknown, HeroStatus.fromRaw("   "))
        assertEquals(HeroStatus.Unknown, HeroStatus.fromRaw("offline"))
    }

    // ── status → tone (web `TEXT_FOR_STATUS`) ───────────────────────────────────────────────────────────────────

    @Test
    fun toneMapsEveryStatusToItsWebColorBucket() {
        assertEquals(StatusTone.Success, StickyCompactHeroProjection.tone(HeroStatus.Healthy))
        assertEquals(StatusTone.Warning, StickyCompactHeroProjection.tone(HeroStatus.Degraded))
        assertEquals(StatusTone.Danger, StickyCompactHeroProjection.tone(HeroStatus.Unhealthy))
        assertEquals(StatusTone.Neutral, StickyCompactHeroProjection.tone(HeroStatus.Unknown))
        assertEquals(StatusTone.Info, StickyCompactHeroProjection.tone(HeroStatus.Maintenance))
    }

    // ── status resolution: data, else the honest unknown face ───────────────────────────────────────────────────

    @Test
    fun statusOfReturnsTheDataElseUnknown() {
        val content = UiState(UiPhase.Content, data = HeroStatus.Healthy, fetchedAt = STAMP)
        assertEquals(HeroStatus.Healthy, StickyCompactHeroProjection.statusOf(content))

        val blank = UiState<HeroStatus>(UiPhase.Loading)
        assertEquals(HeroStatus.Unknown, StickyCompactHeroProjection.statusOf(blank))
    }

    // ── freshness fold (live / stale / offline) ─────────────────────────────────────────────────────────────────

    @Test
    fun freshnessFoldsLiveStaleAndOffline() {
        val live = UiState(UiPhase.Content, data = HeroStatus.Healthy, fetchedAt = STAMP)
        assertEquals(StickyCompactHeroFreshness.Live, StickyCompactHeroProjection.freshness(live))

        val stale = UiState(UiPhase.Content, data = HeroStatus.Healthy, fetchedAt = STAMP, stale = true, refreshing = true)
        assertEquals(StickyCompactHeroFreshness.Stale, StickyCompactHeroProjection.freshness(stale))

        val offline = UiState(UiPhase.Content, data = HeroStatus.Healthy, fetchedAt = STAMP, stale = true, errorKind = ErrorKind.Network)
        assertEquals(StickyCompactHeroFreshness.Offline, StickyCompactHeroProjection.freshness(offline))
    }

    // ── error bucket ────────────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun queryErrorKindMapsEveryFailureBucket() {
        assertEquals(QueryErrorKind.Waiting, StickyCompactHeroProjection.queryErrorKind(error(ErrorKind.CircuitOpen)))
        assertEquals(QueryErrorKind.Network, StickyCompactHeroProjection.queryErrorKind(error(ErrorKind.Network)))
        assertEquals(QueryErrorKind.Network, StickyCompactHeroProjection.queryErrorKind(error(ErrorKind.Timeout)))
        assertEquals(QueryErrorKind.Unauthorized, StickyCompactHeroProjection.queryErrorKind(error(ErrorKind.Http, status = 401)))
        assertEquals(QueryErrorKind.NotFound, StickyCompactHeroProjection.queryErrorKind(error(ErrorKind.Http, status = 404)))
        assertEquals(QueryErrorKind.ServerError, StickyCompactHeroProjection.queryErrorKind(error(ErrorKind.Http, status = 500)))
        assertEquals(QueryErrorKind.ServerError, StickyCompactHeroProjection.queryErrorKind(error(ErrorKind.Unknown)))
    }

    // ── short headline selector (web `SHORT_HEADLINE`) ──────────────────────────────────────────────────────────

    @Test
    fun headlineSelectorReturnsThePerStatusLabel() {
        val labels = strings()
        assertEquals("Healthy", labels.headline(HeroStatus.Healthy))
        assertEquals("Degraded", labels.headline(HeroStatus.Degraded))
        assertEquals("Unhealthy", labels.headline(HeroStatus.Unhealthy))
        assertEquals("Unknown", labels.headline(HeroStatus.Unknown))
        assertEquals("Maintenance", labels.headline(HeroStatus.Maintenance))
    }

    // ── accessibility labels ────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun stringsExposeAccessibilityLabelsForEveryAffordance() {
        val labels = strings()
        assertTrue(labels.hasAccessibilityLabels)
        assertTrue(labels.regionLabel.isNotBlank())
        assertTrue(labels.refresh.isNotBlank())

        assertFalse(labels.copy(regionLabel = "").hasAccessibilityLabels)
        assertFalse(labels.copy(unhealthy = "").hasAccessibilityLabels)
    }

    @Test
    fun registrationPinsTheDiagnosticsSlugAndId() {
        assertEquals("StickyCompactHero", StickyCompactHeroRegistration.SLUG)
        assertEquals("sticky-compact-hero", StickyCompactHeroRegistration.ID)
    }

    private fun error(
        kind: ErrorKind,
        status: Int? = null,
    ): UiState<HeroStatus> = UiState(UiPhase.Error, errorKind = kind, httpStatus = status)

    private fun strings(): StickyCompactHeroStrings =
        StickyCompactHeroStrings(
            regionLabel = "Status",
            healthy = "Healthy",
            degraded = "Degraded",
            unhealthy = "Unhealthy",
            unknown = "Unknown",
            maintenance = "Maintenance",
            refresh = "Refresh",
            loading = "Loading",
            stale = "Stale",
            offline = "You're offline",
            retry = "Retry",
            errorMessage = "Failed to load data",
        )

    private companion object {
        const val STAMP = 1_700_000_000_000L
    }
}
