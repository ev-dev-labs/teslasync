package io.teslasync.android.sharedsurfaces.statusbar

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.navigation.WindowWidth
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the pure [StatusBarProjection] + model — the cached → projection adapter test
 * the prompt mandates. Covers the web container's icon-only formula
 * (`compact || prefs.iconOnly || isNarrow`), the `useNarrowViewport` breakpoint, the responsive
 * height/placement (`h-6 lg:h-7` / `bottom-14 lg:bottom-0`), the disabled-bar empty predicate, the
 * cache-then-network freshness fold (live/stale/offline), the shared QueryError recovery bucket, and the
 * presence of every accessibility label. No Android, no coroutines.
 */
class StatusBarProjectionTest {
    private val enabled = StatusBarPreferences(enabled = true, iconOnly = false)
    private val iconOnlyPref = StatusBarPreferences(enabled = true, iconOnly = true)
    private val disabled = StatusBarPreferences(enabled = false, iconOnly = false)

    @Test
    fun isNarrowMatchesEveryWidthBelowTheExpandedTier() {
        assertTrue(StatusBarProjection.isNarrow(WindowWidth.Compact))
        assertTrue(StatusBarProjection.isNarrow(WindowWidth.Medium))
        assertFalse(StatusBarProjection.isNarrow(WindowWidth.Expanded))
    }

    @Test
    fun iconOnlyIsForcedByCompactPropPreferenceOrNarrowWidth() {
        // Expanded width + no compact prop + no preference ⇒ full labels.
        assertFalse(StatusBarProjection.iconOnly(enabled, compact = false, width = WindowWidth.Expanded))
        // The compact prop forces it at any width (web `compact`).
        assertTrue(StatusBarProjection.iconOnly(enabled, compact = true, width = WindowWidth.Expanded))
        // The persisted preference forces it at any width (web `prefs.iconOnly`).
        assertTrue(StatusBarProjection.iconOnly(iconOnlyPref, compact = false, width = WindowWidth.Expanded))
        // A narrow viewport forces it (web `useNarrowViewport`).
        assertTrue(StatusBarProjection.iconOnly(enabled, compact = false, width = WindowWidth.Compact))
    }

    @Test
    fun isHiddenIsTrueOnlyWhenTheBarIsDisabled() {
        assertTrue(StatusBarProjection.isHidden(disabled))
        assertFalse(StatusBarProjection.isHidden(enabled))
    }

    @Test
    fun metricsAreDenserAndStackedWhenNarrow() {
        val narrow = StatusBarProjection.metrics(WindowWidth.Compact)
        assertEquals(StatusBarRegistration.HEIGHT_NARROW_DP, narrow.heightDp)
        assertTrue(narrow.stacksAboveTabBar)

        val wide = StatusBarProjection.metrics(WindowWidth.Expanded)
        assertEquals(StatusBarRegistration.HEIGHT_WIDE_DP, wide.heightDp)
        assertFalse(wide.stacksAboveTabBar)
    }

    @Test
    fun freshnessFoldsLoadingContentStaleAndOffline() {
        val live = UiState(UiPhase.Content, data = enabled, fetchedAt = STAMP)
        assertEquals(StatusBarFreshness.Live, StatusBarProjection.freshness(live))

        val stale = UiState(UiPhase.Content, data = enabled, fetchedAt = STAMP, stale = true, refreshing = true)
        assertEquals(StatusBarFreshness.Stale, StatusBarProjection.freshness(stale))

        val offline = UiState(UiPhase.Content, data = enabled, fetchedAt = STAMP, stale = true, errorKind = ErrorKind.Network)
        assertEquals(StatusBarFreshness.Offline, StatusBarProjection.freshness(offline))
    }

    @Test
    fun queryErrorKindMapsEveryFailureBucket() {
        assertEquals(QueryErrorKind.Waiting, StatusBarProjection.queryErrorKind(error(ErrorKind.CircuitOpen)))
        assertEquals(QueryErrorKind.Network, StatusBarProjection.queryErrorKind(error(ErrorKind.Network)))
        assertEquals(QueryErrorKind.Network, StatusBarProjection.queryErrorKind(error(ErrorKind.Timeout)))
        assertEquals(QueryErrorKind.Unauthorized, StatusBarProjection.queryErrorKind(error(ErrorKind.Http, status = 401)))
        assertEquals(QueryErrorKind.NotFound, StatusBarProjection.queryErrorKind(error(ErrorKind.Http, status = 404)))
        assertEquals(QueryErrorKind.ServerError, StatusBarProjection.queryErrorKind(error(ErrorKind.Http, status = 500)))
        assertEquals(QueryErrorKind.ServerError, StatusBarProjection.queryErrorKind(error(ErrorKind.Unknown)))
    }

    @Test
    fun stringsExposeAccessibilityLabelsForEveryInteractiveAffordance() {
        val labels = strings()
        assertTrue(labels.hasAccessibilityLabels)
        assertTrue(labels.applicationStatus.isNotBlank())
        assertTrue(labels.showBar.isNotBlank())
        assertTrue(labels.retry.isNotBlank())

        val blank = labels.copy(applicationStatus = "", showBar = "")
        assertFalse(blank.hasAccessibilityLabels)
    }

    @Test
    fun registrationPinsTheDiagnosticsSlugAndDefaults() {
        assertEquals("StatusBar", StatusBarRegistration.SLUG)
        assertTrue(StatusBarRegistration.DEFAULTS.enabled)
        assertFalse(StatusBarRegistration.DEFAULTS.iconOnly)
    }

    private fun error(
        kind: ErrorKind,
        status: Int? = null,
    ): UiState<StatusBarPreferences> = UiState(UiPhase.Error, errorKind = kind, httpStatus = status)

    private fun strings(): StatusBarStrings =
        StatusBarStrings(
            applicationStatus = "Application status",
            barLabel = "Status bar",
            showBar = "Show status bar",
            showBarHelp = "Always-on footer",
            hiddenNotice = "Status bar hidden",
            iconOnlyLabel = "Always icon-only",
            loading = "Loading",
            stale = "Stale",
            offline = "Offline",
            retry = "Retry",
        )

    private companion object {
        const val STAMP = 1_700_000_000_000L
    }
}
