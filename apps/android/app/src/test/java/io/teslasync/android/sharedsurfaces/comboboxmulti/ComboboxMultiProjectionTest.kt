package io.teslasync.android.sharedsurfaces.comboboxmulti

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device coverage of [ComboboxMultiProjection] + the pure render helpers — the cached-resource → projection
 * adapter the web component runs before returning JSX. Exercises the label filter, the selected-key hiding, the
 * visible-options cap + overflow, the dropdown phase resolution across the feed's loading / content / empty /
 * error / stale / offline lifecycle, the result-count announce branch, the QueryError mapping, the wrap-around
 * keyboard arithmetic, and the i18n template fill (both the Android `%1$s` arg and the web `{{token}}`). Run by
 * the :android:testReleaseUnitTest gate.
 */
class ComboboxMultiProjectionTest {
    @Test
    fun filterBlankQueryReturnsAllOptions() {
        val options = listOf(opt("a", "Alpha"), opt("b", "Bravo"))
        assertEquals(options, ComboboxMultiProjection.filterOptions(options, "   "))
    }

    @Test
    fun filterMatchesLabelCaseInsensitively() {
        val options = listOf(opt("a", "Alpha"), opt("b", "Bravo"), opt("c", "Alabama"))
        val filtered = ComboboxMultiProjection.filterOptions(options, "al")
        assertEquals(listOf("a", "c"), filtered.map { it.key })
    }

    @Test
    fun projectContentHidesSelectedKeys() {
        val options = listOf(opt("a", "Alpha"), opt("b", "Bravo"), opt("c", "Charlie"))
        val display = ComboboxMultiProjection.project(content(options), request(selected = listOf(opt("b", "Bravo"))))
        assertEquals(ComboboxListPhase.Options, display.listPhase)
        assertEquals(listOf("a", "c"), display.visibleOptions.map { it.key })
        assertEquals(2, display.totalMatches)
    }

    @Test
    fun projectEmptyWhenFilterMatchesNothing() {
        val display = ComboboxMultiProjection.project(content(listOf(opt("a", "Alpha"))), request(query = "zzz"))
        assertEquals(ComboboxListPhase.Empty, display.listPhase)
        assertTrue(display.visibleOptions.isEmpty())
    }

    @Test
    fun projectLoadingFromLoadingFeed() {
        val display = ComboboxMultiProjection.project(UiState.loading(), request())
        assertEquals(ComboboxListPhase.Loading, display.listPhase)
        assertTrue(display.fieldLoading)
    }

    @Test
    fun projectErrorFromErrorFeedWithoutData() {
        val display = ComboboxMultiProjection.project(errorFeed(ErrorKind.Network), request())
        assertEquals(ComboboxListPhase.Error, display.listPhase)
        assertEquals(ErrorKind.Network, display.errorKind)
    }

    @Test
    fun projectCapsVisibleOptionsAndReportsOverflow() {
        val options = (1..10).map { opt("k$it", "Item $it") }
        val display = ComboboxMultiProjection.project(content(options), request(maxVisibleOptions = 3))
        assertEquals(3, display.visibleOptions.size)
        assertEquals(7, display.overflowCount)
        assertTrue(display.hasOverflow)
        assertEquals(10, display.totalMatches)
    }

    @Test
    fun projectAtMaxWhenSelectionReachesCap() {
        val display =
            ComboboxMultiProjection.project(
                content(listOf(opt("a", "Alpha"))),
                request(selected = listOf(opt("x", "X"), opt("y", "Y")), maxItems = 2),
            )
        assertTrue(display.atMax)
    }

    @Test
    fun projectStaleWhenFeedStaleWithoutError() {
        val feed = UiState(UiPhase.Content, data = listOf(opt("a", "Alpha")), stale = true, refreshing = true)
        val display = ComboboxMultiProjection.project(feed, request())
        assertTrue(display.stale)
        assertFalse(display.offline)
        assertTrue(display.refreshing)
    }

    @Test
    fun projectOfflineWhenFeedStaleWithCachedError() {
        val feed = UiState(UiPhase.Content, data = listOf(opt("a", "Alpha")), stale = true, errorKind = ErrorKind.Network)
        val display = ComboboxMultiProjection.project(feed, request())
        assertTrue(display.offline)
        assertFalse(display.stale)
    }

    @Test
    fun resultAnnouncementSelectsBranch() {
        assertEquals(ResultAnnouncement.NoResults, ComboboxMultiProjection.resultAnnouncement(0))
        assertEquals(ResultAnnouncement.OneResult, ComboboxMultiProjection.resultAnnouncement(1))
        assertEquals(ResultAnnouncement.ManyResults, ComboboxMultiProjection.resultAnnouncement(5))
    }

    @Test
    fun queryErrorKindMapsTheTaxonomy() {
        assertEquals(QueryErrorKind.Waiting, ComboboxMultiProjection.queryErrorKind(ErrorKind.CircuitOpen, null))
        assertEquals(QueryErrorKind.Network, ComboboxMultiProjection.queryErrorKind(ErrorKind.Timeout, null))
        assertEquals(QueryErrorKind.Unauthorized, ComboboxMultiProjection.queryErrorKind(ErrorKind.Http, 401))
        assertEquals(QueryErrorKind.NotFound, ComboboxMultiProjection.queryErrorKind(ErrorKind.Http, 404))
        assertEquals(QueryErrorKind.ServerError, ComboboxMultiProjection.queryErrorKind(ErrorKind.Http, 500))
        assertEquals(QueryErrorKind.ServerError, ComboboxMultiProjection.queryErrorKind(null, null))
    }

    @Test
    fun keyboardIndexArithmeticWraps() {
        assertEquals(-1, ComboboxMultiProjection.nextActiveIndex(0, 0))
        assertEquals(1, ComboboxMultiProjection.nextActiveIndex(0, 3))
        assertEquals(0, ComboboxMultiProjection.nextActiveIndex(2, 3))
        assertEquals(2, ComboboxMultiProjection.previousActiveIndex(0, 3))
        assertEquals(0, ComboboxMultiProjection.previousActiveIndex(1, 3))
    }

    @Test
    fun reconcileActiveIndexResetsOnChange() {
        assertEquals(-1, ComboboxMultiProjection.reconcileActiveIndex(2, open = false, size = 3))
        assertEquals(-1, ComboboxMultiProjection.reconcileActiveIndex(2, open = true, size = 0))
        assertEquals(2, ComboboxMultiProjection.reconcileActiveIndex(2, open = true, size = 3))
        assertEquals(0, ComboboxMultiProjection.reconcileActiveIndex(5, open = true, size = 3))
    }

    @Test
    fun labelWithCountSuffixesWhenCapped() {
        assertEquals("Tags", labelWithCount("Tags", 0, null))
        assertEquals("Tags (2/5)", labelWithCount("Tags", 2, 5))
    }

    @Test
    fun announcementTextResolvesLocalizedCopy() {
        val strings = strings()
        assertEquals("No results", announcementText(strings, ResultAnnouncement.NoResults, 0))
        assertEquals("1 result", announcementText(strings, ResultAnnouncement.OneResult, 1))
        assertEquals("5 results", announcementText(strings, ResultAnnouncement.ManyResults, 5))
    }

    @Test
    fun stringTemplatesFillWebTokens() {
        val strings = strings()
        assertEquals("Removed Alpha", strings.removedChip("Alpha"))
        assertEquals("Remove Alpha", strings.removeChip("Alpha"))
        assertEquals("7 more — refine search", strings.moreHidden(7))
        assertEquals("3 results", strings.resultsCount(3))
    }

    @Test
    fun stringTemplatesFillAndroidArgTokens() {
        val strings = strings().copy(resultsCountTemplate = "%1\$s results", removeChipTemplate = "Remove %1\$s")
        assertEquals("3 results", strings.resultsCount(3))
        assertEquals("Remove X", strings.removeChip("X"))
    }

    private fun opt(
        key: String,
        label: String = key,
    ): ComboboxMultiOption = ComboboxMultiOption(key = key, label = label)

    private fun content(options: List<ComboboxMultiOption>) = UiState(UiPhase.Content, data = options)

    private fun errorFeed(kind: ErrorKind) = UiState<List<ComboboxMultiOption>>(UiPhase.Error, errorKind = kind)

    private fun request(
        query: String = "",
        selected: List<ComboboxMultiOption> = emptyList(),
        maxItems: Int? = null,
        maxVisibleOptions: Int = ComboboxMultiRegistration.DEFAULT_MAX_VISIBLE_OPTIONS,
        loading: Boolean = false,
    ): ComboboxMultiRequest = ComboboxMultiRequest(query, selected, maxItems, maxVisibleOptions, loading)

    private fun strings(): ComboboxMultiStrings =
        ComboboxMultiStrings(
            noResults = "No results",
            resultsCountOne = "1 result",
            resultsCountTemplate = "{{count}} results",
            removedChipTemplate = "Removed {{label}}",
            removeChipTemplate = "Remove {{label}}",
            maxReached = "Maximum reached",
            loading = "Loading",
            hideOptions = "Hide options",
            showOptions = "Show options",
            moreHiddenTemplate = "{{count}} more — refine search",
            stale = "Stale",
            offline = "Offline",
        )
}
