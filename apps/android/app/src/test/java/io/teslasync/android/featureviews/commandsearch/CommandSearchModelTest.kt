// Off-device unit coverage for the CommandSearch feature view's pure model (P3 acceptance: adapter +
// per-state + a11y label tests). Exercises the controlled-input query-state projection (the web blank-vs-typed
// ghost-prompt branch), the top-level lifecycle classifier the composable switches on (per-state coverage),
// and the web-mirrored diagnostics slug. No Compose / Android / HTTP — runs in :android:testReleaseUnitTest.
// Reference behaviour is what the web component does for the same controlled value.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.commandsearch

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import org.junit.Assert.assertEquals
import org.junit.Test

class CommandSearchModelTest {
    // ── lifecycle classifier (per-state coverage) ───────────────────────────────

    @Test
    fun commandSearchSurfaceForMapsLifecycleFlags() {
        assertEquals(CommandSearchSurfaceState.Loading, commandSearchSurfaceFor(isLoading = true, isError = false))
        assertEquals(CommandSearchSurfaceState.Error, commandSearchSurfaceFor(isLoading = false, isError = true))
        // Loading wins when both flags are set (a first load with nothing to show yet).
        assertEquals(CommandSearchSurfaceState.Loading, commandSearchSurfaceFor(isLoading = true, isError = true))
        assertEquals(CommandSearchSurfaceState.Ready, commandSearchSurfaceFor(isLoading = false, isError = false))
    }

    @Test
    fun surfaceCoversEveryUiStatePhase() {
        assertEquals(CommandSearchSurfaceState.Loading, surfaceFor(UiState.loading<Unit>()))
        assertEquals(
            CommandSearchSurfaceState.Error,
            surfaceFor(UiState<Unit>(UiPhase.Error, errorKind = ErrorKind.Network)),
        )
        assertEquals(CommandSearchSurfaceState.Ready, surfaceFor(UiState<Unit>(UiPhase.Content, data = Unit)))
        // An Empty payload still renders the ready field (the field's own emptiness is its query state).
        assertEquals(CommandSearchSurfaceState.Ready, surfaceFor(UiState<Unit>(UiPhase.Empty, data = Unit)))
        val offline = UiState<Unit>(UiPhase.Content, data = Unit, stale = true, errorKind = ErrorKind.Network)
        assertEquals(CommandSearchSurfaceState.Ready, surfaceFor(offline))
    }

    // ── controlled query state (web blank-vs-typed branch) ──────────────────────

    @Test
    fun queryStateIsEmptyOnlyForTheEmptyString() {
        assertEquals(CommandSearchQueryState.Empty, commandSearchQueryStateFor(""))
        assertEquals(CommandSearchQueryState.Active, commandSearchQueryStateFor("charge"))
    }

    @Test
    fun queryStateTreatsWhitespaceAsActiveLikeTheWebControlledInput() {
        // The web ghost prompt hides as soon as `value !== ''`, so a single space is already an active query.
        assertEquals(CommandSearchQueryState.Active, commandSearchQueryStateFor(" "))
        assertEquals(CommandSearchQueryState.Active, commandSearchQueryStateFor("   "))
    }

    // ── diagnostics slug (web-mirrored constant) ────────────────────────────────

    @Test
    fun slugMatchesTheSurfaceContract() {
        assertEquals("CommandSearch", CommandSearchDiagnostics.SLUG)
    }

    /** Bridges a [UiState] to the composable's classifier the same way `CommandSearchContent` does. */
    private fun surfaceFor(state: UiState<*>): CommandSearchSurfaceState =
        commandSearchSurfaceFor(isLoading = state.isLoading, isError = state.isError)
}
