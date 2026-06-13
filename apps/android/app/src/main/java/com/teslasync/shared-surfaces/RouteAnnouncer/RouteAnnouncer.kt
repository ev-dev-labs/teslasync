// The native Jetpack Compose + Material 3 RouteAnnouncer shared surface — a parity port of
// web/src/components/a11y/RouteAnnouncer.tsx. Single-page navigation is silent to assistive tech: moving
// between destinations swaps the content but a screen-reader user gets no spoken cue that the screen changed
// (WCAG 2.4.2). The web component mounts once near the app root, watches `useLocation()`, and on every route
// change AFTER the first render reads `document.title` into a polite `aria-live` region. This surface is the
// native equivalent: a visually negligible node marked as a polite live region whose announced text is the
// current destination's localized title, so TalkBack speaks the new screen name on navigation without
// stealing focus.
//
// Every derivation flows through the pure [RouteAnnouncerProjection]; the composable is a thin render layer.
// The faithful mapping of the web behaviour:
//   • `useLocation().pathname` → the nav destination's route key (the surface binds to the P3 nav layer, the
//     router state-holder analogue — never to HTTP). The [Destination] overload is the binding seam the owning
//     scaffold drives, exactly as the web mounts the announcer under `<App/>`.
//   • `document.title` → the localized [navTitle] for the destination, resolved through the i18n catalog
//     (P1/S10) so there is no English literal in this file.
//   • the 100 ms `setTimeout` + `clearTimeout` → a cancellable [delay] inside a route-keyed `LaunchedEffect`,
//     re-read through [rememberUpdatedState] so a rapid A→B→C navigation collapses to one announcement.
//   • the `firstRender` ref, the empty-title clear, and the rotating zero-width-space suffix → the
//     [RouteAnnouncerProjection.reduce] state machine (see the model header).
//
// The surface is invisible by design — an accessibility live region carries no visible chrome — so there is no
// loading / error / stale / offline data state to paint (it fetches nothing). Its real, fully-reproduced
// states are: pre-first-route (empty region), blank title (empty region), and an announced title (the title
// plus its rotating pad). The one-shot `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/RouteAnnouncer) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.routeannouncer

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.Destination
import io.teslasync.android.navigation.Destinations
import io.teslasync.android.navigation.navTitle
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.delay

/** Test tag identifying the live region — the native analogue of the web `data-testid="route-announcer"`. */
const val ROUTE_ANNOUNCER_TEST_TAG: String = "route-announcer"

/**
 * Stateful entry point bound to the navigation layer — the faithful port of the web `RouteAnnouncer` mounted
 * under `<App/>` and watching `useLocation()`. Resolves the destination's localized title (the
 * `document.title` analogue) and route key (the `pathname` analogue) and delegates to the route-keyed core.
 * The owning scaffold supplies the current [destination], mirroring the web `RouteAnnouncer` reading the live
 * location; no data is fetched here.
 *
 * @param destination the current navigation destination (the router state-holder value).
 * @param modifier optional layout modifier for the negligible live-region node.
 * @param delayMs read/announce delay; defaults to [DEFAULT_ANNOUNCE_DELAY_MS] (web parity), `0` in tests.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun RouteAnnouncer(
    destination: Destination,
    modifier: Modifier = Modifier,
    delayMs: Long = DEFAULT_ANNOUNCE_DELAY_MS,
    logger: Logger = LocalDataContainer.current.logger,
) {
    RouteAnnouncer(
        routeKey = destination.route,
        title = navTitle(destination),
        modifier = modifier,
        delayMs = delayMs,
        logger = logger,
    )
}

/**
 * Stateful core — the faithful port of the web effect. Records the one-shot `view.opened` diagnostic on first
 * composition (P1/S11), suppresses the first observed route (web `firstRender`), and on every later [routeKey]
 * change schedules a cancellable delayed read of the freshest [title] before reducing it into the live-region
 * message (web `setTimeout` reading `document.title`). A subsequent route change before the delay elapses
 * cancels the pending read (web `clearTimeout`), so rapid navigation announces only the final screen.
 *
 * @param routeKey the current route identity (web `pathname`); a change drives a fresh announcement.
 * @param title the current screen's already-localized title (web `document.title`); read at fire time.
 * @param modifier optional layout modifier for the negligible live-region node.
 * @param delayMs read/announce delay; defaults to [DEFAULT_ANNOUNCE_DELAY_MS] (web parity), `0` in tests.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun RouteAnnouncer(
    routeKey: String,
    title: String,
    modifier: Modifier = Modifier,
    delayMs: Long = DEFAULT_ANNOUNCE_DELAY_MS,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { RouteAnnouncerDiagnostics.recordViewOpened(logger) }

    var state by remember { mutableStateOf(RouteAnnouncerProjection.INITIAL) }
    val latestTitle by rememberUpdatedState(title)

    LaunchedEffect(routeKey) {
        if (delayMs > 0) {
            delay(delayMs)
        }
        state = RouteAnnouncerProjection.reduce(state, latestTitle)
    }

    RouteAnnouncerContent(message = state.message, modifier = modifier)
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Renders a 1 dp, content-free node marked as a
 * polite live region (web `<VisuallyHidden liveRegion priority="polite">`) whose [contentDescription] is the
 * announced [message]; when that text changes, TalkBack speaks it without moving focus. An empty [message]
 * leaves the region silent, exactly like the web region before the first route change and for a blank title.
 */
@Composable
fun RouteAnnouncerContent(
    message: String,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier =
            modifier
                .size(1.dp)
                .testTag(ROUTE_ANNOUNCER_TEST_TAG)
                .semantics {
                    liveRegion = LiveRegionMode.Polite
                    contentDescription = message
                },
    )
}

// ── Previews (tooling-only) ─────────────────────────────────────────────────────────────────────────────
// The surface is a visually-hidden live region, so these previews verify composition rather than appearance:
// one in its silent state (pre-first-route / blank title) and one carrying an announced title.

@Preview(name = "Silent — empty live region", showBackground = true)
@Composable
private fun RouteAnnouncerSilentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RouteAnnouncerContent(message = "")
    }
}

@Preview(name = "Announced — route title", showBackground = true)
@Composable
private fun RouteAnnouncerAnnouncedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        val primed = RouteAnnouncerProjection.INITIAL.copy(primed = true)
        val announced = RouteAnnouncerProjection.reduce(primed, navTitle(Destinations.require("dashboard")))
        RouteAnnouncerContent(message = announced.message)
    }
}
