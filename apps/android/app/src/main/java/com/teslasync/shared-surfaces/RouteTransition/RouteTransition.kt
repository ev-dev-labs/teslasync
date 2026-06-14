// The native Jetpack Compose + Material 3 RouteTransition shared surface — a parity port of the web page-motion
// wrapper web/src/components/motion/RouteTransition.tsx. The web component wraps the routed page body
// (`<Outlet />`) and cross-fades it whenever the location pathname changes: a 120 ms ease-out fade + 4 px
// y-translate, `mode="wait"` so the outgoing page unmounts before the incoming mounts, `initial={false}` so the
// first render never flashes. It honours `prefers-reduced-motion` (the fade collapses to an instant swap) and
// skips the fade entirely for list↔detail navigations (`/drives/:id`, `/charging/:id`, …) so drilling in and
// back out feels snappy. It re-keys by the pathname ONLY — query/search/hash changes never re-fade.
//
// This native surface keeps that contract end to end. It binds the two inputs the web hooks expose — the current
// location key (the `useLocation()` analogue, supplied by the P3 nav layer / owning scaffold, P1/S8) and the
// device motion preference (the `useMotionPreference()` analogue, P1/S8, read at the render boundary by the
// component-library motion atom's reduced-motion plumbing, ADR-005) — and composes the atom's tested
// `RouteTransition` primitive, so the surface and the atom can never drift on what a page cross-fade looks like
// or when it is suppressed. It performs NO HTTP from the view. Over the atom it reproduces every transition state
// the source plays: the animated cross-fade (a non-skip page-to-page navigation, motion enabled), and the
// instant swap (reduced motion, OR a list↔detail navigation in either direction). The skip/duration decision +
// the honesty rationale for why the generic loading / empty / error / stale / offline states do not apply to a
// page-transition wrapper live in RouteTransitionModel.kt.
//
// What a shared surface owes over the bare atom (and what this file adds): it emits the one-shot PII-safe
// `view.opened` diagnostic (P1/S11) carrying only the surface slug on first composition, and exposes a
// location-binding overload that re-keys by pathname only (web parity) so a caller can hand it the whole
// location. The web source reads no `t()` strings and neither does this surface — it renders only the page
// content it is given (so it carries no i18n strings of its own), and it never wraps that content in extra
// semantics, so each page underneath stays fully reachable to TalkBack and honours the system font scale.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/RouteTransition) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located binding overload + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.routetransition

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.android.components.motion.RouteTransition as MotionRouteTransition

/**
 * Cross-fades the routed page [content] whenever [routeKey] changes — the faithful port of the web
 * `RouteTransition`. Records the one-shot PII-safe `view.opened` diagnostic (P1/S11) on first composition, then
 * composes the tested motion atom, which fades the outgoing page out and the incoming page in (an instant swap
 * under reduced motion or for a list↔detail navigation, and no animation at all on the very first render). Wrap
 * it around the page body — not the chrome — so only the page animates.
 *
 * @param routeKey the current location's identity (the web `location.pathname`); supplied by the nav layer
 *   (P1/S8). Use the [RouteTransition] location overload when you hold the whole location and want pathname-only
 *   keying applied for you.
 * @param modifier optional layout modifier for the transition container.
 * @param durationMs the base cross-fade length when a navigation animates (web `useMotionPreference(120)`).
 * @param skipPatterns the list↔detail route patterns that suppress the fade in either direction.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param content the page body to render for the current [routeKey] (the web `children` / `<Outlet />`).
 */
@Composable
fun RouteTransition(
    routeKey: String,
    modifier: Modifier = Modifier,
    durationMs: Int = DEFAULT_TRANSITION_DURATION_MS,
    skipPatterns: List<String> = DEFAULT_ROUTE_SKIP_PATTERNS,
    logger: Logger = LocalDataContainer.current.logger,
    content: @Composable (route: String) -> Unit,
) {
    LaunchedEffect(Unit) { RouteTransitionDiagnostics.recordViewOpened(logger) }
    MotionRouteTransition(
        routeKey = routeKey,
        modifier = modifier,
        durationMs = durationMs,
        skipPatterns = skipPatterns,
        content = content,
    )
}

/**
 * Location-binding overload — the native analogue of the web component reading `useLocation()` and re-keying by
 * `location.pathname`. Builds the cross-fade key from [pathname] alone via [routeTransitionKey] (the [search]
 * string is accepted so a caller can pass the whole location, and is deliberately excluded from the key so query
 * / hash changes never re-fade), then delegates to the [RouteTransition] core, so it shares the single
 * `view.opened` emission and the same skip / reduced-motion behaviour.
 *
 * @param pathname the current destination path (the web `location.pathname`).
 * @param search the current query / hash (the web `location.search`); intentionally NOT part of the fade key.
 * @param modifier optional layout modifier for the transition container.
 * @param durationMs the base cross-fade length when a navigation animates.
 * @param skipPatterns the list↔detail route patterns that suppress the fade in either direction.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param content the page body to render for the current location.
 */
@Composable
fun RouteTransition(
    pathname: String,
    search: String,
    modifier: Modifier = Modifier,
    durationMs: Int = DEFAULT_TRANSITION_DURATION_MS,
    skipPatterns: List<String> = DEFAULT_ROUTE_SKIP_PATTERNS,
    logger: Logger = LocalDataContainer.current.logger,
    content: @Composable (route: String) -> Unit,
) {
    RouteTransition(
        routeKey = routeTransitionKey(pathname = pathname, search = search),
        modifier = modifier,
        durationMs = durationMs,
        skipPatterns = skipPatterns,
        logger = logger,
        content = content,
    )
}

// ── Previews (tooling-only) ─────────────────────────────────────────────────────────────────────────────────
// A static preview frame cannot show a cross-fade, so these verify composition rather than appearance: the
// surface renders the page body for a representative route in each motion mode + for a skipped list-detail route.
// The visible content is the route path itself (locale-neutral); the cross-fade plays only on a live navigation.

/** A no-op logger so previews render without the app's [LocalDataContainer] (tooling has no data container). */
private val PreviewLogger =
    object : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

@Composable
private fun RouteTransitionPreviewPage(route: String) {
    Column(modifier = Modifier.padding(Spacing.md)) {
        BodyText(text = route)
    }
}

@Preview(name = "RouteTransition · page body (motion enabled)", showBackground = true)
@Composable
private fun RouteTransitionMotionPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides false) {
            RouteTransition(routeKey = "/dashboard", logger = PreviewLogger) { route ->
                RouteTransitionPreviewPage(route)
            }
        }
    }
}

@Preview(name = "RouteTransition · page body (reduced motion → instant)", showBackground = true)
@Composable
private fun RouteTransitionReducedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            RouteTransition(routeKey = "/analytics", logger = PreviewLogger) { route ->
                RouteTransitionPreviewPage(route)
            }
        }
    }
}

@Preview(name = "RouteTransition · list-detail route (skipped fade)", showBackground = true)
@Composable
private fun RouteTransitionListDetailPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RouteTransition(routeKey = "/drives/123", logger = PreviewLogger) { route ->
            RouteTransitionPreviewPage(route)
        }
    }
}
