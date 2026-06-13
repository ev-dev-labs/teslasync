package io.teslasync.android.sharedsurfaces.combobox

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.forms.ComboOption
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the Combobox surface's pure logic — the native mirror of how the web component
 * derives its dropdown (web/src/components/forms/Combobox.tsx): the option-feed lifecycle
 * (loading / results / empty / error / stale / offline) folded through the shared
 * [io.teslasync.android.data.toUiState], the `maxVisibleOptions` cap + "{{count}} more" remainder, the
 * selected-row highlight, the clear-affordance visibility, the active-descendant clamp/default, and the
 * `useAnnouncer` result-count thresholds — plus the static/async [ComboboxSource] adapters (cached →
 * projection). Because the composable is a thin render layer, each [ComboboxUiModel] is exactly what it
 * draws, so these assertions double as the per-state "snapshot".
 */
class ComboboxProjectionTest {
    // ── project: option-feed lifecycle mapping ──────────────────────────────────────

    @Test
    fun firstLoadWithNoCacheIsLoading() {
        val model = project(UiState.loading())

        assertEquals(ComboboxPhase.Loading, model.display.phase)
        assertTrue(model.rows.isEmpty())
        assertFalse(model.display.refreshing)
        assertFalse(model.display.canRetry)
    }

    @Test
    fun freshOptionsAreResults() {
        val model = project(content(OPTIONS))

        assertEquals(ComboboxPhase.Results, model.display.phase)
        assertEquals(OPTIONS.size, model.rows.size)
        assertFalse(model.display.stale)
        assertFalse(model.display.offline)
    }

    @Test
    fun resolvedZeroMatchesIsEmpty() {
        val model = project(UiState(UiPhase.Empty, emptyList(), fetchedAt = STAMP))

        assertEquals(ComboboxPhase.Empty, model.display.phase)
        assertTrue(model.rows.isEmpty())
    }

    @Test
    fun hardErrorWithNoCacheIsErrorWithRetry() {
        val model = project(UiState(UiPhase.Error, errorKind = ErrorKind.Network))

        assertEquals(ComboboxPhase.Error, model.display.phase)
        assertTrue(model.rows.isEmpty())
        assertTrue(model.display.canRetry)
        assertFalse(model.display.offline)
    }

    @Test
    fun refreshOverCachedRowsKeepsResultsAndFlagsRefreshing() {
        val model = project(UiState(UiPhase.Content, OPTIONS, fetchedAt = STAMP, refreshing = true))

        assertEquals(ComboboxPhase.Results, model.display.phase)
        assertEquals(OPTIONS.size, model.rows.size)
        assertTrue(model.display.refreshing)
        assertFalse(model.display.offline)
    }

    @Test
    fun ttlStaleWithoutFailureIsStaleNotOffline() {
        val model = project(UiState(UiPhase.Content, OPTIONS, fetchedAt = STAMP, stale = true, refreshing = true))

        assertTrue(model.display.stale)
        assertFalse(model.display.offline)
    }

    @Test
    fun errorOverCachedRowsIsOfflineLastKnownWithRetry() {
        val model =
            project(
                UiState(UiPhase.Content, OPTIONS, fetchedAt = STAMP, stale = true, errorKind = ErrorKind.Network),
            )

        assertEquals(ComboboxPhase.Results, model.display.phase)
        assertEquals(OPTIONS.size, model.rows.size)
        assertTrue(model.display.offline)
        assertTrue(model.display.canRetry)
        // The stale chip is TTL-only; a failed refresh surfaces as offline, never as a bare "stale".
        assertFalse(model.display.stale)
    }

    // ── cap + "{{count}} more" remainder ────────────────────────────────────────────

    @Test
    fun capLimitsVisibleRowsAndCountsHidden() {
        val model =
            ComboboxProjection.project(
                state = content(OPTIONS),
                interaction = ComboboxInteraction(query = "", expanded = true),
                maxVisibleOptions = 2,
            )

        assertEquals(2, model.rows.size)
        assertEquals(OPTIONS.size, model.display.totalCount)
        assertEquals(OPTIONS.size - 2, model.display.hiddenCount)
        assertTrue(model.display.hasHiddenOptions)
    }

    // ── selection highlight + clearable + collapsed label ───────────────────────────

    @Test
    fun selectedOptionIsHighlightedAndLabelled() {
        val model = projectSelected(OPTIONS[1])

        assertTrue(model.rows[1].selected)
        assertFalse(model.rows[0].selected)
        assertEquals("Model Y", model.selectedLabel)
        assertEquals("y", model.selectedValue)
        assertTrue(model.clearable)
    }

    @Test
    fun queryAloneMakesClearable() {
        assertTrue(project(content(OPTIONS), query = "mo").clearable)
    }

    @Test
    fun noSelectionAndNoQueryIsNotClearable() {
        assertFalse(project(content(OPTIONS), query = "").clearable)
    }

    // ── active descendant ───────────────────────────────────────────────────────────

    @Test
    fun activeDescendantDefaultsToFirstRowWhenOpenWithResults() {
        val model = project(content(OPTIONS), expanded = true)

        assertEquals(0, model.activeIndex)
        assertTrue(model.rows[0].active)
    }

    @Test
    fun activeDescendantIsNoneWhenClosed() {
        assertEquals(NO_ACTIVE, project(content(OPTIONS), expanded = false).activeIndex)
    }

    @Test
    fun activeDescendantIsClampedIntoRange() {
        val model =
            ComboboxProjection.project(
                state = content(OPTIONS),
                interaction = ComboboxInteraction(query = "", expanded = true, activeIndex = 99),
            )

        assertEquals(OPTIONS.lastIndex, model.activeIndex)
    }

    @Test
    fun resolveActiveIndexGuardsEmptyClosedAndNonResults() {
        assertEquals(NO_ACTIVE, ComboboxProjection.resolveActiveIndex(0, 0, expanded = true, ComboboxPhase.Results))
        assertEquals(NO_ACTIVE, ComboboxProjection.resolveActiveIndex(0, 3, expanded = false, ComboboxPhase.Results))
        assertEquals(NO_ACTIVE, ComboboxProjection.resolveActiveIndex(0, 3, expanded = true, ComboboxPhase.Empty))
    }

    // ── result-count announcement thresholds ────────────────────────────────────────

    @Test
    fun announcementThresholdsMatchWeb() {
        assertEquals(ResultCount.None, ComboboxProjection.announcement(0))
        assertEquals(ResultCount.One, ComboboxProjection.announcement(1))
        assertEquals(ResultCount.Many(5), ComboboxProjection.announcement(5))
    }

    // ── error-bucket mapping ────────────────────────────────────────────────────────

    @Test
    fun queryErrorKindMapsRecoveryBuckets() {
        assertEquals(QueryErrorKind.Network, errorKind(ErrorKind.Network))
        assertEquals(QueryErrorKind.Network, errorKind(ErrorKind.Timeout))
        assertEquals(QueryErrorKind.Waiting, errorKind(ErrorKind.CircuitOpen))
        assertEquals(QueryErrorKind.ServerError, errorKind(ErrorKind.Decode))
        assertEquals(QueryErrorKind.Unauthorized, httpErrorKind(HTTP_UNAUTHORIZED))
        assertEquals(QueryErrorKind.Unauthorized, httpErrorKind(HTTP_FORBIDDEN))
        assertEquals(QueryErrorKind.NotFound, httpErrorKind(HTTP_NOT_FOUND))
        assertEquals(QueryErrorKind.ServerError, httpErrorKind(HTTP_SERVER_ERROR))
    }

    // ── source adapters (cached → projection) ───────────────────────────────────────

    @Test
    fun staticSourceFiltersByQueryCaseInsensitively() =
        runTest {
            val source = OPTIONS.asComboboxSource()

            val all = source.options("").toList().single()
            assertTrue(all is Resource.Success)
            assertEquals(OPTIONS, (all as Resource.Success).data)

            val filtered = source.options("y").toList().single()
            assertEquals(listOf(OPTIONS[1]), (filtered as Resource.Success).data)
        }

    @Test
    fun asyncSourceEmitsLoadingThenSuccess() =
        runTest {
            val source = asyncComboboxSource(now = { STAMP }) { listOf(OPTIONS.first()) }

            val emissions = source.options("m").toList()

            assertEquals(2, emissions.size)
            assertTrue(emissions[0] is Resource.Loading)
            assertEquals(listOf(OPTIONS.first()), (emissions[1] as Resource.Success).data)
        }

    @Test
    fun asyncSourceEmitsLoadingThenErrorOnFailure() =
        runTest {
            val source = asyncComboboxSource { error("boom") }

            val emissions = source.options("m").toList()

            assertEquals(2, emissions.size)
            assertTrue(emissions[0] is Resource.Loading)
            assertTrue(emissions[1] is Resource.Error)
        }

    // ── helpers ─────────────────────────────────────────────────────────────────────

    private fun content(options: List<ComboOption>): UiState<List<ComboOption>> = UiState(UiPhase.Content, options, fetchedAt = STAMP)

    private fun project(
        state: UiState<List<ComboOption>>,
        selected: ComboOption? = null,
        query: String = "",
        expanded: Boolean = true,
    ): ComboboxUiModel =
        ComboboxProjection.project(
            state,
            ComboboxInteraction(selected = selected, query = query, expanded = expanded),
        )

    private fun projectSelected(option: ComboOption): ComboboxUiModel =
        ComboboxProjection.project(
            content(OPTIONS),
            ComboboxInteraction(selected = option, query = "", expanded = true),
        )

    private fun errorKind(
        kind: ErrorKind,
        status: Int? = null,
    ): QueryErrorKind =
        ComboboxProjection.queryErrorKind(
            ComboboxDisplay(phase = ComboboxPhase.Error, errorKind = kind, httpStatus = status),
        )

    private fun httpErrorKind(status: Int): QueryErrorKind = errorKind(ErrorKind.Http, status)

    private companion object {
        const val STAMP = 1_700_000_000_000L
        const val NO_ACTIVE = ComboboxRegistration.NO_ACTIVE_INDEX
        const val HTTP_UNAUTHORIZED = 401
        const val HTTP_FORBIDDEN = 403
        const val HTTP_NOT_FOUND = 404
        const val HTTP_SERVER_ERROR = 500

        val OPTIONS =
            listOf(
                ComboOption(value = "3", label = "Model 3"),
                ComboOption(value = "y", label = "Model Y"),
                ComboOption(value = "x", label = "Model X"),
            )
    }
}
