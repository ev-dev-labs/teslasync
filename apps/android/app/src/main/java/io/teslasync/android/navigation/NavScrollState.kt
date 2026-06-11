package io.teslasync.android.navigation

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.saveable.rememberSaveable

/**
 * Scroll-restoration helpers for page hosts. Navigation-Compose scopes `remember`/`rememberSaveable`
 * to the destination's [androidx.navigation.NavBackStackEntry], so state created here is preserved
 * across back-stack save/restore and configuration changes for as long as the entry is retained —
 * giving pages scroll restoration "where page state supports it" with zero per-page bookkeeping.
 */
@Composable
fun rememberRouteScrollState(): ScrollState = rememberScrollState()

/** A [LazyListState] whose scroll offset is restored with the destination's saved state. */
@Composable
fun rememberRouteLazyListState(
    initialFirstVisibleItemIndex: Int = 0,
    initialFirstVisibleItemScrollOffset: Int = 0,
): LazyListState =
    rememberSaveable(saver = LazyListState.Saver) {
        LazyListState(initialFirstVisibleItemIndex, initialFirstVisibleItemScrollOffset)
    }
