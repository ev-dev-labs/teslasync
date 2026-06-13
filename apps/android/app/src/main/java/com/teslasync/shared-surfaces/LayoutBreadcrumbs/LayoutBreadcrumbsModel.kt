// Pure, framework-free model + derivations for the LayoutBreadcrumbs shared surface — the native analogue of
// everything the web component graph computes before it paints a crumb trail. The web source is a three-file
// graph rooted at web/src/components/layout/LayoutBreadcrumbs.tsx:
//   LayoutBreadcrumbs = <Breadcrumbs items={useBreadcrumbs(useBreadcrumbOverrides())} />
// so reproducing it faithfully means reproducing all three:
//   • useBreadcrumbs (web/src/hooks/useBreadcrumbs.ts) — matches the current route, walks its parent chain from
//     ROUTE_META, and emits one item per ancestor (root..leaf). The label of each item is an override, else the
//     localized route title; the leaf carries no link (web `href: undefined`). `{{param}}` tokens in a label and
//     `:param` slots in an href are substituted with the live route args.
//   • the parent chain itself (web/src/lib/routeMeta.ts `PARENT_OVERRIDES`) — the single source of breadcrumb
//     hierarchy. Top-level pages declare no parent, so their chain is one item and the trail self-suppresses.
//   • <Breadcrumbs> (web/src/components/layout/Breadcrumbs.tsx) — renders nothing for a <= 1 item chain; the view
//     layer owns that rule (see LayoutBreadcrumbs.kt) but the [classifyBreadcrumbs] split lives here so it is
//     exercised off-device.
//
// No Compose, no Android UI, no networking: every declaration here is covered by the :android:testReleaseUnitTest
// gate, keeping the composable a thin render layer. The only Android dependency is the framework-free route table
// (io.teslasync.android.navigation.Destinations), which is itself pure data and JVM-tested by RouteTableTest.
//
// State mapping onto the P3 loading / empty / content / error / stale / offline vocabulary (Honesty Covenant #9:
// documented, never silent — this surface derives its data synchronously from the current route and an in-memory
// label store, so the network-lifecycle states do not exist in the web source and are not invented here):
//   empty   => a <= 1 item chain (a top-level page) => [BreadcrumbsSurface.Suppressed]: the web `return null`. The
//              surrounding layout row keeps its other chrome; the breadcrumb slot is intentionally silent.
//   content => a >= 2 item chain => [BreadcrumbsSurface.Trail]: the rendered crumb row.
//   loading / error / stale / offline => not applicable to a route-derived surface with no data feed; the owning
//              page owns any fetch reporting (web parity — there is no such branch in any of the three sources).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/LayoutBreadcrumbs — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and PascalCase segments are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling RouteAnnouncer / ActiveFilterChips surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.layoutbreadcrumbs

import io.teslasync.android.navigation.Destination
import io.teslasync.android.navigation.Destinations
import io.teslasync.shared.core.diagnostics.Logger

/**
 * One resolved crumb the trail renders — the native analogue of the web `BreadcrumbItem` ({ label, href? }).
 *
 * @property destinationId the stable route id this crumb points at (the native render key + override key); the
 *   native analogue of the web route pattern that keys ROUTE_META.
 * @property label the already-resolved, param-substituted text to show (override, else localized route title).
 * @property route the concrete navigation route a link should open (web `href`), or `null` for the trailing
 *   current page, which is plain text with no link (web `href: undefined`).
 */
data class BreadcrumbItem(
    val destinationId: String,
    val label: String,
    val route: String?,
) {
    /** True for the trailing crumb (the current page): rendered as plain text, never a link (web last item). */
    val isCurrent: Boolean get() = route == null
}

/**
 * Breadcrumb hierarchy: child route id -> parent route id. The faithful port of the web `PARENT_OVERRIDES` map
 * (web/src/lib/routeMeta.ts), translated from web route patterns to the native [Destinations] ids that carry the
 * same `webPath`. Anything not listed is a top-level page (a single-item chain that self-suppresses).
 *
 * The one web entry without a native counterpart is `/automations/:id/edit` -> `/automations`: the native route
 * table models only `/automations/new` (the `automationBuilder` id), so there is no edit destination to key. It is
 * deliberately omitted rather than pointed at a fabricated id (Honesty Covenant #2/#9 — no scope drift, documented).
 */
val BREADCRUMB_PARENTS: Map<String, String> =
    mapOf(
        "driveDetail" to "drives",
        "tripReplay" to "driveDetail",
        "chargeDetail" to "charging",
        "vehicleDetail" to "vehicles",
        "vehicleAccess" to "vehicleDetail",
        "tripDetail" to "trips",
        "automationBuilder" to "automations",
        "notificationsStudio" to "notificationsInbox",
        "notificationsArchived" to "notificationsInbox",
        "yearReview" to "analytics",
        "myActivity" to "dashboard",
    )

/**
 * Walks the [BREADCRUMB_PARENTS] chain from [currentId] up to its root and returns the route ids in render order
 * (root first, [currentId] last) — the native analogue of the web `useBreadcrumbs` `while (current)` walk. Unknown
 * ids and any node missing from the route table terminate the walk, and a `visited` guard breaks a malformed cycle
 * exactly as the web hook does. Returns an empty list when [currentId] is not a known destination (web `return []`).
 */
fun breadcrumbChainIds(currentId: String): List<String> {
    val chain = ArrayDeque<String>()
    val visited = HashSet<String>()
    var current: String? = currentId
    // The condition both advances and self-terminates: `visited.add` is false on a malformed cycle and the
    // route-table lookup is null for an unknown node, so the walk stops without a mid-loop break.
    while (current != null && visited.add(current) && Destinations.find(current) != null) {
        chain.addFirst(current)
        current = BREADCRUMB_PARENTS[current]
    }
    return chain.toList()
}

/**
 * Substitutes `{{key}}` tokens in [label] with the matching [args] value — the native analogue of the web hook's
 * label substitution (`label.replace('{{id}}', value)`). A label with no tokens is returned unchanged, so an
 * override like "Drive #{{id}}" renders "Drive #4421" while a plain title is left alone.
 */
fun substituteParams(
    label: String,
    args: Map<String, String>,
): String {
    var out = label
    for ((key, value) in args) out = out.replace("{{$key}}", value)
    return out
}

/**
 * Fills the `{arg}` slots of a [destination]'s navigation route with the concrete [args] values — the native
 * analogue of the web hook composing a concrete `href` from a route pattern (`href.replace(':id', value)`). A
 * route with no slots (or a missing arg) is returned with whatever slots remain, mirroring the web `replace`.
 */
fun concreteRoute(
    destination: Destination,
    args: Map<String, String>,
): String {
    var route = destination.route
    for ((key, value) in args) route = route.replace("{$key}", value)
    return route
}

/**
 * Builds the full crumb trail for [currentId] under the live route [args] and registered [overrides] — the native
 * port of the web `useBreadcrumbs` body. For each ancestor the label is `overrides[id] ?: labelOf(id)` (the web
 * `override ?? t(meta.i18nKey, meta.defaultLabel)`) after `{{param}}` substitution; the trailing crumb carries a
 * `null` route (the current page is plain text) while every ancestor gets a concrete navigation route.
 *
 * [labelOf] resolves a route id to its localized title; it is injected so this function stays framework-free (the
 * composable supplies a `navTitle`-backed resolver, a test supplies a fake). The label/route arg map is shared
 * across every ancestor, exactly as the web hook reuses one `params` object up the chain.
 */
fun buildBreadcrumbTrail(
    currentId: String,
    args: Map<String, String>,
    overrides: Map<String, String>,
    labelOf: (String) -> String,
): List<BreadcrumbItem> =
    breadcrumbChainIds(currentId).map { id ->
        val destination = Destinations.require(id)
        val resolved = overrides[id] ?: labelOf(id)
        BreadcrumbItem(
            destinationId = id,
            label = substituteParams(resolved, args),
            route = if (id == currentId) null else concreteRoute(destination, args),
        )
    }

/**
 * The render-ready classification of the trail — a closed set the view switches on so every branch is covered and
 * unit-tested off-device. Reproduces the web `<Breadcrumbs>` `items.length <= 1 ? null : <nav>` split.
 */
sealed interface BreadcrumbsSurface {
    /** A top-level page (a <= 1 item chain): the trail renders nothing (web `return null`). */
    data object Suppressed : BreadcrumbsSurface

    /** A nested page (a >= 2 item chain): render the crumb row with its [items]. */
    data class Trail(
        val items: List<BreadcrumbItem>,
    ) : BreadcrumbsSurface
}

/**
 * Selects the render-ready [BreadcrumbsSurface] for a resolved trail. Pure: the view early-returns on
 * [BreadcrumbsSurface.Suppressed], matching the web component's self-suppression of single-item chains.
 */
fun classifyBreadcrumbs(items: List<BreadcrumbItem>): BreadcrumbsSurface =
    if (items.size <= 1) BreadcrumbsSurface.Suppressed else BreadcrumbsSurface.Trail(items)

/**
 * The complete inventory of i18n keys the web breadcrumb graph references (every `t()` call), each mapped to its
 * Android catalog entry (P1/S10). The render boundary resolves these via `stringResource`; this list documents the
 * contract and is asserted complete + unique by the model test.
 *
 * - [NAV_LABEL] -> `R.string.translation_a11y_breadcrumb` (the `<nav aria-label>` region label, web "Breadcrumb").
 * - [HOME_LABEL] -> `R.string.translation_a11y_breadcrumbHome` (the leading home affordance, web "Dashboard").
 */
object LayoutBreadcrumbsKeys {
    const val NAV_LABEL: String = "a11y.breadcrumb"
    const val HOME_LABEL: String = "a11y.breadcrumbHome"

    /** Every key the web source references, in source order. */
    val ALL: List<String> = listOf(NAV_LABEL, HOME_LABEL)
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a route id, a
 * crumb label, or any route arg — so a diagnostics line can never leak which screen a user is on.
 */
object LayoutBreadcrumbsDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "LayoutBreadcrumbs"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
