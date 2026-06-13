// The native Jetpack Compose + Material 3 ScrollRestoration shared surface — a parity port of
// web/src/components/layout/ScrollRestoration.tsx. The classic web router does not restore scroll position
// across navigations, so the web component mounts ONCE near the router root, watches `useLocation()` +
// `useNavigationType()`, persists the scroll container's offset per location key in `sessionStorage`, and on
// every navigation either restores the saved offset (on POP / back-forward) or resets to the top (on a fresh
// PUSH / REPLACE) — synchronously, before paint, via `useLayoutEffect`.
//
// This surface is the native equivalent: an effect-only controller (it emits no node — the faithful analogue
// of the web `return null`) bound to the page host's [ScrollState] (the `<main id="main-content">` scroll
// container analogue). It is mounted once near the navigation root; the owning scaffold supplies the current
// location key and navigation type from the P3 nav layer (the `useLocation` / `useNavigationType` analogues),
// so the controller never touches HTTP.
//
// Every decision flows through the pure [ScrollRestorationProjection] + [ScrollPositionStore] (see the model
// header); this file is the thin Compose layer that wires those decisions to a real scroll container:
//   • `useLayoutEffect` restore → a route-keyed `LaunchedEffect` that computes the target via
//     [ScrollRestorationProjection.restoreTarget] and applies it with [ScrollState.scrollTo]. A non-zero
//     restore first awaits content measurement (the web layout effect runs after the DOM is laid out, so the
//     offset is reachable) — a never-scrolled location has no saved offset, so this never blocks a fresh page.
//   • the `onScroll` + requestAnimationFrame persist → a `snapshotFlow { scrollState.value }` collected after
//     the restore, recording each applied scroll under the current key. `snapshotFlow` already conflates to
//     one emission per applied change, which is the native analogue of the web's per-frame rAF throttle.
//   • combining the two into a single route-keyed effect makes the ordering explicit — restore first, then
//     persist — so a freshly navigated location can never have a stale pre-restoration offset written to it.
//
// The surface is invisible by design (a scroll controller has no chrome), so there is no loading / error /
// stale / offline data state to paint — it fetches nothing. Its real, fully-reproduced states are: restore a
// saved offset on POP, default to the top on a POP with no saved entry, reset to the top on PUSH / REPLACE,
// and persist the current offset as the user scrolls. The one-shot `view.opened` diagnostic (P1/S11) is
// emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ScrollRestoration) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.scrollrestoration

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.first

/**
 * Remembers the session-scoped [ScrollPositionStore] — the native analogue of the web component's shared
 * `window.sessionStorage`. Created once in the composition that mounts the surface near the navigation root,
 * so saved offsets survive navigation between destinations for the life of the session (but not a process
 * restart), exactly like `sessionStorage`.
 */
@Composable
fun rememberScrollRestorationStore(): ScrollPositionStore = remember { ScrollPositionStore() }

/**
 * Mount-once scroll controller, the faithful port of the web `ScrollRestoration` watching `useLocation()` +
 * `useNavigationType()`. Emits no UI (the web `return null`); it only drives [scrollState] from navigation:
 * a POP restores the saved offset for [routeKey] (or the top when none exists), a PUSH/REPLACE resets to the
 * top, and every subsequent scroll is persisted under [routeKey] in [store].
 *
 * @param routeKey the current location's identity (web `keyFor(pathname, search)`); supplied by the nav layer.
 * @param navigationType how the current location was reached (web `useNavigationType()`).
 * @param scrollState the page host's scroll container (web `<main id="main-content">`).
 * @param store the session-scoped offset store; defaults to a [rememberScrollRestorationStore].
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ScrollRestoration(
    routeKey: String,
    navigationType: NavigationType,
    scrollState: ScrollState,
    store: ScrollPositionStore = rememberScrollRestorationStore(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { ScrollRestorationDiagnostics.recordViewOpened(logger) }

    LaunchedEffect(routeKey, navigationType, scrollState) {
        val target = ScrollRestorationProjection.restoreTarget(navigationType, store.restore(routeKey))
        if (target > ScrollRestorationProjection.TOP) {
            // The web `useLayoutEffect` runs after layout, so `scrollHeight` is known and the saved offset is
            // reachable; a Compose effect can run before the container is measured. Await a measured, scrollable
            // container before restoring a non-zero offset. A non-zero saved offset only exists for a location
            // that was scrollable when it was saved, so this resolves rather than blocking a fresh page.
            snapshotFlow { scrollState.maxValue }.first { it > ScrollRestorationProjection.TOP }
        }
        scrollState.scrollTo(target)

        // After restoring, persist each applied scroll under the current key (web `onScroll` + rAF throttle).
        snapshotFlow { scrollState.value }.collect { offset -> store.save(routeKey, offset) }
    }
}

/**
 * Binding-friendly overload that mirrors the web component reading `useLocation().pathname` + `.search` and
 * the string-typed `useNavigationType()`. Builds the location key via [ScrollRestorationProjection.keyFor]
 * and parses [navigationValue] (`"POP" | "PUSH" | "REPLACE"`) via [ScrollRestorationProjection.fromRouterValue]
 * before delegating to the typed [ScrollRestoration] core.
 *
 * @param route the current destination identity (web `pathname`).
 * @param arguments the destination's serialized arguments (web `search`).
 * @param navigationValue the raw navigation type string from the nav layer (web `useNavigationType()`).
 * @param scrollState the page host's scroll container.
 * @param store the session-scoped offset store; defaults to a [rememberScrollRestorationStore].
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ScrollRestoration(
    route: String,
    arguments: String,
    navigationValue: String?,
    scrollState: ScrollState,
    store: ScrollPositionStore = rememberScrollRestorationStore(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    ScrollRestoration(
        routeKey = ScrollRestorationProjection.keyFor(route, arguments),
        navigationType = ScrollRestorationProjection.fromRouterValue(navigationValue),
        scrollState = scrollState,
        store = store,
        logger = logger,
    )
}

// ── Previews (tooling-only) ─────────────────────────────────────────────────────────────────────────────
// The surface emits no chrome, so these previews verify composition rather than appearance: the controller is
// mounted over a representative scrollable host in each of its two principal navigation states. The visible
// content is the host list (numeric, locale-neutral rows); the controller itself draws nothing.

private const val PREVIEW_ROW_COUNT = 24
private const val PREVIEW_HOST_HEIGHT_DP = 160
private const val PREVIEW_ROW_HEIGHT_DP = 40
private const val PREVIEW_ROW_PADDING_DP = 12
private const val PREVIEW_SEEDED_OFFSET = 400

private object PreviewNoopLogger : Logger {
    override fun log(
        level: LogLevel,
        event: String,
        fields: Map<String, String>,
    ) = Unit
}

@Composable
private fun ScrollRestorationPreviewHost(scrollState: ScrollState) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .height(PREVIEW_HOST_HEIGHT_DP.dp)
                .verticalScroll(scrollState),
    ) {
        for (index in 0 until PREVIEW_ROW_COUNT) {
            Text(
                text = index.toString(),
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .height(PREVIEW_ROW_HEIGHT_DP.dp)
                        .padding(PREVIEW_ROW_PADDING_DP.dp),
            )
        }
    }
}

@Preview(name = "Fresh navigation — resets to top", showBackground = true)
@Composable
private fun ScrollRestorationFreshPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        val scrollState = rememberScrollState()
        ScrollRestorationPreviewHost(scrollState)
        ScrollRestoration(
            routeKey = ScrollRestorationProjection.keyFor("dashboard", ""),
            navigationType = NavigationType.Push,
            scrollState = scrollState,
            store = remember { ScrollPositionStore() },
            logger = PreviewNoopLogger,
        )
    }
}

@Preview(name = "Back navigation — restores saved offset", showBackground = true)
@Composable
private fun ScrollRestorationRestoredPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        val scrollState = rememberScrollState()
        val routeKey = ScrollRestorationProjection.keyFor("dashboard", "")
        ScrollRestorationPreviewHost(scrollState)
        ScrollRestoration(
            routeKey = routeKey,
            navigationType = NavigationType.Pop,
            scrollState = scrollState,
            store = remember { ScrollPositionStore().apply { save(routeKey, PREVIEW_SEEDED_OFFSET) } },
            logger = PreviewNoopLogger,
        )
    }
}
